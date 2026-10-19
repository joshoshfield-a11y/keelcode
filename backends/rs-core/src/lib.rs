//! KeelCode Rust backend (`keel-rs`) — Wave 2a headless sim.
//!
//! Implements `framework/SPEC.md` v1: fixed 60 Hz loop with named phases,
//! archetype-flavored ECS, seeded RNG, action input, Rapier physics behind
//! the driver boundary, null audio, JSON saves. See `INTERFACE.md` for the
//! module contracts and `~/workspace/game-kb/WAVE2-BRIEF.md` for the wave plan.
//!
//! Cross-cutting rules (enforced in review, not just written here):
//! - Sim math is `f64` everywhere (glam `DVec3`/`DQuat`). No `f32` in sim code
//!   except inside `physics.rs` at the Rapier boundary.
//! - NO `HashMap` iteration in sim code — Rust randomizes iteration order.
//!   Use `BTreeMap`, sorted `Vec`s, or index by entity id. (Spec §1 test rule.)
//! - No `bevy` crate: the ECS is in-house per the architecture decision.
//! - No panics on sim paths: `Option`/`Result`, fail clean like the TS side.

pub mod audio;
pub mod components;
pub mod demo;
pub mod ecs;
pub mod input;
pub mod physics;
pub mod render;
pub mod rng;
pub mod save;
pub mod sim_loop;
pub mod systems;
