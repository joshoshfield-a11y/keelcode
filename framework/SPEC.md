# KeelCode Framework Spec — v1

Date: 2026-10-18. Status: v1, report-only proposal becoming the working contract.
Owner: this file plus `framework/schema/` are the portable surface. Everything
a backend does is measured against these contracts; everything a game needs is
written against component names, field names, and system ordering — not any
backend's API.

Say it up front, because the whole shape of this spec hangs off it:
**determinism is not required.** The user redirected on 2026-10-18: this is a
CLI / vibe-coding engine for the two of us, our workshop for building games
fast — not a portable-spec product. So seeded randomness stays as a
recommended pattern (it makes worldgen and debugging nicer), but there is no
determinism contract, no snapshot-hash conformance, no cross-backend
comparison. What stays binding: the fixed timestep, the named phases, the
component schemas, the save format, the asset manifest, and the perf budgets
with their no-regression rule.

Wave 1 implements this spec on the ts-three reference backend only
(TypeScript on three.js). The Rust and Babylon backends come later; when they
do, they implement these same contracts.

---

## 1. Fixed timestep with named phases

- The sim ticks at a fixed **60 Hz**. Render interpolates between ticks;
  the render rate never drives simulation. Frame-rate changes affect
  smoothness, never behavior.
- An accumulator consumes wall-clock time in fixed slices. Spiral-of-death
  guard: **max 5 catch-up ticks per frame**; after that the sim sheds time
  and logs a shed event. A shed event is a testable signal, not a silent
  drop.
- The scheduler has exactly four named phases, the same on every backend:

  `PreUpdate` → `Update` → `PostUpdate` → `Render`

  Systems declare one phase and run in exactly one phase. A system never
  runs in two phases.
- Sim and presentation are separated in code: anything that writes game
  state lives inside a fixed tick. Juice, particles, and screen shake run
  on the render side with cosmetic randomness; the sim side uses seeded
  streams only.
- Entity spawn/destroy mid-iteration is queued and applied at phase end —
  never let behavior depend on container order.
- Test: step N ticks against a scripted input log and assert expected
  world state (entity positions, scores, event log) against the backend's
  own recorded vectors. No cross-backend hash requirement.

## 2. Seeded randomness (recommended pattern, not a contract)

- Recipe for anything procedural (worldgen, loot, dressing, particles):
  one master seed per run, per-subsystem streams as
  `hash(master_seed, system_salt, tick)`. Reproducible when we want it,
  no ceremony when we don't.
- Guideline, not a gate: keep wall-clock reads and unseeded randomness out
  of gameplay code. Cosmetic randomness on the render side is fine and
  doesn't touch game state.
- `framework/smoke/` holds per-backend behavioral checks (boot the demo,
  run the input script, assert the expected outcomes). The old
  `framework/conformance/` idea is dropped with determinism.

## 3. Entity/component model and canonical components

The framework defines a canonical component set as JSON Schema data
contracts in `framework/schema/component.schema.json`. Backends map these
schemas onto their own storage:

- Rust backend: pure archetype ECS — entities are ids, components are plain
  data in contiguous tables, systems are functions with declared access.
- TS backends: entity ids plus per-component-type arrays (ECS-lite) for the
  sim, mapped onto scene-graph nodes for rendering. Hot paths (projectiles,
  particles, crowds) iterate the arrays, never the graph.

The canonical components:

| Component    | Fields                                                        |
|--------------|---------------------------------------------------------------|
| `Transform`  | position (vec3), rotation (quaternion), scale (vec3)          |
| `Velocity`   | linear (vec3), angular (vec3)                                 |
| `Health`     | current, max                                                  |
| `Collider`   | shape (box/sphere/capsule), size params, isTrigger            |
| `Renderable` | meshRef, materialRef, visible                                 |
| `Script`     | behaviorId, params                                            |
| `Input`      | marker: this entity is player-controlled                      |
| `AI`         | brainId, blackboard                                           |
| `Lifetime`   | remaining seconds, then despawn                               |
| `Pickup`     | effectId, value                                               |
| `Projectile` | damage, piercing, ownerId                                     |

Mapping rule: the same game logic reads the same on every backend. A
system named `movement` reading `Transform` and `Velocity` in the
`Update` phase exists in every backend with identical tick semantics.
Backend-specific code lives behind the render/physics/audio driver
boundary only.

Test: each backend instantiates the reference entity set and asserts
expected component state after N ticks against its own recorded vectors.

## 4. Draw-call and perf budgets, binding no-regression rule

- Each backend declares budgets for the reference demo scene, desktop and
  mobile tiers: max draw calls, max p95 frame time, max DPR. Starting
  point, inherited from what we actually measured shipping XANDRIA: **150
  draw calls on the S25 tier**, DPR caps **1.5 mobile / 2.0 desktop**.
- The binding rule: **no wave may regress any budget number without the
  regression being measured, disclosed, and explicitly waived by the
  user.** This is the rule that caught the graphics-wave-2 duplicate
  landmarks. It stays the law.
- Rendering discipline ships with the budgets: one InstancedMesh per
  (geometry, material) bucket for crowds/projectiles/particles; never
  one draw call per repeated mesh.
- Test: the perf harness boots the demo scene headlessly (or with a null
  renderer where supported), counts draw calls and frame time, and fails
  the build if any budget is exceeded.

## 5. Asset pipeline conventions

- Source assets live in `assets/src/`: glTF for meshes, PNG source
  textures, WAV source audio. A shared baker CLI (`tools/asset-baker`,
  Wave 4) produces `assets/dist/`: KTX2/Basis textures, Draco-compressed
  glTF where it pays, OGG audio, texture atlases per material family.
- Every baked asset gets a manifest entry: `{id, type, source_hash,
  dist_hash, lod_tiers[], budget_cost}`. Schema in
  `framework/schema/asset-manifest.schema.json`.
- Naming: `category/name/variant` (e.g. `chars/raider/visor-amber`).
  Versioning is by content hash, never by filename bump.
- Test: the baker validates the manifest on every run; a missing or
  hash-mismatched asset fails the build before any backend boots.

## 6. Save-format contract

- JSON envelope: `{engine, format_version, seed, tick, components}`.
  `components` holds per-entity component data by entity id.
- Generated content serializes the seed, not the world. Hand-authored
  state serializes fully. Migrations are forward-only and versioned.
- Writes are atomic: temp file plus rename. Cloud-save conflict rule:
  last-write-wins, with a backup of the loser kept locally.
- Test: round-trip a save through save/load and compare; run every
  migration from each older version to current and assert validity.
  (Round-trip compares against the backend's own vectors — no
  determinism contract means exact cross-machine byte equality isn't
  promised, only semantic round-trip fidelity.)

---

## What waves 2–4 owe this spec

Wave 2 (Rust, headless first): same demo systems, same gameplay outcomes
(scores, entity counts, event log) as the ts-three reference. Behavioral
parity, not byte parity. Wave 3 (Babylon): the same demo plays and the
budgets hold. Wave 4 (convergence): shared smoke suite as CI, shared
asset-baker CLI, perf harness with recorded budgets per backend, and the
first real game.

No engine code exists yet beyond this spec and the ts-three scaffold.
Report-first stays: each wave opens with a brief, code starts on the
user's word.
