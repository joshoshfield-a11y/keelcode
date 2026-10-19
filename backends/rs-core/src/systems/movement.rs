//! Player controller sim logic — port of `backends/ts-three/src/game/player.ts`
//! minus rendering (mesh, FOV kick, sprint FOV, drag-look are render-side and
//! intentionally not ported; the camera math that feeds fire direction IS
//! ported — see [`PlayerController::update_camera`]).
//!
//! Clippy: `update` arity mirrors the TS `Player.update` dependency list
//! (input, world, physics, camera, combat, audio); `too_many_arguments`
//! allowed here deliberately.
//!
#![allow(clippy::too_many_arguments)]
//!
//! Faithful details:
//! - camera-relative wish dir from the `moveX`/`moveY` axes, sprint on
//!   `sprint` + `moveY > 0.1`, arcade velocity smoothing
//!   `k = min(1, (grounded ? 14 : 5) * dt)`.
//! - coyote 0.1 s + jump buffer 0.12 s, `JUMP_VEL = 4.9`, `REST_Y = 0.85`,
//!   `grounded = phys_y <= REST_Y + 0.07`.
//! - fire cooldown 0.18 s; fire origin `(t.x, t.y + 1.5, t.z)`, direction =
//!   camera forward `normalize(target - cam_pos)` (three.js `lookAt` points
//!   the camera's -Z at the target, so this is exactly what
//!   `(0,0,-1).applyQuaternion(camera.quaternion)` computes).
//! - facing `ry = atan2(wish.x, wish.z)` on the *scaled* wish (same value as
//!   the unscaled one for positive speed).
//! - yaw = π, pitch = -0.18 initial.
//!
//! Deliberate simplifications (documented, no sim effect in the headless
//! harness):
//! - `canFire` (pointer-lock / touch gate) is always true: the headless
//!   backend has no pointer lock. The parity scripts only contain `fire`
//!   events when the TS recorder verified the TS side could fire.
//! - `suppressUntil` (UI-click input suppression) is always expired: the
//!   recorder waits it out before stepping.

use glam::{DQuat, DVec3};

use crate::audio::AudioDriver;
use crate::components::{
    Collider, Health, InputMarker, Player, Renderable, ShapeKind, Transform, Velocity,
};
use crate::demo::{AABB, raycast_statics};
use crate::ecs::{Entity, World};
use crate::input::InputSys;
use crate::physics::{BodyOpts, PhysicsSys};

use super::combat::CombatSys;

const WALK: f64 = 5.2;
const SPRINT: f64 = 7.8;
const JUMP_VEL: f64 = 4.9;
const COYOTE: f64 = 0.1;
const BUFFER: f64 = 0.12;
const REST_Y: f64 = 0.85;
const CAM_DIST: f64 = 4.6;
const CAM_HEIGHT: f64 = 1.7;
const FIRE_COOLDOWN: f64 = 0.18;
const PROJ_SPEED: f64 = 26.0;
const PROJ_DAMAGE: f64 = 25.0;
const PROJ_LIFE: f64 = 2.0;

/// Smoothed third-person camera state. `pos` is the only camera state the
/// sim needs (fire direction + renderer snapshot derive from it).
#[derive(Debug, Clone)]
pub struct CameraState {
    pub pos: DVec3,
}

impl CameraState {
    /// Camera forward = normalize(target - pos), exactly the direction
    /// three.js `lookAt(target)` gives the camera's -Z axis.
    pub fn forward(&self, target: DVec3) -> DVec3 {
        (target - self.pos).normalize()
    }
}

/// Player controller. Owns the entity id, the Rapier body id, and all feel
/// state (the TS `Player`'s private fields).
pub struct PlayerController {
    pub entity: Entity,
    pub body: Option<u32>,
    pub yaw: f64,
    pub pitch: f64,
    pub vx: f64,
    pub vz: f64,
    pub coyote: f64,
    pub buffer: f64,
    pub fire_cd: f64,
    pub was_grounded: bool,
    pub dip: f64,
    pub ry: f64,
}

