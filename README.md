# KeelCode

A standalone game engine and framework — the two of us' workshop for
building games fast. One framework spec, three planned backends, and a
CLI that does the talking.

## What's here

- `framework/SPEC.md` — the v1 stack-neutral contract: fixed 60Hz
  timestep with named phases (`PreUpdate`/`Update`/`PostUpdate`/`Render`),
  seeded randomness as a recommended pattern, the canonical component
  set, perf budgets with the binding no-regression rule, asset
  conventions, and the save-format contract. The schemas in
  `framework/schema/` are the machine-checkable form.
- `backends/ts-three/` — the reference backend (Wave 1): TypeScript on
  three.js with Rapier physics. Rust (headless sim first) lands in
  Wave 2, Babylon in Wave 3.
- `tools/keel-cli/` — the `keel` CLI. This is the primary interface:
  `keel new / dev / build / test / smoke` are the five verbs every game
  is built with. No visual editor until a shipped game needs one.
- `docs/ADRs/` — the real decisions, one file each.
- `docs/KB-MAP.md` — which knowledge-base note and skill owns which
  subsystem. Read the note, then follow the skill.

No mandated art direction (ADR 0001): demos use neutral placeholder
art — clean geometry, good lighting, no house style. KeelCode's own art
direction is undecided on purpose.

Determinism is not required (user redirect 2026-10-18). Seeded RNG is a
recommended pattern for procedural stuff, but there is no byte-identical
contract. Behavior is tested per backend against its own recorded
vectors.

## Quickstart

```bash
# from the repo root
npm install -g ./tools/keel-cli   # or: node tools/keel-cli/bin/keel.mjs

keel new my-game
cd my-game && npm install
keel dev        # Vite dev server
keel build      # tsc --noEmit && vite build
keel test       # vitest
keel smoke      # framework smoke checks (from the repo root)
```

## Gates (per wave, no exceptions)

- `tsc` clean, vitest green, Playwright e2e green, zero console errors
  in the demo run
- Perf budgets held; any regression measured, disclosed, and explicitly
  waived by the user (binding rule — see SPEC.md §4)
- Behavioral smoke tests pass against the backend's recorded vectors
- Report-first: each wave opens with a brief; code starts on the user's
  word. A wave ends with a playable demo, not scaffolding.

Read `~/workspace/game-kb/ENGINE-ARCHITECTURE.md` for the full wave plan
and `docs/KB-MAP.md` before building anything.
