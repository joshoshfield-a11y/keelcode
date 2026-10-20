# KeelCode Wave 1 — test API contract (Workstream D)

The unit tests in this directory run against the real engine modules in
`src/engine/`. This file pins the API surface the tests rely on, plus the
contract points the engine currently does NOT satisfy (flagged for the
engine/demo workstreams — the parent reconciles).

Component field names are the engine's own (`src/engine/ecs.ts`), which
**differ from `framework/schema/component.schema.json`**: the schema says
`Transform: {position, rotation, scale}` and `Health: {current, max}`; the
engine uses `Transform: {x,y,z, rx,ry,rz, sx,sy,sz}` and `Health: {hp,
maxHp}`. The tests follow the engine. The schema/engine mismatch needs a
decision (align the engine to the schema, or version the schema).

## `src/engine/loop.ts` — matches tests

- `createLoop(): Loop`; phases `preupdate → update → postupdate → render`
  via `loop.on(phase, fn)`.
- `step(dt = 1/60)`: preupdate + one sim step; **ignores pause/timeScale**
  (manual test path). `tick` increments per step; `ctx.dt === 1/60`.
- The rAF-driven `frame()` (internal): clamps frame dt at 0.1 s, runs at
  most 5 catch-up steps, then sheds the remainder with a `console.warn`
  containing "shed". Verified: a 10 s hitch yields exactly 5 steps + shed log.
- `loop.paused` (property, also `setPaused(b)`); `loop.timeScale`
  (property, also `setTimeScale(x)`); `hitStop(ms)` takes **milliseconds**
  and never shortens an active longer freeze.

## `src/engine/ecs.ts` — matches tests

- `createWorld(): World`; component names via the `C` constant.
- `spawn(comps: Record<string, unknown>): number` — initial components are
  passed to spawn (not set afterwards); spawns are queued.
- `despawn(id)` is **queued**: `get`/`has` read dead immediately, the row
  leaves on `flush()` or implicitly at the next `query()`/`count()`.
- `query(...names)` returns a snapshot array (spawn order); despawning or
  spawning mid-iteration never corrupts the in-flight snapshot.
- `set()` on a despawn-queued entity is silently ignored (no resurrection).
- There is no `alive()` and no per-component `remove()`.

## `src/engine/rng.ts` — matches tests

- `mulberry32(seed): () => number` — canonical; reference vectors pinned in
  rng.test.ts (seed 0 → 0.26642920868471265, …).
- `hashSeed(master: number, salt: string): number` — FNV-1a + finalizer,
  uint32. **Takes a numeric master, not a string.**
- `createStreams(master: number, salts: string[]): Record<string, () => number>`
  — salt names are caller-chosen; streams are independent.

## `src/engine/save.ts` — matches tests, with one gap

- `createSave(namespace: string): SaveSys` with `save(slot, data)`,
  `load(slot)`, `list()`, `remove(slot)`.
- Keys: `${namespace}:save:${slot}` live, `${namespace}:save:${slot}.tmp`
  temp. Uses `window.localStorage` when present, in-memory fallback
  otherwise. Writes are temp → live → temp-removed; a stale temp is always
  cleaned, even after a crashed write.
- Payload envelope `{sum: fnv1a(inner), data: inner}`; checksum mismatch,
  non-JSON, newer `format_version`, and unknown migration paths all fail
  clean (`load` returns null, never throws).
- **GAP:** the `migrations` table is empty, so there is no path 0 → 1. The
  Wave 1 brief asks for forward migration from `format_version: 0`; the
  engine currently refuses v0 saves with null ("refuse rather than
  half-migrate"). The test pins the refusal behavior; the engine workstream
  must add the migration (or the brief must drop the requirement).

## `src/engine/input.ts` — matches tests

- `createInput(): InputSys`; `defineAction(name, bindings: Binding[])`
  with `{type: 'key', code}` bindings; axes are action pairs via
  `defineAxis(name, negAction, posAction)` — **not** key pairs.
- `attach()` / `detach()` take no arguments and bind `window`;
  `update()` snapshots once per frame (the loop calls it in preupdate).
- `pressed()` is edge-triggered and latches a sub-frame tap via the press
  queue; `isDown()` latches; `released()` fires on key-up; auto-repeat
  never re-triggers `pressed()`; `blur` clears held keys; bound keys get
  `preventDefault()`. Unknown names read inactive, never throw.

## Demo surface (`src/main.ts`, consumed by e2e + perf harness) — NOT built yet

`src/main.ts` is still scaffold text. The demo workstream must provide:

- `window.__keel = { world, loop, input, playerId }` **plus `renderer`**
  (the three.js `WebGLRenderer`) so the perf harness can read
  `renderer.info.render.{calls,triangles}` and `renderer.getPixelRatio()`.
  Note: the engine `Loop` exposes `tick` and `paused`; `world` is the
  engine `World` (`get`/`set` by component name).
- Title screen: `[data-testid="title-screen"]` visible on boot;
  `[data-testid="start-button"]` starts the game (title hides).
- HUD: `[data-testid="hud"]` visible while playing.
- Pause: `Escape` toggles; `[data-testid="pause-menu"]` visible while
  paused, `window.__keel.loop.paused === true`, sim tick frozen. Resume via
  `Escape` again or `[data-testid="resume-button"]`.
- Game over: when the player's `Health.hp` reaches 0 (engine field name!),
  `[data-testid="game-over-screen"]` becomes visible.
- Player movement: holding `KeyW` moves the player entity's `Transform`
  (`{x,y,z,…}` fields).
- Zero console errors / pageerrors during boot and play (gated in e2e).