impl PlayerController {
    pub fn new(world: &mut World, physics: &mut PhysicsSys, x: f64, z: f64) -> Self {
        let e = world.spawn();
        world.insert(
            e,
            Transform {
                position: DVec3::new(x, REST_Y, z),
                rotation: DQuat::from_rotation_y(std::f64::consts::PI),
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
                current: 100.0,
                max: 100.0,
            },
        );
        world.insert(
            e,
            Collider {
                shape: ShapeKind::Capsule,
                size: vec![0.35, 0.5],
                is_trigger: false,
            },
        );
        world.insert(e, Player);
        world.insert(e, InputMarker { marker: true });
        world.insert(
            e,
            Renderable {
                mesh_ref: "player".into(),
                material_ref: "player".into(),
                visible: true,
            },
        );
        let body = physics.add_body(BodyOpts {
            kind: ShapeKind::Capsule,
            hx: 0.35,
            hy: 0.5,
            hz: 0.0,
            pos: DVec3::new(x, REST_Y, z),
            is_static: false,
        });
        Self {
            entity: e,
            body: Some(body),
            yaw: std::f64::consts::PI,
            pitch: -0.18,
            vx: 0.0,
            vz: 0.0,
            coyote: 0.0,
            buffer: 0.0,
            fire_cd: 0.0,
            was_grounded: true,
            dip: 0.0,
            ry: std::f64::consts::PI,
        }
    }

    pub fn alive(&self, world: &World) -> bool {
        world
            .get::<Health>(self.entity)
            .is_some_and(|h| h.current > 0.0)
    }

    pub fn hp(&self, world: &World) -> f64 {
        world
            .get::<Health>(self.entity)
            .map(|h| h.current)
            .unwrap_or(0.0)
    }

    /// Inflict damage. Returns the new hp (0 when already dead — no-op).
    pub fn damage(&mut self, world: &mut World, amount: f64) -> f64 {
        let Some(h) = world.get_mut::<Health>(self.entity) else {
            return 0.0;
        };
        if h.current <= 0.0 {
            return 0.0;
        }
        h.current = (h.current - amount).max(0.0);
        h.current
    }

    pub fn heal(&mut self, world: &mut World, amount: f64) {
        if let Some(h) = world.get_mut::<Health>(self.entity) {
            h.current = (h.current + amount).min(h.max);
        }
    }

    /// Camera position with the controller snapped behind the player
    /// (spawn / load), mirroring `Player.snapCamera`.
    pub fn snap_cam_pos(&self, world: &World) -> DVec3 {
        let t = world
            .get::<Transform>(self.entity)
            .map(|t| t.position)
            .unwrap_or(DVec3::ZERO);
        let (sp, cp) = self.pitch.sin_cos();
        let (sy, cy) = self.yaw.sin_cos();
        DVec3::new(
            t.x + sy * cp * CAM_DIST,
            t.y + CAM_HEIGHT - sp * CAM_DIST,
            t.z + cy * cp * CAM_DIST,
        )
    }

