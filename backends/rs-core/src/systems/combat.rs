//! Combat: pooled projectiles + health pickups.
//! Ports of `backends/ts-three/src/game/projectiles.ts` and `pickups.ts`
//! (sim logic only — instanced-mesh render mapping is not ported).
//!
//! Projectiles: pool of 64, 2 substeps per tick, sphere-vs-arena-statics
//! (r=0.13), enemy capsule approx (`dx²+dz² < 0.55`, `|dy| < 1.0` around
//! `t.y + 1.0`), life 2.0 s, dead when `life <= 0` or `y < -2`. The enemy id
//! list is queried once per update (ascending), and dead (`hp <= 0`)
//! enemies are skipped — exactly like the TS.
//!
//! Pickups: pool of 12, radius 1.15, amount 25, `taken` flag. `spawn_pickup`
//! reuses the first taken slot in insertion order, else spawns a new entity
//! (same as the TS). The `taken` flag lives in the side table because the
//! engine `PickupComp` has no such field (see ADR-0005).
//!
//! Clippy: `fire`/`update_projectiles` arity mirrors the TS signatures;
//! `too_many_arguments` allowed here deliberately.
//!
#![allow(clippy::too_many_arguments)]

use glam::DVec3;

use crate::components::{PickupComp, Renderable, Transform};
use crate::demo::{AABB, sphere_hits_static};
use crate::ecs::{ComponentId, Entity, World};

pub const PROJ_POOL: usize = 64;
const PROJ_SUBSTEPS: usize = 2;
const PROJ_RADIUS: f64 = 0.13;
const PICKUP_POOL: usize = 12;
const PICKUP_RADIUS: f64 = 1.15;

#[derive(Debug, Clone, Copy)]
pub struct ProjSlot {
    pub active: bool,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vx: f64,
    pub vy: f64,
    pub vz: f64,
    pub life: f64,
    pub dmg: f64,
}

impl Default for ProjSlot {
    fn default() -> Self {
        Self {
            active: false,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            vx: 0.0,
            vy: 0.0,
            vz: 0.0,
            life: 0.0,
            dmg: 0.0,
        }
    }
}

/// Hooks collected during `update_projectiles`, processed by the demo after
/// (mirrors the TS `ProjectileHooks`).
pub enum ProjHook {
    HitEnemy {
        id: Entity,
        dmg: f64,
        x: f64,
        y: f64,
        z: f64,
    },
    HitWorld {
        x: f64,
        y: f64,
        z: f64,
    },
}

pub struct PickupRec {
    pub entity: Entity,
    pub taken: bool,
}

/// Hooks collected during `update_pickups` (mirrors the TS `onPickup`).
pub enum PickupHook {
    Taken { amount: f64, x: f64, z: f64 },
}

pub struct CombatSys {
    pub proj: [ProjSlot; PROJ_POOL],
    pub proj_active: usize,
    pub pickups: Vec<PickupRec>,
}

impl CombatSys {
    pub fn new() -> Self {
        Self {
            proj: [ProjSlot::default(); PROJ_POOL],
            proj_active: 0,
            pickups: Vec::new(),
        }
    }

    /// Fire from the first inactive pool slot (no-op when the pool is full).
    /// Port of `Projectiles.fire`.
    pub fn fire(
        &mut self,
        fx: f64,
        fy: f64,
        fz: f64,
        dx: f64,
        dy: f64,
        dz: f64,
        speed: f64,
        damage: f64,
        life: f64,
    ) {
        for s in self.proj.iter_mut() {
            if s.active {
                continue;
            }
            s.active = true;
            s.x = fx;
            s.y = fy;
            s.z = fz;
            s.vx = dx * speed;
            s.vy = dy * speed;
            s.vz = dz * speed;
            s.life = life;
            s.dmg = damage;
            self.proj_active += 1;
            return;
        }
    }

