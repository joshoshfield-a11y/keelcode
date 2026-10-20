# ADR-0016: Discard the pointer-lock acquisition burst in both TS backends

**Status:** Accepted
**Date:** 2026-10-20
**Supersedes:** ADR-0009 (the "carried by design" stance)
**Context:** KeelCode Wave 6 (`backends/ts-three`, `backends/ts-babylon`), game/player.ts

## Context

When pointer lock engages, Chromium dispatches a mousemove whose
movementX/Y are the negated pre-lock cursor position (observed in Wave 2:
[-639,-335]). Both TS demo games fed that event straight into `addLook()`,
swinging yaw ~+95° and driving pitch from -0.18 to the +0.45 clamp before
tick 0. ADR-0007 recorded the bug during the parity work; ADR-0009
deliberately carried it into the Babylon port unchanged, leaving the
game-side fix as the user's call. The user authorized the fix for Wave 6.

## Decision

In both backends' `Player.attachLook()` (identical code, as the port
contract requires):

- A `pointerlockchange` listener sets `swallowLockBurst` whenever lock
  is acquired on the game canvas.
- The document `mousemove` handler, in its pointer-locked branch only,
  discards the first event after each acquisition and clears the flag.

Only that one event is dropped. No tuning constant, input action, loop
phase, or other behavior changes; legitimate look input — fast flicks
included — is never clamped or altered.

### Why discard, not Drift Arena's clamp

Drift Arena (Wave 4d) mitigates the same spike with a per-event clamp
(±0.25 rad) suited to its direct-steering flight model, where look deltas
steer the ship. For the demos the clamp was rejected: it would cap every
legitimate fast flick (a behavior change far beyond the burst) and would
still leave up to 0.25 rad of acquisition swing, so yaw/pitch would not
be unchanged at tick 0. The discard is also the fix ADR-0009 itself named
("ignoring the first mousemove after `pointerlockchange`").

## Consequences

- Real users no longer get a camera swing when clicking to lock, in
  either TS demo.
- If a browser ever delivers no burst on lock, the cost is one dropped
  genuine mousemove per acquisition — a single event's delta,
  imperceptible in play.
- Parity is unaffected, as predicted: the recorders suppress mousemove
  entirely, so the recorded vectors never contained the burst.
  Re-verified in Wave 6 — rs-core strict parity (`KEEL_PARITY_STRICT=1`)
  passes 4/4 against the existing vectors, unmodified, and both TS
  backends' vector-replay/record specs stay green and identical.
- Regression coverage: `e2e/pointer-lock.spec.ts` in both backends
  injects the exact Wave 2 burst vector after lock and asserts yaw and
  pitch are unchanged. Verified fail-first (both specs fail on the
  pre-fix code with wide margins) and passing post-fix.
