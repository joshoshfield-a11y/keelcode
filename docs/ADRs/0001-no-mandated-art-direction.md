# ADR 0001 — No mandated art direction for KeelCode

Date: 2026-10-18. Status: accepted. Decided by: the user.

## Context

XANDRIA shipped with a strong, decided art direction: voxel/blocky
characters, glowing emissive visor slits, layered armor, blocky terrain,
and AMBER glow as the signature motif. That direction is XANDRIA's
identity, and it worked there — but it was the user's choice for that
product, and it was locked after iteration.

KeelCode is a different thing: a standalone engine, not a generator with
a house style.

## Decision

KeelCode has no mandated art direction. The Wave 1 demo (and the
engine's samples) use neutral placeholder art: clean simple geometry,
good lighting and materials, no voxel mandate, no amber glow, no house
style to learn before you can ship.

## Rationale

- An engine that bakes in one art style pushes every game toward the
  same look. KeelCode is the user's workshop for building games fast;
  it should not have a house look.
- Neutral placeholders keep the Wave 1 demo honest: if it plays well
  with plain geometry, the mechanics are sound. Art direction becomes a
  per-game decision, not a framework one.
- Reuses XANDRIA's measured engineering lessons (instancing discipline,
  draw-call budgets, DPR tiers) without importing its aesthetics.

## Consequences

- Each KeelCode game defines its own art direction, documented per
  project, not per engine.
- Engine demos and samples stay deliberately plain. "Looks plain" is
  not a defect against the demo.
- Nothing in `framework/` references any visual style.
