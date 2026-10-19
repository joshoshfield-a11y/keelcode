# ADR 0008 — Pin `@babylonjs/core` to `9.31.0` and `@babylonjs/havok` to `1.3.14`

Date: 2026-10-19. Status: accepted.

## Context

Wave 3 (Babylon.js backend, `backends/ts-babylon/`) needs Havok physics
behind the same driver boundary the ts-three reference backend exposes
(`backends/ts-three/src/engine/physics.ts`), implemented in
`backends/ts-babylon/src/engine/physics.ts`. The Wave 3 brief proposed
keeping `@babylonjs/core` and `@babylonjs/havok` "on the same minor
version" on the premise that Babylon republishes all first-party packages
in lockstep. That premise is wrong: `@babylonjs/havok` has always been
versioned 1.x with its own scheme — it is a thin Emscripten-binding package
around the Havok WASM build, not a lockstep republication of core.

## Decision

Pin both packages **exactly** (no caret) in
`backends/ts-babylon/package.json`:

- `@babylonjs/core`: `9.31.0`
- `@babylonjs/havok`: `1.3.14`

## Rationale

- **ABI, not version lockstep, is the real contract.** The core-side
  `HavokPlugin` (shipped inside `@babylonjs/core`) drives the WASM module
  through the `HP_*` Emscripten function surface (`HP_World_Step`,
  `HP_Body_SetQTransform`, `HP_Shape_CreateBox`, …). The pair works if and
  only if the plugin JS and the WASM build agree on that ABI. There is no
  published compatibility matrix; the pin *is* the matrix.
- **Version evidence.** npm registry checked 2026-10-19: 1.3.14 is the
  current `@babylonjs/havok` 1.x; 9.31.0 is a current 9.x core. The pair
  was verified working, not assumed: headless Chromium boots the WASM
  with SIMD in ~243 ms and world+step succeeds (pre-flight), and a
  purpose-built probe against the installed packages confirmed
  `new HavokPlugin(false, await HavokPhysics({ locateFile }))` boots,
  shapes construct, and `plugin.executeStep(1/60, bodies)` advances the
  world exactly one fixed step per call.
- **Exact pin, no caret.** Babylon core ships fast-moving 9.x minors; a
  floating range could silently pull a plugin-JS/WASM ABI skew or a
  behavior change (e.g. prestep defaults) with no code diff on our side.
  Reproducible installs beat convenient upgrades for a physics driver.
- **WASM loading pattern pinned with the versions:** the WASM file lives
  at `@babylonjs/havok/lib/esm/HavokPhysics.wasm` (2,094,563 bytes),
  imported via Vite `?url` and handed to the module factory as
  `locateFile: () => havokWasmUrl`; `optimizeDeps.exclude` keeps the dev
  optimizer from pre-bundling it. If a future havok version moves the
  file, the pin makes the break loud at install time.

## Consequences

- `npm install` in `backends/ts-babylon/` resolves deterministically;
  `package-lock.json` is committed alongside.
- **Residual risk (kept, not hidden):** the pin does not prove the ABI
  stays stable *across* Babylon releases — upgrading either package
  requires re-running the boot + fixed-step probe, not just a version
  bump. There is no upstream promise that havok 1.3.15 keeps the same
  `HP_*` surface the 9.31.0 plugin expects.
- **Residual risk:** Havok WASM requires WebAssembly SIMD (iOS < 16.4
  unsupported). Physics e2e cannot run on those devices; the gate moves
  to real hardware there. The ~2 MB WASM is a real download cost on top
  of the Babylon core bundle — recorded, not hidden (brief gate).
- **Behavioral note, not a version issue:** Havok does not apply gravity
  to `ANIMATED` (kinematic) bodies and does not block them against static
  geometry — the controller above the driver owns vertical motion and
  ground contact, same ownership the Rapier backend's teleport-driven
  character model has. Documented in `src/engine/physics.ts`; the
  feel-tuning pass the Wave 3 brief flags is where this lands.
