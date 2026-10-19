# ADR 0003 — TypeScript on three.js as the reference backend first

Date: 2026-10-18. Status: accepted.

## Context

KeelCode spans three stacks: TypeScript on three.js, Rust with
Bevy-style ECS, TypeScript on Babylon/PlayCanvas. The framework spec
needs an implementation to be written against, and the first one sets
the tone for everything that follows.

## Decision

Wave 1 builds the ts-three backend first, as the reference
implementation. Rust (headless sim first) follows in Wave 2, Babylon in
Wave 3.

## Rationale

- three.js is a rendering library, not an engine. The loop, ECS-lite,
  physics wiring, audio, and input are all ours — which is exactly what
  a reference needs: full control over every layer, nowhere for the
  framework contract to hide behind someone else's defaults.
- Fastest path to a playable, shippable game on the proven pipeline
  (web build, APK via the actions playbook, itch.io via butler, device
  testing on the S25). Every measured perf pattern (instancing, DPR
  tiers, draw-call budgets) lands here first, where it is cheapest to
  get right.
- The Rust backend is the riskiest piece; proving it second against a
  finished reference keeps the risk contained. Babylon is the cheapest
  port once the spec has two independent implementations.

## Consequences

- `framework/SPEC.md` v1 is written against what ts-three proves.
  Where the spec and the reference disagree, the reference wins and
  the spec gets amended.
- The Wave 1 gate set is the XANDRIA bar: tsc clean, vitest green,
  Playwright e2e green, zero console errors, perf budgets held, smoke
  tests green.
- The Wave 1 demo is the behavioral target for Waves 2 and 3.
