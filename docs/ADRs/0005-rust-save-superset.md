# ADR 0005 — Rust save format is a superset of the TS save (and why bit-exact round-trip is not achievable)

Date: 2026-10-19. Status: accepted.

## Context

Wave 2a workstream D must provide `Demo::save_state` / `Demo::load_state`
with a round-trip test: 300 ticks → save → fresh `Demo` → load → 300 more
ticks, compared against an uninterrupted 600-tick run.

The TS reference (`backends/ts-three/src/main.ts`, `doSave`/`doLoad`)
persists only the ECS components (Transform/Health), the score, and the
mode. It does **not** persist controller state (yaw/pitch, velocity
smoothing, coyote time, jump buffer, fire cooldown), enemy AI records
(waypoint index, attack cooldown, respawn timer, FSM timer), RNG stream
states, the input script cursor, or the event log.

## Decision

The Rust `SaveData.extra` persists **everything** needed to resume the
deterministic sim state bit-exactly:

- RNG stream states as `u32` (`enemies`, `arena` streams).
- Player controller: `yaw`, `pitch`, `vx`, `vz`, `coyote`, `buffer`,
  `fire_cd`, `was_grounded`, `dip`, `ry`.
- Enemy records: `wp`, `state`, `t` (FSM timer), `atk_cd`, `respawn_t`,
  `vx`, `vz`, `ry`, plus `hp` and Transform.
- Combat: projectile pool slots (pos/vel/life/active), pickup taken flags.
- Input: the script cursor is restored by replaying `input.update(0..tick)`
  after load (the script itself is re-loaded by the caller).
- Camera: `cam_pos` (smoothed follow position).
- Loop: `hit_stop_pending`, `loop_paused`, `tick`.
- Physics bodies: teleported to saved positions (`set_kinematic_position`).

This is a deliberate superset of the TS save. The TS save is designed for
human "save game" semantics (resume roughly where you left off); the Rust
save is designed for deterministic re-simulation (the parity harness).

## Why bit-exact round-trip is not achievable

The round-trip test asserts exact equality on all deterministic state
(score, kills, hp, RNG, events, controller/AI fields) and a bounded
epsilon (0.5) on physics-integrated positions. Bit-exact position
round-trip is **impossible** without changes to `src/physics.rs`
(another workstream's file, out of scope for workstream D):

- Rapier's contact solver (TGS with warm-starting) keeps hidden per-contact
  impulse state that affects the next step's resolution. This state is not
  exposed via the `PhysicsSys` API and cannot be serialized.
- On load, bodies are teleported to their saved positions, but the fresh
  rapier world starts with a cold contact cache. The first post-load step
  therefore resolves contacts slightly differently than the uninterrupted
  run (measured: ~2.5e-3 y-divergence after one step).
- The divergence amplifies through the enemy AI steering (positions feed
  back into decisions), reaching ~0.1 after 300 steps.

Attempted mitigations that did not work: 8-step and 16-step contact
warm-ups with re-pinning (the cache does not converge to the warm state
because the impulse history depends on the full trajectory, not just the
current step).

## Path forward

True bit-exact round-trip requires the physics workstream to expose
narrow-phase serialization (or a deterministic-mode flag) in
`src/physics.rs`. Until then, the documented epsilon is the strongest
achievable guarantee, and it is sufficient: the sim does not go
catastrophically off-track after load (no falls through the world, no
NaNs), and all gameplay-relevant discrete state (kills, pickups, hp,
events) is exact.
