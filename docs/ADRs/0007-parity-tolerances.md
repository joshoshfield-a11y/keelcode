# ADR-0007: Behavioral parity tolerances (Wave 2a gate)

**Status:** Accepted
**Date:** 2026-10-19
**Context:** Wave 2a behavioral parity gate (`KEEL_PARITY_STRICT=1`)

## Decision

The strict parity test (`backends/rs-core/tests/parity.rs`) uses epsilon
comparisons, not bit-exact equality:

- **Player positions:** ±0.12m (observed max diff 0.097m)
- **Engaging enemy positions:** ±1.0m (observed max diff 0.6m)
- **Patrol/idle enemy positions:** not compared (chaotic divergence, see below)
- **Event ticks:** ±15 ticks (observed max diff 13, after +1 normalization)
- **Scores, kills, hp, enemy counts, enemy states, event kinds+counts:** exact

## Why bit-exact is unachievable

Both sides run rapier 0.22.0 (pinned, see ADR-0004), but the TS side uses the
WASM build (`@dimforge/rapier3d-compat`) while Rust uses the native build.
The f32 solver resolves kinematic-vs-wall contacts with slightly different
rounding, producing ~0.001m differences on first contact that accumulate to
~0.1m as the player slides along walls over 600-900 ticks. This is a
toolchain difference, not a logic bug: the same Rust sources produce
bit-identical trajectories across runs, and the TS sources are deterministic
(the recorder's double-run check proves it).

Patrol enemies follow RNG-generated waypoints (bit-exact RNG, verified). A
0.1m position difference can cause one side's enemy to trigger a waypoint
advance (within 1.2m) while the other's does not, sending them to completely
different waypoints (observed: 10m+ divergence). Patrol paths are chaotic;
their positions carry no parity signal. The event log (damage events prove
chasing works) and state/hp/count are the meaningful AI checks.

## Bugs found during parity work

1. **Pointer-lock acquisition mousemove (game bug, harness workaround).**
   When pointer lock engages, Chromium dispatches a mousemove with
   movementX/Y equal to the negated pre-lock cursor position (observed:
   [-639,-335], the start-button position). The game's document-level
   mousemove handler feeds this into `addLook()`, swinging the camera yaw
   ~90° before tick 0. The Rust sim has no mouse, so for parity the
   recorder suppresses all mousemove delivery via a capture-phase
   `stopImmediatePropagation()` on window. The underlying game behavior is a
   real bug (camera swings when a real user clicks to lock); fixing it is a
   Wave 1 game change, deferred to the user's decision.

2. **TS event coalescing (harness bug, fixed).** The recorder derived events
   by diffing 10-tick snapshots. Multiple 12-hp hits within one window were
   coalesced into a single event with inflated `dmg` (e.g., two hits →
   `dmg: 24`). The fix splits the hp drop into individual 12-hp hit events
   (`ceil(drop/12)`), matching the Rust sim's per-hit event stream.

3. **int/float JSON serialization (test bug, fixed).** `serde_json::Value`
   distinguishes integer `0` (TS) from float `0.0` (Rust f64). The test now
   compares numeric fields via `as_f64()` instead of raw `Value` equality.

## Consequences

- The parity gate verifies **behavioral** parity as defined in WAVE2-BRIEF.md:
  same scores, entity counts, event kinds+counts, and outcome (death) ticks.
- It does NOT verify tick-perfect or bit-perfect reproduction, which is
  unachievable across WASM/native physics builds and was explicitly removed
  from the requirements when determinism was dropped (2026-10-18).
- The tolerances are documented in the test source and this ADR. Any future
  relaxation must update both.