    pub fn clear_projectiles(&mut self) {
        for s in self.proj.iter_mut() {
            s.active = false;
        }
        self.proj_active = 0;
    }

    /// Port of `Projectiles.update`.
    pub fn update_projectiles(
        &mut self,
        dt: f64,
        world: &mut World,
        statics: &[AABB],
        hooks: &mut Vec<ProjHook>,
    ) {
        let sdt = dt / PROJ_SUBSTEPS as f64;
        let enemy_ids = world.query(&[
            ComponentId::Enemy,
            ComponentId::Transform,
            ComponentId::Health,
        ]);
        for i in 0..PROJ_POOL {
            if !self.proj[i].active {
                continue;
            }
            let s = &mut self.proj[i];
            s.life -= dt;
            let mut dead = s.life <= 0.0 || s.y < -2.0;
            for _ in 0..PROJ_SUBSTEPS {
                if dead {
                    break;
                }
                s.x += s.vx * sdt;
                s.y += s.vy * sdt;
                s.z += s.vz * sdt;
                if sphere_hits_static(s.x, s.y, s.z, PROJ_RADIUS, statics) {
                    hooks.push(ProjHook::HitWorld {
                        x: s.x,
                        y: s.y,
                        z: s.z,
                    });
                    dead = true;
                    break;
                }
                // enemy capsule approx: center y+1.0, radius² 0.55, |dy| < 1.0
                for k in &enemy_ids {
                    let (tx, ty, tz) = match world.get::<Transform>(*k) {
                        Some(t) => (t.position.x, t.position.y, t.position.z),
                        None => continue,
                    };
                    let hp = world
                        .get::<crate::components::Health>(*k)
                        .map(|h| h.current)
                        .unwrap_or(0.0);
                    if hp <= 0.0 {
                        continue;
                    }
                    let dx = s.x - tx;
                    let dz = s.z - tz;
                    let dy = s.y - (ty + 1.0);
                    if dx * dx + dz * dz < 0.55 && dy > -1.0 && dy < 1.0 {
                        hooks.push(ProjHook::HitEnemy {
                            id: *k,
                            dmg: s.dmg,
                            x: s.x,
                            y: s.y,
                            z: s.z,
                        });
                        dead = true;
                        break;
                    }
                }
            }
            if dead {
                s.active = false;
                self.proj_active -= 1;
            }
        }
    }

    /// Port of `Pickups.spawn`.
    pub fn spawn_pickup(&mut self, world: &mut World, x: f64, z: f64, amount: f64) {
        for rec in self.pickups.iter_mut() {
            if rec.taken {
                rec.taken = false;
                if let Some(p) = world.get_mut::<PickupComp>(rec.entity) {
                    p.value = amount;
                }
                if let Some(t) = world.get_mut::<Transform>(rec.entity) {
                    t.position.x = x;
                    t.position.z = z;
                }
                return;
            }
        }
        if self.pickups.len() >= PICKUP_POOL {
            return;
        }
        let e = world.spawn();
        world.insert(
            e,
            Transform {
                position: DVec3::new(x, 0.0, z),
                rotation: glam::DQuat::IDENTITY,
                scale: DVec3::ONE,
            },
        );
        world.insert(
            e,
            PickupComp {
                effect_id: "health".into(),
                value: amount,
            },
        );
        world.insert(
            e,
            Renderable {
                mesh_ref: "pickup".into(),
                material_ref: "pickup".into(),
                visible: true,
            },
        );
        self.pickups.push(PickupRec {
            entity: e,
            taken: false,
        });
    }

