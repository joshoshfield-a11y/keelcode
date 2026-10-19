//! Enemy FSM — port of `backends/ts-three/src/game/enemy.ts` (sim logic only;
//! damage flash, mesh scale punch, and group transforms are render-side).
//!
//! `ENEMY_TUNING` is verbatim. Waypoints: 5 at r=13. Per-enemy rolls use the
//! `'enemies'` stream (`hash_seed(seed, "enemies")`); roll order per enemy in
//! `spawn_initial` is angle, radius, then the waypoint roll inside `spawn`
//! (exactly the TS order: `spawnInitial` rolls a/r, `spawn` rolls wp).
//!
//! Clippy: `damage`/`update` arity mirrors the TS method signatures so the
//! parity mapping stays readable; `too_many_arguments` allowed here.
//!
#![allow(clippy::too_many_arguments)]
//! **Replicated reference bug (ADR-0006):** the TS `update` checks
//! `hp <= 0 → continue` *before* the respawn countdown, and `kill()` leaves
//! hp at 0 — so dead enemies never respawn (the respawn branch is dead
//! code). This port keeps the same check order, so the `'enemies'` stream is
//! consumed exactly like the reference (no respawn rolls ever happen).

use std::f64::consts::PI;

use glam::{DQuat, DVec3};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::components::{
    AIComp, Collider, Enemy, Health, Renderable, ShapeKind, Transform, Velocity,
};
use crate::demo::Stream;
use crate::ecs::{ComponentId, Entity, World};
use crate::physics::{BodyOpts, PhysicsSys};
use crate::rng::hash_seed;

const REST_Y: f64 = 0.85;

/// Verbatim port of the TS `ENEMY_TUNING`.
#[derive(Debug, Clone, Copy)]
pub struct EnemyTuning {
    pub hp: f64,
    pub walk_speed: f64,
    pub patrol_speed: f64,
    pub damage: f64,
    pub attack_range: f64,
    pub attack_cooldown: f64,
    pub aggro_range: f64,
    pub deaggro_range: f64,
    pub reaction_delay: f64,
    pub windup_time: f64,
    pub strike_time: f64,
    pub recover_time: f64,
    pub separation_radius: f64,
    pub separation_push: f64,
    pub count: usize,
    pub respawn_delay: f64,
    pub drop_chance: f64,
    pub waypoints: usize,
}

