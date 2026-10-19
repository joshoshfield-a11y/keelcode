# ADR-0009: Pointer-lock acquisition camera swing in the Babylon port

**Status:** Accepted
**Date:** 2026-10-19
**Context:** KeelCode Wave 3 (`backends/ts-babylon`), game/player.ts port

## Decision

The pointer-lock acquisition mousemove quirk documented in ADR-0007 is
present in the Babylon backend's `game/player.ts` **by design**, with the
identical code path as the ts-three reference: a document-level
`mousemove` listener feeds `e.movementX/Y` into `addLook()` whenever
`document.pointerLockElement === canvas`.

When pointer lock engages, Chromium dispatches a mousemove whose
movementX/Y equal the negated pre-lock cursor position (observed in Wave 2:
[-639,-335], the start-button position). The game consumes it as a look
impulse and the camera yaws ~90° before tick 0. This is a real game bug
(the camera swings when a real user clicks to lock), not a backend
difference: it reproduces identically under Babylon because the input path
— engine action input plus the raw `addLook` handler — was ported
unchanged.

## Harness workaround (unchanged)

The parity recorder suppresses ALL mousemove delivery via a
capture-phase `stopImmediatePropagation()` on window before clicking
start, exactly as in the ts-three recording (ADR-0007 §"Bugs found during
parity work" item 1). No game-side filtering was added.

## Consequences

- The Babylon backend's vectors and smoke tests are recorded/verified
  with mousemove suppressed, same as ts-three and rs-core. Cross-input
  comparisons stay valid because the quirk is input-path, not sim.
- Fixing the game-side behavior (e.g. ignoring the first mousemove after
  `pointerlockchange`, or gating `addLook` on a lock-generation counter)
  is a game change spanning both TS backends and remains the user's call,
  as decided in ADR-0007. This ADR records the deliberate carry-over so a
  future fix updates both backends together.
