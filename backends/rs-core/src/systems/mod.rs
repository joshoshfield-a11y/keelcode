//! Game systems for the arena demo (Wave 2a). Implemented by the demo workstream:
//! ports of the TS reference's `player.ts` / `enemy.ts` / `projectiles.ts` /
//! `pickups.ts` sim logic, minus rendering. See `demo.rs` (sibling of this
//! module) for assembly and `INTERFACE.md` for the contracts.

pub mod ai;
pub mod combat;
pub mod lifetime;
pub mod movement;