pub const ENEMY_TUNING: EnemyTuning = EnemyTuning {
    hp: 30.0,
    walk_speed: 3.4,
    patrol_speed: 1.7,
    damage: 12.0,
    attack_range: 2.4,
    attack_cooldown: 1.4,
    aggro_range: 12.0,
    deaggro_range: 15.6,
    reaction_delay: 0.35,
    windup_time: 0.45,
    strike_time: 0.12,
    recover_time: 0.6,
    separation_radius: 2.0,
    separation_push: 2.2,
    count: 6,
    respawn_delay: 6.0,
    drop_chance: 0.35,
    waypoints: 5,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnemyState {
    Idle,
    Patrol,
    Chase,
    Windup,
    Strike,
    Recover,
}

/// Side-table record per enemy (the TS `EnemyRec` minus render fields).
/// `state`/`t` are authoritative here and mirrored into the `AI` component's
/// blackboard for save inspection.
pub struct EnemyRec {
    pub entity: Entity,
    pub body: Option<u32>,
    pub wp: usize,
    pub state: EnemyState,
    pub t: f64,
    pub atk_cd: f64,
    pub respawn_t: f64,
    pub vx: f64,
    pub vz: f64,
    pub ry: f64,
}

/// Hooks collected during `update`/`damage`, processed by the demo after
/// (mirrors the TS `EnemyHooks` callbacks, but deferred so the borrow
/// checker stays happy).
pub enum AiHook {
    PlayerDamage { dmg: f64, x: f64, z: f64 },
    Kill { x: f64, y: f64, z: f64 },
    Drop { x: f64, z: f64 },
}

pub struct EnemySys {
    pub recs: Vec<EnemyRec>,
    waypoints: Vec<(f64, f64)>,
    rng: Stream,
}

impl EnemySys {
    pub fn new(seed: u32) -> Self {
        let mut waypoints = Vec::with_capacity(ENEMY_TUNING.waypoints);
        for i in 0..ENEMY_TUNING.waypoints {
            let a = (i as f64 / ENEMY_TUNING.waypoints as f64) * PI * 2.0;
            waypoints.push((a.cos() * 13.0, a.sin() * 13.0));
        }
        Self {
            recs: Vec::new(),
            waypoints,
            rng: Stream::new(hash_seed(seed, "enemies")),
        }
    }

    pub fn stream_state(&self) -> u32 {
        self.rng.state()
    }

    pub fn set_stream_state(&mut self, s: u32) {
        self.rng.set_state(s);
    }

    pub fn spawn(&mut self, world: &mut World, physics: &mut PhysicsSys, x: f64, z: f64) -> Entity {
        let e = world.spawn();
        world.insert(
            e,
            Transform {
                position: DVec3::new(x, REST_Y, z),
                rotation: DQuat::IDENTITY,
                scale: DVec3::ONE,
            },
        );
        world.insert(
            e,
            Velocity {
                linear: DVec3::ZERO,
                angular: DVec3::ZERO,
            },
        );
        world.insert(
            e,
            Health {
                current: ENEMY_TUNING.hp,
                max: ENEMY_TUNING.hp,
            },
        );
        world.insert(
            e,
            Collider {
                shape: ShapeKind::Capsule,
                size: vec![0.4, 0.45],
                is_trigger: false,
            },
        );
        world.insert(e, Enemy);
        world.insert(
            e,
            AIComp {
                brain_id: "chaser".into(),
                blackboard: json!({"state": "patrol", "t": 0.0, "target": 0}),
            },
        );
        world.insert(
            e,
            Renderable {
                mesh_ref: "enemy".into(),
                material_ref: "enemy".into(),
                visible: true,
            },
        );
        let body = physics.add_body(BodyOpts {
            kind: ShapeKind::Capsule,
            hx: 0.4,
            hy: 0.45,
            hz: 0.0,
            pos: DVec3::new(x, REST_Y, z),
            is_static: false,
        });
        let wp = (self.rng.next() * ENEMY_TUNING.waypoints as f64).floor() as usize;
        self.recs.push(EnemyRec {
            entity: e,
            body: Some(body),
            wp,
            state: EnemyState::Patrol,
            t: 0.0,
            atk_cd: 0.0,
            respawn_t: 0.0,
            vx: 0.0,
            vz: 0.0,
            ry: 0.0,
        });
        e
    }

    pub fn spawn_initial(&mut self, world: &mut World, physics: &mut PhysicsSys) {
        for i in 0..ENEMY_TUNING.count {
            let a = (i as f64 / ENEMY_TUNING.count as f64) * PI * 2.0 + self.rng.next() * 0.6;
            let r = 9.0 + self.rng.next() * 7.0;
            self.spawn(world, physics, a.cos() * r, a.sin() * r);
        }
    }

    pub fn alive_count(&self) -> usize {
        self.recs.iter().filter(|r| r.respawn_t <= 0.0).count()
    }

    fn sync_blackboard(&self, world: &mut World, id: Entity, rec: &EnemyRec) {
        if let Some(ai) = world.get_mut::<AIComp>(id) {
            ai.blackboard = json!({"state": rec.state, "t": rec.t, "target": 0});
        }
    }

    pub(crate) fn sync_blackboard_idx(&self, world: &mut World, idx: usize) {
        if let Some(rec) = self.recs.get(idx) {
            let id = rec.entity;
            if let Some(ai) = world.get_mut::<AIComp>(id) {
                ai.blackboard = json!({"state": rec.state, "t": rec.t, "target": 0});
            }
        }
    }

    /// Damage an enemy; on death pushes `Kill` (+ maybe `Drop`) hooks.
    /// Port of `Enemies.damage` (knockback = teleport-nudge, no velocity
    /// read in the engine API). Returns true when damage was applied.
    pub fn damage(
        &mut self,
        id: Entity,
        dmg: f64,
        kx: f64,
        kz: f64,
        world: &mut World,
        physics: &mut PhysicsSys,
        hooks: &mut Vec<AiHook>,
    ) -> bool {
        let ri = match self.recs.iter().position(|r| r.entity == id) {
            Some(i) => i,
            None => return false,
        };
        if self.recs[ri].respawn_t > 0.0 {
            return false;
        }
        let hp = match world.get_mut::<Health>(id) {
            Some(h) => {
                if h.current <= 0.0 {
                    return false;
                }
                h.current = (h.current - dmg).max(0.0);
                h.current
            }
            None => return false,
        };
        // knockback nudge
        if let Some(body) = self.recs[ri].body
            && let Some(p) = physics.get_position(body)
        {
            physics.set_kinematic_position(body, DVec3::new(p.x + kx * 0.35, p.y, p.z + kz * 0.35));
        }
        if hp <= 0.0 {
            let (ex, ez) = world
                .get::<Transform>(id)
                .map(|t| (t.position.x, t.position.z))
                .unwrap_or((0.0, 0.0));
            // drop roll hoisted before the mutable rec borrow below
            let drop = self.rng.next() < ENEMY_TUNING.drop_chance;
            let rec = &mut self.recs[ri];
            rec.respawn_t = ENEMY_TUNING.respawn_delay;
            if let Some(body) = rec.body.take() {
                physics.remove_body(body);
            }
            hooks.push(AiHook::Kill {
                x: ex,
                y: 1.0,
                z: ez,
            });
            if drop {
                hooks.push(AiHook::Drop { x: ex, z: ez });
            }
        }
        true
    }

    /// Update phase. `px,pz` = player pos; `player_alive` gates aggro.
    /// Port of `Enemies.update` — including the hp-check-before-respawn
    /// ordering (see module docs / ADR-0006).
    pub fn update(
        &mut self,
        dt: f64,
        px: f64,
        pz: f64,
        player_alive: bool,
        world: &mut World,
        physics: &mut PhysicsSys,
        hooks: &mut Vec<AiHook>,
    ) {
        let tg = ENEMY_TUNING;
        let ids = world.query(&[
            ComponentId::Enemy,
            ComponentId::Transform,
            ComponentId::AI,
            ComponentId::Health,
        ]);

        for id in &ids {
            let id = *id;
            let ri = match self.recs.iter().position(|r| r.entity == id) {
                Some(i) => i,
                None => continue,
            };
            // NOTE: hp check first — replicates the reference ordering, which
            // makes the respawn branch below unreachable (ADR-0006).
            let hp = world.get::<Health>(id).map(|h| h.current).unwrap_or(0.0);
            if hp <= 0.0 {
                continue;
            }

            // respawn countdown (dead code in practice — kept verbatim)
            if self.recs[ri].respawn_t > 0.0 {
                let done = {
                    let rec = &mut self.recs[ri];
                    rec.respawn_t -= dt;
                    rec.respawn_t <= 0.0
                };
                if done {
                    let a = self.rng.next() * PI * 2.0;
                    let r = 10.0 + self.rng.next() * 6.0;
                    let (nx, nz) = (a.cos() * r, a.sin() * r);
                    if let Some(h) = world.get_mut::<Health>(id) {
                        h.current = h.max;
                    }
                    let rec = &mut self.recs[ri];
                    rec.state = EnemyState::Patrol;
                    rec.t = 0.0;
                    let body = physics.add_body(BodyOpts {
                        kind: ShapeKind::Capsule,
                        hx: 0.4,
                        hy: 0.45,
                        hz: 0.0,
                        pos: DVec3::new(nx, REST_Y, nz),
                        is_static: false,
                    });
                    rec.body = Some(body);
                    if let Some(t) = world.get_mut::<Transform>(id) {
                        t.position = DVec3::new(nx, REST_Y, nz);
                    }
                    rec.vx = 0.0;
                    rec.vz = 0.0;
                    self.sync_blackboard(world, id, &self.recs[ri]);
                }
                continue;
            }

            let body = match self.recs[ri].body {
                Some(b) => b,
                None => continue,
            };

            // sync transform from physics
            let pp = match physics.get_position(body) {
                Some(p) => p,
                None => continue,
            };
            if let Some(t) = world.get_mut::<Transform>(id) {
                t.position = pp;
            }
            let (tx, tz) = (pp.x, pp.z);

            let dx = px - tx;
            let dz = pz - tz;
            let mut dist = dx.hypot(dz);
            if dist == 0.0 {
                dist = 0.001; // TS: `Math.hypot(dx, dz) || 0.001`
            }
            let can_see = player_alive && dist < tg.deaggro_range;

            // FSM (waypoint hoisted to dodge the rec/waypoints double borrow)
            let wp = self.waypoints[self.recs[ri].wp];
            let (sx0, sz0) = {
                let rec = &mut self.recs[ri];
                let mut sx = 0.0;
                let mut sz = 0.0;
                match rec.state {
                    EnemyState::Idle => {
                        if can_see && dist < tg.aggro_range {
                            rec.state = EnemyState::Chase;
                            rec.t = tg.reaction_delay;
                        } else {
                            rec.t -= dt;
                            if rec.t <= 0.0 {
                                rec.state = EnemyState::Patrol;
                            }
                        }
                    }
                    EnemyState::Patrol => {
                        if can_see && dist < tg.aggro_range {
                            rec.state = EnemyState::Chase;
                            rec.t = tg.reaction_delay;
                        } else {
                            let wx = wp.0 - tx;
                            let wz = wp.1 - tz;
                            let wd = wx.hypot(wz);
                            if wd < 1.2 {
                                rec.wp = (rec.wp + 1) % tg.waypoints;
                            } else {
                                sx = wx / wd * tg.patrol_speed;
                                sz = wz / wd * tg.patrol_speed;
                            }
                        }
                    }
                    EnemyState::Chase => {
                        if !can_see || dist > tg.deaggro_range {
                            rec.state = EnemyState::Patrol;
                        } else if rec.t > 0.0 {
                            rec.t -= dt; // reaction delay: face but hold
                        } else {
                            rec.atk_cd -= dt;
                            if dist < tg.attack_range && rec.atk_cd <= 0.0 {
                                rec.state = EnemyState::Windup;
                                rec.t = tg.windup_time;
                            } else {
                                sx = dx / dist * tg.walk_speed;
                                sz = dz / dist * tg.walk_speed;
                            }
                        }
                    }
                    EnemyState::Windup => {
                        rec.t -= dt;
                        if rec.t <= 0.0 {
                            rec.state = EnemyState::Strike;
                            rec.t = tg.strike_time;
                        }
                    }
                    EnemyState::Strike => {
                        rec.t -= dt;
                        if rec.t <= 0.0 {
                            if dist < tg.attack_range + 0.5 {
                                hooks.push(AiHook::PlayerDamage {
                                    dmg: tg.damage,
                                    x: tx,
                                    z: tz,
                                });
                            }
                            rec.state = EnemyState::Recover;
                            rec.t = tg.recover_time;
                            rec.atk_cd = tg.attack_cooldown;
                        }
                    }
                    EnemyState::Recover => {
                        rec.t -= dt;
                        if rec.t <= 0.0 {
                            rec.state = EnemyState::Chase;
                            rec.t = 0.0;
                        }
                    }
                }
                (sx, sz)
            };

            // separation from other live enemies (reads their transforms as
            // currently synced — ascending id order, same as the TS loop)
            let (mut sx, mut sz) = (sx0, sz0);
            for other in &ids {
                let other = *other;
                if other == id {
                    continue;
                }
                let orespawn = self
                    .recs
                    .iter()
                    .find(|r| r.entity == other)
                    .is_some_and(|r| r.respawn_t > 0.0);
                if orespawn {
                    continue;
                }
                let ot = match world.get::<Transform>(other) {
                    Some(t) => t,
                    None => continue,
                };
                let ex = tx - ot.position.x;
                let ez = tz - ot.position.z;
                let ed = ex.hypot(ez);
                if ed > 0.001 && ed < tg.separation_radius {
                    sx += ex / ed * tg.separation_push;
                    sz += ez / ed * tg.separation_push;
                }
            }

            {
                let rec = &mut self.recs[ri];
                // face travel/player
                match rec.state {
                    EnemyState::Chase | EnemyState::Windup | EnemyState::Strike => {
                        rec.ry = dx.atan2(dz);
                    }
                    _ => {
                        if sx != 0.0 || sz != 0.0 {
                            rec.ry = sx.atan2(sz);
                        }
                    }
                }
                if let Some(t) = world.get_mut::<Transform>(id) {
                    t.rotation = DQuat::from_rotation_y(rec.ry);
                }
                // smooth velocity toward steering target
                let kk = (8.0 * dt).min(1.0);
                rec.vx += (sx - rec.vx) * kk;
                rec.vz += (sz - rec.vz) * kk;
                physics.set_velocity(body, DVec3::new(rec.vx, 0.0, rec.vz));
                self.sync_blackboard(world, id, &self.recs[ri]);
            }
        }
    }
}
