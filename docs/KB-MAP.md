# KB Map — engine subsystem → knowledge base note → owning skill

Read the KB note first, then follow the skill. Notes are the long-form
reference; skills are the build playbooks. New engine-specific playbooks
discovered during the build get LEDGER provenance rows like everything
else.

| Engine subsystem | KB note(s) | Owning skill(s) |
|---|---|---|
| Fixed-timestep loop, phases, seeded RNG pattern | `core/03-game-loop.md`, `core/01-math.md`, `core/09-procedural.md` | `engine-core-loop` |
| Entity/component model, ECS-lite (TS), archetype ECS (Rust) | `core/02-architecture.md` | `engine-core-loop` |
| Physics stepping inside the fixed loop, Rapier integration | `core/05-physics.md` | `physics-integration`, `character-controller` |
| Rendering, three.js patterns, DPR tiers | `core/04-rendering.md` | `threejs-render-patterns` |
| Instancing discipline, draw-call budgets, binding no-regression rule | `core/13-mobile-perf.md` | `mobile-perf-budgets` |
| Input: keyboard/mouse/gamepad + touch controls | `core/07-input.md` | `character-controller` |
| Enemy AI, NPC behaviors, blackboards | `core/08-ai-behavior.md` | `npc-enemy-systems` |
| Procedural world dressing, seeded worldgen | `core/09-procedural.md` | `procedural-worlds` |
| Juice, particles, screen shake (render-side only) | `core/10-game-feel.md` | `game-feel-juice` |
| Save/load format, seed-based saves | `core/12-save-persistence.md` | `save-persistence` |
| Audio: music/SFX, adaptive layers | `core/06-audio.md` | `audio-toolkit` |
| Shaders, custom materials | `core/14-shaders.md` | `shader-craft` |
| Quest/narrative templates | `core/15-quest-narrative.md` | `quest-narrative-gen` |
| Networking (out of Wave 1 scope) | `core/11-networking.md` | `netcode-basics` |
| Asset pipeline, baker CLI | `publish/` notes, `tools/asset-baker/README.md` | (Wave 4; tool owns its own playbook) |
| Shared smoke CI across all backends (`keel smoke`) | `~/workspace/game-kb/PHASE1-DESIGN.md` §5–6 | `xandria-qa` |
| keel CLI surface (`new --backend`, `perf`, `vectors`, `bake`, `room`) | `docs/CLI.md` | — |
| Ship pipeline: web build, APK, itch.io | `publish/` notes | `itchio-publish`, `apk-build-via-actions` |
| QA workflow per wave, gates, report-first | `~/workspace/game-kb/PHASE1-DESIGN.md` §5–6 | `xandria-qa` |
| Framework spec provenance | `~/workspace/game-kb/ENGINE-ARCHITECTURE.md` | — |

The spec itself is `framework/SPEC.md`; its contracts are the testable
form of the notes above. When a note and a spec disagree, the spec wins
and the disagreement goes in an ADR.
