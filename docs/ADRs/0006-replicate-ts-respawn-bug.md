# ADR 0006 — Replicate the TS enemy-respawn bug (do not fix it)

Date: 2026-10-19. Status: accepted.

## Context

The TS reference (`backends/ts-three/src/game/enemy.ts`) has a bug in the
enemy respawn logic. The update loop checks `hp <= 0 → continue` (skip the
rest of the update) **before** the respawn-countdown branch. But `kill()`
leaves `hp` at 0 (it does not set a separate `dead` flag that the
skip-check consults). Result: once an enemy dies, the update loop skips it
forever, the respawn timer never ticks down, and the enemy never respawns.

The task brief for workstream D says to port the TS sim logic faithfully,
and the parity gate compares the Rust outcome vectors against TS-recorded
vectors. If the Rust port "fixed" the bug, dead enemies would respawn in
Rust but not in TS, and the parity test would fail (different enemy counts,
positions, and kill events over long runs).

## Decision

The Rust port in `src/systems/ai.rs` replicates the bug verbatim:

- `kill()` sets `hp = 0.0` and `respawn_t = RESPAWN_TIME`, but does not
  clear a flag that would let the update loop reach the respawn branch.
- The update loop's first check is `if rec.hp <= 0.0 { continue; }`,
  placed before the respawn-countdown logic, exactly as in the TS.

A comment in `ai.rs` marks this as an intentional replication of the TS
bug, with a reference to this ADR.

## Rationale

Behavioral parity with the reference is the acceptance gate. A "fix"
would be a deliberate divergence, and divergences require justification
(see ADR-0005 for the save-format divergence, which was justified by
differing requirements). Here there is no justification: the bug does not
block the demo, the parity harness, or any downstream workstream.

## Consequences

- If the TS reference ever fixes the bug, the Rust port must be updated in
  lockstep, and the parity vectors re-recorded.
- The `respawn_t` field is still persisted in saves (it is part of the
  enemy record), even though it never ticks down in practice. This keeps
  the save format forward-compatible with a fixed respawn implementation.
