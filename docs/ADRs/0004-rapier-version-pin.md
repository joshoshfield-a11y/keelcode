# ADR 0004 — Pin `rapier3d` to `=0.22.0` for the Rust backend

Date: 2026-10-19. Status: accepted.

## Context

Wave 2a (Rust headless sim) must mirror the ts-three reference backend's
physics exactly. The reference uses `@dimforge/rapier3d-compat` 0.14.0
(see `backends/ts-three/src/engine/physics.ts`), and the Rust side needs
the same engine under `INTERFACE.md`'s driver boundary.

## Decision

Pin `rapier3d = "=0.22.0"` in `backends/rs-core/Cargo.toml`.

## Rationale

- **Version evidence.** Per the rapier.js CHANGELOG (2024-07-20),
  `@dimforge/rapier3d-compat` 0.14.0 — the exact package the TS
  reference depends on — wraps upstream rapier **0.22**. Same engine,
  same release: the closest behavioral match possible.
- **f32 on both sides.** The crates.io metadata for `rapier3d` 0.22.0
  confirms the only available features are `f32`-family ones — there is
  **no `f64` feature** in 0.22. The TS side's WASM build is f32 as well
  (its compat bundle has no f64 build either). So: f32 inside Rapier on
  both backends, f64 sim math (`glam::DVec3`) in our code, conversion at
  the boundary. This is a deliberate match, not a concession.
- **API verified, not guessed.** The 0.22 Rust API was checked against
  docs.rs and the 0.22.0 crate source before writing
  `src/physics.rs`. Notable: the Rust builders are `RigidBodyBuilder` /
  `ColliderBuilder` (the `RigidBodyDesc`/`ColliderDesc` names exist only
  in the rapier.js TS API); `RigidBodyBuilder::translation` takes a
  `Vector<Real>`, not `(x, y, z)`; `PhysicsPipeline::step` takes
  `&mut dyn BroadPhase` plus `&dyn PhysicsHooks` / `&dyn EventHandler`
  (`&()` is the no-op pair); capsule shape uses
  `ColliderBuilder::capsule_y(half_height, radius)`.

## Consequences

- The mapping table in `INTERFACE.md` §physics is exact and is asserted
  by `tests/physics.rs` (fall-and-rest, exact teleport, removal).
- **Residual risk (kept, not hidden):** WASM vs native float evaluation
  order can still diverge in edge cases (denormals, long contact
  chains, solver iteration order) even with the same engine at f32.
  Parity can't be proved from the pin — only measured. The
  cross-backend parity smoke tests (`tests/parity.rs`, outcome vector
  vs the TS reference vectors) are the tripwire; if a wave's vectors
  drift, this pin is the first suspect.