    /// Port of `Pickups.update` (proximity only; bob/spin is render-side).
    pub fn update_pickups(
        &mut self,
        _dt: f64,
        px: f64,
        pz: f64,
        world: &mut World,
        hooks: &mut Vec<PickupHook>,
    ) {
        let r2 = PICKUP_RADIUS * PICKUP_RADIUS;
        for rec in self.pickups.iter_mut() {
            if rec.taken {
                continue;
            }
            let (tx, tz, amount) = match (
                world.get::<Transform>(rec.entity),
                world.get::<PickupComp>(rec.entity),
            ) {
                (Some(t), Some(p)) => (t.position.x, t.position.z, p.value),
                _ => continue,
            };
            let dx = px - tx;
            let dz = pz - tz;
            if dx * dx + dz * dz < r2 {
                rec.taken = true;
                hooks.push(PickupHook::Taken {
                    amount,
                    x: tx,
                    z: tz,
                });
            }
        }
    }
}

impl Default for CombatSys {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Projectile-vs-enemy capsule approximation, unit-checked against the
    /// TS `projectiles.ts` predicate (see the vitest twin in
    /// `backends/ts-three/tests/projectiles.parity.test.ts` when the
    /// full-run combat vectors are unavailable).
    #[test]
    fn capsule_predicate_matches_ts() {
        // (proj xyz, enemy xyz) -> expected hit
        type Case = ((f64, f64, f64), (f64, f64, f64), bool);
        let cases: Vec<Case> = vec![
            ((0.0, 1.85, 0.0), (0.0, 0.85, 0.0), true),  // dead center
            ((0.74, 1.85, 0.0), (0.0, 0.85, 0.0), true), // dx² = 0.5476 < 0.55
            ((0.75, 1.85, 0.0), (0.0, 0.85, 0.0), false), // dx² = 0.5625 > 0.55
            ((0.0, 2.86, 0.0), (0.0, 0.85, 0.0), false), // dy = 1.01 > 1.0
            ((0.0, 2.84, 0.0), (0.0, 0.85, 0.0), true),  // dy = 0.99 < 1.0
            ((0.0, 0.84, 0.0), (0.0, 0.85, 0.0), false), // dy = -1.01 < -1.0
            ((0.5, 1.0, 0.5), (0.0, 0.85, 0.0), true),   // dx²+dz² = 0.5 < 0.55, dy = -0.85
        ];
        for ((px, py, pz), (ex, ey, ez), want) in cases {
            let dx = px - ex;
            let dz = pz - ez;
            let dy = py - (ey + 1.0);
            let got = dx * dx + dz * dz < 0.55 && dy > -1.0 && dy < 1.0;
            assert_eq!(got, want, "proj ({px},{py},{pz}) vs enemy ({ex},{ey},{ez})");
        }
    }

    #[test]
    fn fire_uses_first_inactive_slot() {
        let mut c = CombatSys::new();
        c.fire(0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 26.0, 25.0, 2.0);
        c.fire(1.0, 1.0, 1.0, 0.0, 1.0, 0.0, 26.0, 25.0, 2.0);
        assert_eq!(c.proj_active, 2);
        assert!(c.proj[0].active && c.proj[1].active && !c.proj[2].active);
        assert_eq!((c.proj[0].x, c.proj[0].vx), (0.0, 26.0));
        // pool exhaustion is a silent no-op, like the TS
        for _ in 0..70 {
            c.fire(0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 26.0, 25.0, 2.0);
        }
        assert_eq!(c.proj_active, PROJ_POOL);
    }

    #[test]
    fn pickup_reuse_prefers_taken_slot() {
        let mut world = World::new();
        let mut c = CombatSys::new();
        c.spawn_pickup(&mut world, 6.0, -4.0, 25.0);
        let first = c.pickups[0].entity;
        c.pickups[0].taken = true;
        c.spawn_pickup(&mut world, 9.0, 9.0, 25.0);
        assert_eq!(c.pickups.len(), 1);
        assert_eq!(c.pickups[0].entity, first);
        assert!(!c.pickups[0].taken);
        let t = world.get::<Transform>(first).unwrap();
        assert_eq!((t.position.x, t.position.z), (9.0, 9.0));
    }
}