    /// Update phase: movement intent + jump + fire. Physics steps after.
    /// Port of `Player.update` (minus render mapping / FOV / audio).
    pub fn update(
        &mut self,
        dt: f64,
        input: &InputSys,
        world: &mut World,
        physics: &mut PhysicsSys,
        cam: &CameraState,
        combat: &mut CombatSys,
        audio: &mut dyn AudioDriver,
    ) {
        if !self.alive(world) {
            return;
        }
        let body = match self.body {
            Some(b) => b,
            None => return,
        };
        let p = match physics.get_position(body) {
            Some(p) => p,
            None => return,
        };
        if let Some(t) = world.get_mut::<Transform>(self.entity) {
            t.position = p;
        }
        let grounded = p.y <= REST_Y + 0.07;

        // wish direction, camera-relative
        let mx = input.axis("moveX");
        let mz = input.axis("moveY");
        let (sy, cy) = self.yaw.sin_cos();
        let mut wx = mx * cy - mz * sy;
        let mut wz = -mx * sy - mz * cy;
        let len2 = wx * wx + wz * wz;
        if len2 > 1.0 {
            let l = len2.sqrt();
            wx /= l;
            wz /= l;
        }
        let sprinting = input.is_down("sprint") && mz > 0.1;
        let speed = if sprinting { SPRINT } else { WALK };
        wx *= speed;
        wz *= speed;

        // smooth horizontal velocity toward wish (arcade accel)
        let k = ((if grounded { 14.0 } else { 5.0 }) * dt).min(1.0);
        self.vx += (wx - self.vx) * k;
        self.vz += (wz - self.vz) * k;

        // coyote + jump buffer
        if grounded {
            self.coyote = COYOTE;
        } else {
            self.coyote -= dt;
        }
        if input.pressed("jump") {
            self.buffer = BUFFER;
        } else {
            self.buffer -= dt;
        }
        let mut vy = 0.0;
        if self.buffer > 0.0 && self.coyote > 0.0 {
            vy = JUMP_VEL;
            self.buffer = 0.0;
            self.coyote = 0.0;
            audio.play("jump");
        }
        physics.set_velocity(body, DVec3::new(self.vx, vy, self.vz));

        // landing dip (feeds the camera smoothing below)
        if !self.was_grounded && grounded {
            self.dip = 0.14;
        }
        self.was_grounded = grounded;

        // face movement direction
        if mx != 0.0 || mz != 0.0 {
            self.ry = wx.atan2(wz);
            if let Some(t) = world.get_mut::<Transform>(self.entity) {
                t.rotation = DQuat::from_rotation_y(self.ry);
            }
        }

        // fire (headless: no pointer-lock gate — see module docs)
        self.fire_cd -= dt;
        if self.fire_cd <= 0.0 && (input.pressed("fire") || input.is_down("fire")) {
            self.fire_cd = FIRE_COOLDOWN;
            let target = DVec3::new(p.x, p.y + CAM_HEIGHT, p.z);
            let fwd = cam.forward(target);
            combat.fire(
                p.x,
                p.y + 1.5,
                p.z,
                fwd.x,
                fwd.y,
                fwd.z,
                PROJ_SPEED,
                PROJ_DAMAGE,
                PROJ_LIFE,
            );
            audio.play("shoot");
        }
    }

    /// Postupdate: smoothed follow camera with collision-avoidance raycast.
    /// Port of `Player.updateCamera` (minus FOV / lookAt — the forward vector
    /// is derived from `cam.pos` on demand).
    pub fn update_camera(
        &mut self,
        dt: f64,
        world: &World,
        statics: &[AABB],
        cam: &mut CameraState,
    ) {
        let t = match world.get::<Transform>(self.entity) {
            Some(t) => t.position,
            None => return,
        };
        let (sp, cp) = self.pitch.sin_cos();
        let (sy, cy) = self.yaw.sin_cos();

        let target = DVec3::new(t.x, t.y + CAM_HEIGHT, t.z);
        let dir = DVec3::new(sy * cp, -sp, cy * cp); // from target toward camera
        let mut dist = CAM_DIST;
        let hit = raycast_statics(
            target.x, target.y, target.z, dir.x, dir.y, dir.z, CAM_DIST, statics,
        );
        if hit < dist {
            dist = (hit - 0.25).max(0.6);
        }

        let mut desired = target + dir * dist;
        self.dip = (self.dip - dt * 0.9).max(0.0);
        desired.y -= self.dip;

        let kk = 1.0 - (-14.0 * dt).exp();
        cam.pos += (desired - cam.pos) * kk;
    }

    /// Teleport the body + transform (save/load, reset).
    pub fn teleport(&mut self, world: &mut World, physics: &mut PhysicsSys, p: DVec3) {
        if let Some(t) = world.get_mut::<Transform>(self.entity) {
            t.position = p;
        }
        if let Some(b) = self.body {
            physics.set_kinematic_position(b, p);
            physics.set_velocity(b, DVec3::ZERO);
        }
        self.vx = 0.0;
        self.vz = 0.0;
    }
}
