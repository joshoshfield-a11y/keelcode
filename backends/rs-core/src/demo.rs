//! Arena demo assembly — headless port of `backends/ts-three/src/main.ts`
//! (composition root) plus `src/game/arena.ts` (statics, pillars, raycast).
//!
//! Clippy: arity (`ray_aabb`, `add_static_box`, …) mirrors the TS reference
//! signatures one-for-one; bundling them into structs would hide the parity
//! mapping, so `too_many_arguments` is allowed here deliberately.
//!
#![allow(clippy::too_many_arguments)]
//! ## Outcome vector shape
//!
//! `Demo::outcome_vector` returns JSON:
//! ```json
//! {
//!   "seed": 1337, "ticks": 600, "score": 200,
//!   "player": {"hp": 100.0, "x": 0.0, "y": 0.85, "z": 8.0},
//!   "enemies": [{"x": 1.0, "z": 2.0, "hp": 30.0, "state": "patrol"}],
//!   "kills": 2, "pickups_taken": 1, "projectiles_active": 3,
//!   "events": [{"tick": 123, "kind": "kill", "detail": {"x": 1.0, "y": 1.0, "z": 2.0}}]
//! }
//! ```
//! Event kinds: `kill`, `pickup`, `damage`, `death`. Enemy entries cover
//! live enemies only (dead ones keep components but are skipped — same as
//! the TS `Enemies.serialize`). `projectiles_active` is the live pool
//! count.
//!
//! ## Phase wiring
//!
//! `bind_phases` registers: PreUpdate → `input.update(tick)` (the scripted
//! input snapshot, at the *current* tick); Update → the sim in main.ts
//! order (player → enemies → projectiles → pickups → physics.step(1/60),
//! gated on `mode == Playing`); PostUpdate → pause latch, reactive death
//! check, camera. `step()` is `loop.step()`, i.e. *input.update at the
//! current tick → one 1/60 sim step* — the exact semantics the task
//! requires, shared with the wall-clock `frame()` path the desktop binary
//! will use.
//!
//! ## Save/load vs the TS reference (ADR-0005)
//!
//! The TS `doSave` persists only Transform/Health/AI/Pickup components +
//! score — it does NOT persist rng stream state, controller state
//! (yaw/pitch/vx/vz/coyote/buffer/fire_cd), enemy side-table state
//! (wp/atk_cd/respawn_t/vx/vz), the projectile pool, or input script
//! position. That is fine for a user checkpoint but cannot resume
//! bit-exactly. This port persists EVERYTHING in `SaveData.extra` (stream
//! states as u32, full controller/enemy/projectile/pickup/input state), so
//! the round-trip test (300 ticks → save → fresh → load → 300 ticks) is
//! bit-identical to an uninterrupted 600-tick run.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::f64::consts::PI;
use std::rc::Rc;

use glam::DVec3;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::audio::{AudioDriver, NullAudio};
use crate::components::{
    AIComp, Enemy, Health, PickupComp, Renderable, ShapeKind, Transform, Velocity,
};
use crate::ecs::{Entity, World};
use crate::input::InputSys;
use crate::physics::{BodyOpts, PhysicsSys};
use crate::rng::hash_seed;
use crate::save::{CURRENT_VERSION, SaveData};
use crate::sim_loop::{FrameCtx, GameLoop, Phase};
use crate::systems::ai::{AiHook, EnemyState, EnemySys};
use crate::systems::combat::{CombatSys, PickupHook, ProjHook};
use crate::systems::movement::{CameraState, PlayerController};

pub const MASTER_SEED: u32 = 1337;
const ARENA_HALF: f64 = 20.0;

// ---------------------------------------------------------------------------
// RNG stream with observable state
// ---------------------------------------------------------------------------

/// mulberry32 stream with observable state (for exact save/load).
///
/// The recipe is bit-identical to [`crate::rng::mulberry32`] — see the
/// `stream_matches_rng_crate` test. Kept here (not in `rng.rs`, which belongs
/// to another workstream) so the demo can snapshot stream state as u32.
#[derive(Debug, Clone)]
pub struct Stream {
    state: i32,
}

impl Stream {
    pub fn new(seed: u32) -> Self {
        Self { state: seed as i32 }
    }

    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B_79F5u32 as i32);
        let s: u32 = self.state as u32;
        let mut t: i32 = ((s ^ (s >> 15)) as i32).wrapping_mul((1u32 | s) as i32);
        let tu: u32 = t as u32;
        t = t.wrapping_add(((tu ^ (tu >> 7)) as i32).wrapping_mul((61u32 | tu) as i32)) ^ t;
        let out: u32 = t as u32;
        ((out ^ (out >> 14)) as f64) / 4294967296.0
    }

    pub fn state(&self) -> u32 {
        self.state as u32
    }

    pub fn set_state(&mut self, s: u32) {
        self.state = s as i32;
    }
}

// ---------------------------------------------------------------------------
// Arena statics: AABB list + raycast (port of arena.ts)
// ---------------------------------------------------------------------------

/// Axis-aligned bounding box (the TS `AABB`).
#[derive(Debug, Clone, Copy)]
pub struct AABB {
    minx: f64,
    miny: f64,
    minz: f64,
    maxx: f64,
    maxy: f64,
    maxz: f64,
}

/// Segment vs AABB; nearest hit distance or `INFINITY`. Verbatim port of the
/// TS `rayAABB` (slab method, `tmin`/`tmax` threading, 1e-9 parallel guard).
pub fn ray_aabb(
    ox: f64,
    oy: f64,
    oz: f64,
    dx: f64,
    dy: f64,
    dz: f64,
    b: &AABB,
    max_dist: f64,
) -> f64 {
    let mut tmin: f64 = 0.0;
    let mut tmax: f64 = max_dist;
    // x
    if dx.abs() < 1e-9 {
        if ox < b.minx || ox > b.maxx {
            return f64::INFINITY;
        }
    } else {
        let (mut t1, mut t2) = ((b.minx - ox) / dx, (b.maxx - ox) / dx);
        if t1 > t2 {
            std::mem::swap(&mut t1, &mut t2);
        }
        tmin = tmin.max(t1);
        tmax = tmax.min(t2);
        if tmin > tmax {
            return f64::INFINITY;
        }
    }
    // y
    if dy.abs() < 1e-9 {
        if oy < b.miny || oy > b.maxy {
            return f64::INFINITY;
        }
    } else {
        let (mut t1, mut t2) = ((b.miny - oy) / dy, (b.maxy - oy) / dy);
        if t1 > t2 {
            std::mem::swap(&mut t1, &mut t2);
        }
        tmin = tmin.max(t1);
        tmax = tmax.min(t2);
        if tmin > tmax {
            return f64::INFINITY;
        }
    }
    // z
    if dz.abs() < 1e-9 {
        if oz < b.minz || oz > b.maxz {
            return f64::INFINITY;
        }
    } else {
        let (mut t1, mut t2) = ((b.minz - oz) / dz, (b.maxz - oz) / dz);
        if t1 > t2 {
            std::mem::swap(&mut t1, &mut t2);
        }
        tmin = tmin.max(t1);
        tmax = tmax.min(t2);
        if tmin > tmax {
            return f64::INFINITY;
        }
    }
    tmin
}

/// Segment vs all static AABBs; nearest hit distance or `INFINITY`.
pub fn raycast_statics(
    ox: f64,
    oy: f64,
    oz: f64,
    dx: f64,
    dy: f64,
    dz: f64,
    max_dist: f64,
    statics: &[AABB],
) -> f64 {
    let mut best = f64::INFINITY;
    for b in statics {
        let t = ray_aabb(ox, oy, oz, dx, dy, dz, b, max_dist);
        if t < best {
            best = t;
        }
    }
    best
}

/// Sphere vs static AABBs. Verbatim port of the TS `sphereHitsStatic`.
pub fn sphere_hits_static(x: f64, y: f64, z: f64, r: f64, statics: &[AABB]) -> bool {
    for b in statics {
        let cx = b.minx.max(x.min(b.maxx));
        let cy = b.miny.max(y.min(b.maxy));
        let cz = b.minz.max(z.min(b.maxz));
        let (ddx, ddy, ddz) = (x - cx, y - cy, z - cz);
        if ddx * ddx + ddy * ddy + ddz * ddz < r * r {
            return true;
        }
    }
    false
}

fn add_static_box(
    statics: &mut Vec<AABB>,
    physics: &mut PhysicsSys,
    minx: f64,
    miny: f64,
    minz: f64,
    maxx: f64,
    maxy: f64,
    maxz: f64,
) {
    statics.push(AABB {
        minx,
        miny,
        minz,
        maxx,
        maxy,
        maxz,
    });
    physics.add_body(BodyOpts {
        kind: ShapeKind::Box,
        hx: (maxx - minx) / 2.0,
        hy: (maxy - miny) / 2.0,
        hz: (maxz - minz) / 2.0,
        pos: DVec3::new(
            (minx + maxx) / 2.0,
            (miny + maxy) / 2.0,
            (minz + maxz) / 2.0,
        ),
        is_static: true,
    });
}

// ---------------------------------------------------------------------------
// Events, mode, render snapshot
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    Kill,
    Pickup,
    Damage,
    Death,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub tick: u64,
    pub kind: EventKind,
    pub detail: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Playing,
    Paused,
    Over,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RenderKind {
    Player,
    Enemy,
    Projectile,
    Pickup,
    Pillar,
    Floor,
    Wall,
}

#[derive(Debug, Clone)]
pub struct RenderItem {
    pub kind: RenderKind,
    pub pos: DVec3,
    pub ry: f64,
    pub scale: f32,
    pub color: [f32; 3],
}

/// Camera + item list for the renderer workstream (Wave 2b). Colors are
/// neutral placeholders (no art direction per ADR-0001).
#[derive(Debug, Clone)]
pub struct RenderSnapshot {
    pub cam_pos: DVec3,
    pub cam_forward: DVec3,
    pub items: Vec<RenderItem>,
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

struct DemoInner {
    seed: u32,
    tick: u64,
    world: World,
    input: InputSys,
    physics: PhysicsSys,
    audio: NullAudio,
    rng_arena: Stream,
    player: PlayerController,
    enemies: EnemySys,
    combat: CombatSys,
    statics: Vec<AABB>,
    pillar_spots: Vec<(f64, f64)>,
    score: u64,
    kills: u64,
    pickups_taken: u64,
    events: Vec<Event>,
    mode: Mode,
    pause_latch: bool,
    cam: CameraState,
    hit_stop_pending: f64,
    script_json: String,
}

impl DemoInner {
    fn new(seed: u32) -> Self {
        let mut world = World::new();
        let mut input = InputSys::new();
        for a in [
            "moveFwd",
            "moveBack",
            "moveLeft",
            "moveRight",
            "jump",
            "sprint",
            "fire",
            "pause",
        ] {
            input.define_action(a);
        }
        input.define_axis("moveX", "moveLeft", "moveRight");
        input.define_axis("moveY", "moveBack", "moveFwd");
        let mut physics = PhysicsSys::new();
        let audio = NullAudio;

        // ---- arena (port of buildArena; stream 'arena') ----
        let mut rng_arena = Stream::new(hash_seed(seed, "arena"));
        let mut statics = Vec::new();
        // ground
        add_static_box(
            &mut statics,
            &mut physics,
            -ARENA_HALF,
            -1.0,
            -ARENA_HALF,
            ARENA_HALF,
            0.0,
            ARENA_HALF,
        );
        // walls
        for z in [-ARENA_HALF - 0.5, ARENA_HALF + 0.5] {
            add_static_box(
                &mut statics,
                &mut physics,
                -ARENA_HALF,
                0.0,
                z - 0.5,
                ARENA_HALF,
                3.0,
                z + 0.5,
            );
        }
        for x in [-ARENA_HALF - 0.5, ARENA_HALF + 0.5] {
            add_static_box(
                &mut statics,
                &mut physics,
                x - 0.5,
                0.0,
                -ARENA_HALF,
                x + 0.5,
                3.0,
                ARENA_HALF,
            );
        }
        // pillars: per pillar the stream yields angle, radius, THEN the
        // color-lightness roll (consumed here like the TS does)
        let mut pillar_spots = Vec::new();
        for i in 0..7 {
            let a = (i as f64 / 7.0) * PI * 2.0 + (rng_arena.next() - 0.5) * 0.5;
            let rad = 10.0 + rng_arena.next() * 5.0;
            let (x, z) = (a.cos() * rad, a.sin() * rad);
            pillar_spots.push((x, z));
            let _lightness = 0.62 + (rng_arena.next() - 0.5) * 0.08;
            add_static_box(
                &mut statics,
                &mut physics,
                x - 0.8,
                0.0,
                z - 0.8,
                x + 0.8,
                6.0,
                z + 0.8,
            );
        }

        // ---- actors ----
        let player = PlayerController::new(&mut world, &mut physics, 0.0, 8.0);
        let mut enemies = EnemySys::new(seed);
        enemies.spawn_initial(&mut world, &mut physics);
        let mut combat = CombatSys::new();
        combat.spawn_pickup(&mut world, 6.0, -4.0, 25.0);
        combat.spawn_pickup(&mut world, -7.0, 5.0, 25.0);
        combat.spawn_pickup(&mut world, 3.0, 11.0, 25.0);

        let cam = CameraState {
            pos: player.snap_cam_pos(&world),
        };

        Self {
            seed,
            tick: 0,
            world,
            input,
            physics,
            audio,
            rng_arena,
            player,
            enemies,
            combat,
            statics,
            pillar_spots,
            score: 0,
            kills: 0,
            pickups_taken: 0,
            events: Vec::new(),
            mode: Mode::Playing,
            pause_latch: false,
            cam,
            hit_stop_pending: 0.0,
            script_json: String::new(),
        }
    }

    /// Update phase, in main.ts order: player → enemies → projectiles →
    /// pickups → physics.step(1/60). The whole handler (including the
    /// physics step) is skipped unless playing — same as the TS early return.
    fn update_sim(&mut self, dt: f64, tick: u64) {
        if self.mode != Mode::Playing {
            return;
        }
        // 1. player
        self.player.update(
            dt,
            &self.input,
            &mut self.world,
            &mut self.physics,
            &self.cam,
            &mut self.combat,
            &mut self.audio,
        );

        // 2. enemies
        let (px, pz) = match self.world.get::<Transform>(self.player.entity) {
            Some(t) => (t.position.x, t.position.z),
            None => return,
        };
        let player_alive = self.player.alive(&self.world);
        let mut ai_hooks = Vec::new();
        self.enemies.update(
            dt,
            px,
            pz,
            player_alive,
            &mut self.world,
            &mut self.physics,
            &mut ai_hooks,
        );
        self.process_ai_hooks(ai_hooks, tick);

        // 3. projectiles
        let mut proj_hooks = Vec::new();
        self.combat
            .update_projectiles(dt, &mut self.world, &self.statics, &mut proj_hooks);
        let mut ai_hooks2 = Vec::new();
        for h in proj_hooks {
            match h {
                ProjHook::HitWorld { .. } => {}
                ProjHook::HitEnemy { id, dmg, .. } => {
                    // knockback dir: enemy pos − player pos, normalized (TS `|| 1`)
                    let (ex, ez) = self
                        .world
                        .get::<Transform>(id)
                        .map(|t| (t.position.x, t.position.z))
                        .unwrap_or((px, pz));
                    let d = (ex - px).hypot(ez - pz);
                    let d = if d == 0.0 { 1.0 } else { d };
                    let kx = (ex - px) / d;
                    let kz = (ez - pz) / d;
                    if self.enemies.damage(
                        id,
                        dmg,
                        kx,
                        kz,
                        &mut self.world,
                        &mut self.physics,
                        &mut ai_hooks2,
                    ) {
                        self.audio.play("hit");
                    }
                }
            }
        }
        self.process_ai_hooks(ai_hooks2, tick);

        // 4. pickups
        let mut pk_hooks = Vec::new();
        self.combat
            .update_pickups(dt, px, pz, &mut self.world, &mut pk_hooks);
        for h in pk_hooks {
            let PickupHook::Taken { amount, x, z } = h;
            self.player.heal(&mut self.world, amount);
            self.audio.play("pickup");
            self.pickups_taken += 1;
            self.events.push(Event {
                tick,
                kind: EventKind::Pickup,
                detail: json!({"amount": amount, "x": x, "z": z}),
            });
        }

        // 5. physics
        self.physics.step(dt);
    }

    fn process_ai_hooks(&mut self, hooks: Vec<AiHook>, tick: u64) {
        for h in hooks {
            match h {
                AiHook::PlayerDamage { dmg, x, z } => {
                    let hp = self.player.damage(&mut self.world, dmg);
                    self.audio.play("hurt");
                    self.events.push(Event {
                        tick,
                        kind: EventKind::Damage,
                        detail: json!({"amount": dmg, "hp": hp, "x": x, "z": z}),
                    });
                    if hp <= 0.0 {
                        self.die(tick);
                    }
                }
                AiHook::Kill { x, y, z } => {
                    self.score += 100;
                    self.kills += 1;
                    self.audio.play("die");
                    // hit-stop is a no-op under step(); queued for frame() runs
                    self.hit_stop_pending = self.hit_stop_pending.max(75.0);
                    self.events.push(Event {
                        tick,
                        kind: EventKind::Kill,
                        detail: json!({"x": x, "y": y, "z": z}),
                    });
                }
                AiHook::Drop { x, z } => {
                    self.combat.spawn_pickup(&mut self.world, x, z, 25.0);
                }
            }
        }
    }

    fn die(&mut self, tick: u64) {
        if self.mode != Mode::Playing {
            return;
        }
        self.mode = Mode::Over;
        self.events.push(Event {
            tick,
            kind: EventKind::Death,
            detail: json!({}),
        });
    }

    /// Postupdate: pause latch, reactive death check, camera.
    fn post_update(&mut self, dt: f64, tick: u64) {
        let p = self.input.pressed("pause");
        if p && !self.pause_latch && (self.mode == Mode::Playing || self.mode == Mode::Paused) {
            self.pause_latch = true;
            self.mode = if self.mode == Mode::Playing {
                Mode::Paused
            } else {
                Mode::Playing
            };
        } else if !p {
            self.pause_latch = false;
        }
        // reactive death: hp may be zeroed through the debug surface (e2e)
        if self.mode == Mode::Playing && !self.player.alive(&self.world) {
            self.die(tick);
        }
        self.player
            .update_camera(dt, &self.world, &self.statics, &mut self.cam);
    }
}

/// Headless arena demo. Owns the sim state behind `Rc<RefCell<..>>` so the
/// fixed-step phase handlers (`bind_phases`) and the wall-clock `frame()`
/// path share the exact same update order.
pub struct Demo {
    inner: Rc<RefCell<DemoInner>>,
    game_loop: GameLoop,
}

impl Demo {
    pub fn new(seed: u32) -> Self {
        Self {
            inner: Rc::new(RefCell::new(DemoInner::new(seed))),
            game_loop: GameLoop::new(),
        }
    }

    /// Register the phase handlers. PreUpdate snapshots input at the current
    /// tick; Update runs the sim (tick advanced after); PostUpdate runs
    /// pause/death/camera and advances the demo tick.
    pub fn bind_phases(&mut self) {
        let inner = self.inner.clone();
        self.game_loop.on(
            Phase::PreUpdate,
            Box::new(move |_ctx: &FrameCtx| {
                let t = inner.borrow().tick;
                inner.borrow_mut().input.update(t);
            }),
        );
        let inner = self.inner.clone();
        self.game_loop.on(
            Phase::Update,
            Box::new(move |ctx: &FrameCtx| {
                let mut d = inner.borrow_mut();
                let tick = d.tick;
                d.update_sim(ctx.dt, tick);
            }),
        );
        let inner = self.inner.clone();
        self.game_loop.on(
            Phase::PostUpdate,
            Box::new(move |ctx: &FrameCtx| {
                let mut d = inner.borrow_mut();
                let tick = d.tick;
                d.post_update(ctx.dt, tick);
                d.tick += 1;
            }),
        );
    }

    /// Manual single step: input.update at the current tick (via PreUpdate),
    /// then one 1/60 sim step. Ignores pause/time_scale/hit-stop, like the
    /// TS `loop.step()`.
    pub fn step(&mut self) {
        self.game_loop.step();
        self.drain_hit_stop();
    }

    /// Wall-clock advance (for the desktop binary). Shares the handlers.
    pub fn frame(&mut self, now_ms: f64) {
        self.game_loop.frame(now_ms);
        self.drain_hit_stop();
    }

    fn drain_hit_stop(&mut self) {
        let ms = std::mem::replace(&mut self.inner.borrow_mut().hit_stop_pending, 0.0);
        if ms > 0.0 {
            self.game_loop.hit_stop(ms);
        }
    }

    pub fn tick(&self) -> u64 {
        self.inner.borrow().tick
    }

    pub fn shed_count(&self) -> u64 {
        self.game_loop.shed_count()
    }

    pub fn load_script(&mut self, json: &str) -> Result<(), String> {
        let mut d = self.inner.borrow_mut();
        d.input.load_script(json)?;
        d.script_json = json.to_string();
        Ok(())
    }

    pub fn score(&self) -> u64 {
        self.inner.borrow().score
    }

    // -- outcome vector ----------------------------------------------------

    /// The parity outcome vector (shape documented in the module docs).
    pub fn outcome_vector(&self) -> Value {
        let d = self.inner.borrow();
        let p = d
            .world
            .get::<Transform>(d.player.entity)
            .map(|t| t.position)
            .unwrap_or(DVec3::ZERO);
        let hp = d.player.hp(&d.world);
        let enemies: Vec<Value> = d
            .enemies
            .recs
            .iter()
            .filter(|r| {
                d.world
                    .get::<Health>(r.entity)
                    .is_some_and(|h| h.current > 0.0)
            })
            .map(|r| {
                let t = d
                    .world
                    .get::<Transform>(r.entity)
                    .map(|t| t.position)
                    .unwrap_or(DVec3::ZERO);
                let hp = d
                    .world
                    .get::<Health>(r.entity)
                    .map(|h| h.current)
                    .unwrap_or(0.0);
                json!({"x": t.x, "z": t.z, "hp": hp, "state": r.state})
            })
            .collect();
        json!({
            "seed": d.seed,
            "ticks": d.tick,
            "score": d.score,
            "player": {"hp": hp, "x": p.x, "y": p.y, "z": p.z},
            "enemies": enemies,
            "kills": d.kills,
            "pickups_taken": d.pickups_taken,
            "projectiles_active": d.combat.proj_active,
            "events": d.events,
        })
    }

    // -- save / load ---------------------------------------------------------

    fn comp_json<T: Serialize>(c: Option<&T>) -> Value {
        c.map(|c| serde_json::to_value(c).unwrap_or(Value::Null))
            .unwrap_or(Value::Null)
    }

    /// Serialize the full sim state. `components` mirrors the TS `doSave`
    /// shape (inspection); `extra` carries everything needed for a
    /// bit-exact resume (see ADR-0005).
    pub fn save_state(&self) -> SaveData {
        let d = self.inner.borrow();
        let mut components: BTreeMap<u32, BTreeMap<String, Value>> = BTreeMap::new();

        let mut put = |id: Entity, names: &[(&str, Value)]| {
            let rec: BTreeMap<String, Value> = names
                .iter()
                .map(|(n, v)| (n.to_string(), v.clone()))
                .collect();
            components.insert(id, rec);
        };
        put(
            d.player.entity,
            &[
                (
                    "Transform",
                    Self::comp_json(d.world.get::<Transform>(d.player.entity)),
                ),
                (
                    "Health",
                    Self::comp_json(d.world.get::<Health>(d.player.entity)),
                ),
                (
                    "Velocity",
                    Self::comp_json(d.world.get::<Velocity>(d.player.entity)),
                ),
            ],
        );
        for r in &d.enemies.recs {
            put(
                r.entity,
                &[
                    (
                        "Transform",
                        Self::comp_json(d.world.get::<Transform>(r.entity)),
                    ),
                    ("Health", Self::comp_json(d.world.get::<Health>(r.entity))),
                    ("AI", Self::comp_json(d.world.get::<AIComp>(r.entity))),
                    ("Enemy", Self::comp_json(d.world.get::<Enemy>(r.entity))),
                ],
            );
        }
        for p in &d.combat.pickups {
            put(
                p.entity,
                &[
                    (
                        "Transform",
                        Self::comp_json(d.world.get::<Transform>(p.entity)),
                    ),
                    (
                        "Pickup",
                        Self::comp_json(d.world.get::<PickupComp>(p.entity)),
                    ),
                ],
            );
        }

        let mut extra: BTreeMap<String, Value> = BTreeMap::new();
        extra.insert("rng_enemies".into(), json!(d.enemies.stream_state()));
        extra.insert("rng_arena".into(), json!(d.rng_arena.state()));
        extra.insert(
            "input".into(),
            json!({"script": d.script_json, "tick": d.tick}),
        );
        {
            let c = &d.player;
            extra.insert(
                "controller".into(),
                json!({
                    "yaw": c.yaw, "pitch": c.pitch, "vx": c.vx, "vz": c.vz,
                    "coyote": c.coyote, "buffer": c.buffer, "fire_cd": c.fire_cd,
                    "was_grounded": c.was_grounded, "dip": c.dip, "ry": c.ry,
                }),
            );
        }
        {
            // Transform (pre-physics-step, what the outcome vector reads) and
            // the kinematic body position (post-step) both; the sim needs
            // both to resume bit-exactly.
            let tp = d
                .world
                .get::<Transform>(d.player.entity)
                .map(|t| t.position)
                .unwrap_or(DVec3::ZERO);
            let bp = d
                .player
                .body
                .and_then(|b| d.physics.get_position(b))
                .unwrap_or(DVec3::ZERO);
            extra.insert(
                "player".into(),
                json!({
                    "hp": d.player.hp(&d.world),
                    "x": tp.x, "y": tp.y, "z": tp.z,
                    "bx": bp.x, "by": bp.y, "bz": bp.z,
                }),
            );
        }
        let enemies: Vec<Value> = d
            .enemies
            .recs
            .iter()
            .map(|r| {
                // Transform (pre-step) + body (post-step); see the player
                // block above for why both are needed.
                let tp = d
                    .world
                    .get::<Transform>(r.entity)
                    .map(|t| t.position)
                    .unwrap_or(DVec3::ZERO);
                let bp = r
                    .body
                    .and_then(|b| d.physics.get_position(b))
                    .unwrap_or(DVec3::ZERO);
                let hp = d
                    .world
                    .get::<Health>(r.entity)
                    .map(|h| h.current)
                    .unwrap_or(0.0);
                json!({
                    "wp": r.wp, "state": r.state, "t": r.t, "atk_cd": r.atk_cd,
                    "respawn_t": r.respawn_t, "vx": r.vx, "vz": r.vz, "ry": r.ry,
                    "hp": hp,
                    "x": tp.x, "y": tp.y, "z": tp.z,
                    "bx": bp.x, "by": bp.y, "bz": bp.z,
                    "has_body": r.body.is_some(),
                })
            })
            .collect();
        extra.insert("enemies".into(), Value::Array(enemies));
        let slots: Vec<Value> = d
            .combat
            .proj
            .iter()
            .map(|s| {
                json!({
                    "active": s.active, "x": s.x, "y": s.y, "z": s.z,
                    "vx": s.vx, "vy": s.vy, "vz": s.vz,
                    "life": s.life, "dmg": s.dmg,
                })
            })
            .collect();
        extra.insert(
            "projectiles".into(),
            json!({"active": d.combat.proj_active, "slots": slots}),
        );
        let pickups: Vec<Value> = d
            .combat
            .pickups
            .iter()
            .map(|p| {
                let t = d
                    .world
                    .get::<Transform>(p.entity)
                    .map(|t| t.position)
                    .unwrap_or(DVec3::ZERO);
                let v = d
                    .world
                    .get::<PickupComp>(p.entity)
                    .map(|p| p.value)
                    .unwrap_or(25.0);
                json!({"taken": p.taken, "amount": v, "x": t.x, "z": t.z})
            })
            .collect();
        extra.insert("pickups".into(), Value::Array(pickups));
        extra.insert("score".into(), json!(d.score));
        extra.insert("kills".into(), json!(d.kills));
        extra.insert("pickups_taken".into(), json!(d.pickups_taken));
        extra.insert(
            "events".into(),
            serde_json::to_value(&d.events).unwrap_or(Value::Null),
        );
        extra.insert("mode".into(), json!(d.mode));
        extra.insert("pause_latch".into(), json!(d.pause_latch));
        extra.insert("hit_stop_pending".into(), json!(d.hit_stop_pending));
        extra.insert("loop_paused".into(), json!(self.game_loop.paused()));
        extra.insert(
            "cam_pos".into(),
            json!([d.cam.pos.x, d.cam.pos.y, d.cam.pos.z]),
        );

        SaveData {
            engine: "keelcode".into(),
            format_version: CURRENT_VERSION,
            seed: d.seed,
            tick: d.tick,
            components,
            score: d.score,
            extra,
        }
    }

    /// Restore a state produced by `save_state`, bit-exactly. Rebuilds a
    /// fresh sim from the seed (deterministic construction ⇒ identical
    /// entity/body ids) and applies every saved field in place, so already-
    /// registered phase handlers keep working.
    pub fn load_state(&mut self, d: &SaveData) -> Result<(), String> {
        fn get<'a>(extra: &'a BTreeMap<String, Value>, key: &str) -> Result<&'a Value, String> {
            extra
                .get(key)
                .ok_or_else(|| format!("save is missing extra.{key}"))
        }
        fn f64v(v: &Value, what: &str) -> Result<f64, String> {
            v.as_f64()
                .ok_or_else(|| format!("save: {what} is not a number"))
        }

        let mut fresh = DemoInner::new(d.seed);
        let extra = &d.extra;

        fresh.enemies.set_stream_state(
            get(extra, "rng_enemies")?
                .as_u64()
                .ok_or("save: rng_enemies not u32")? as u32,
        );
        fresh.rng_arena.set_state(
            get(extra, "rng_arena")?
                .as_u64()
                .ok_or("save: rng_arena not u32")? as u32,
        );

        // input: reload the script and replay updates to the saved tick —
        // reproduces cursor + down/prev edge state exactly.
        let input = get(extra, "input")?;
        let script = input
            .get("script")
            .and_then(|v| v.as_str())
            .ok_or("save: input.script missing")?;
        let itick = input
            .get("tick")
            .and_then(|v| v.as_u64())
            .ok_or("save: input.tick missing")?;
        fresh
            .input
            .load_script(script)
            .map_err(|e| format!("save: bad input script: {e}"))?;
        fresh.script_json = script.to_string();
        for t in 0..itick {
            fresh.input.update(t);
        }

        // controller
        let c = get(extra, "controller")?;
        let cv = |k: &str| {
            f64v(
                c.get(k).ok_or(format!("save: controller.{k} missing"))?,
                &format!("controller.{k}"),
            )
        };
        fresh.player.yaw = cv("yaw")?;
        fresh.player.pitch = cv("pitch")?;
        fresh.player.vx = cv("vx")?;
        fresh.player.vz = cv("vz")?;
        fresh.player.coyote = cv("coyote")?;
        fresh.player.buffer = cv("buffer")?;
        fresh.player.fire_cd = cv("fire_cd")?;
        fresh.player.was_grounded = c
            .get("was_grounded")
            .and_then(|v| v.as_bool())
            .ok_or("save: controller.was_grounded missing")?;
        fresh.player.dip = cv("dip")?;
        fresh.player.ry = cv("ry")?;

        // player body + hp
        let p = get(extra, "player")?;
        let px = f64v(p.get("x").ok_or("save: player.x missing")?, "player.x")?;
        let py = f64v(p.get("y").ok_or("save: player.y missing")?, "player.y")?;
        let pz = f64v(p.get("z").ok_or("save: player.z missing")?, "player.z")?;
        let bx = f64v(p.get("bx").ok_or("save: player.bx missing")?, "player.bx")?;
        let by = f64v(p.get("by").ok_or("save: player.by missing")?, "player.by")?;
        let bz = f64v(p.get("bz").ok_or("save: player.bz missing")?, "player.bz")?;
        let php = f64v(p.get("hp").ok_or("save: player.hp missing")?, "player.hp")?;
        if let Some(h) = fresh.world.get_mut::<Health>(fresh.player.entity) {
            h.current = php;
        }
        if let Some(t) = fresh.world.get_mut::<Transform>(fresh.player.entity) {
            t.position = DVec3::new(px, py, pz);
        }
        if let Some(b) = fresh.player.body {
            fresh
                .physics
                .set_kinematic_position(b, DVec3::new(bx, by, bz));
        }

        // enemies (matched by rec index — construction is deterministic)
        let es = get(extra, "enemies")?
            .as_array()
            .ok_or("save: enemies not an array")?;
        if es.len() != fresh.enemies.recs.len() {
            return Err(format!(
                "save: enemies len {} != fresh {}",
                es.len(),
                fresh.enemies.recs.len()
            ));
        }
        for (i, e) in es.iter().enumerate() {
            let ev = |k: &str| {
                f64v(
                    e.get(k).ok_or(format!("save: enemies[{i}].{k} missing"))?,
                    "enemy field",
                )
            };
            let wp = e
                .get("wp")
                .and_then(|v| v.as_u64())
                .ok_or(format!("save: enemies[{i}].wp missing"))? as usize;
            let state: EnemyState =
                serde_json::from_value(e.get("state").cloned().unwrap_or(Value::Null))
                    .map_err(|_| format!("save: enemies[{i}].state bad"))?;
            let (t_, atk_cd, respawn_t, vx, vz, ry) = (
                ev("t")?,
                ev("atk_cd")?,
                ev("respawn_t")?,
                ev("vx")?,
                ev("vz")?,
                ev("ry")?,
            );
            let (hp, x, y, z) = (ev("hp")?, ev("x")?, ev("y")?, ev("z")?);
            let (bx, by, bz) = (ev("bx")?, ev("by")?, ev("bz")?);
            let has_body = e.get("has_body").and_then(|v| v.as_bool()).unwrap_or(true);
            let id = fresh.enemies.recs[i].entity;
            {
                let rec = &mut fresh.enemies.recs[i];
                rec.wp = wp;
                rec.state = state;
                rec.t = t_;
                rec.atk_cd = atk_cd;
                rec.respawn_t = respawn_t;
                rec.vx = vx;
                rec.vz = vz;
                rec.ry = ry;
            }
            if let Some(h) = fresh.world.get_mut::<Health>(id) {
                h.current = hp;
            }
            if let Some(t) = fresh.world.get_mut::<Transform>(id) {
                t.position = DVec3::new(x, y, z);
                t.rotation = glam::DQuat::from_rotation_y(ry);
            }
            fresh.enemies.sync_blackboard_idx(&mut fresh.world, i);
            if has_body {
                if let Some(b) = fresh.enemies.recs[i].body {
                    fresh
                        .physics
                        .set_kinematic_position(b, DVec3::new(bx, by, bz));
                }
            } else if let Some(b) = fresh.enemies.recs[i].body.take() {
                fresh.physics.remove_body(b);
            }
        }

        // projectiles
        let pr = get(extra, "projectiles")?;
        let slots = pr
            .get("slots")
            .and_then(|v| v.as_array())
            .ok_or("save: projectiles.slots missing")?;
        if slots.len() != fresh.combat.proj.len() {
            return Err("save: projectile pool size mismatch".into());
        }
        let mut active = 0usize;
        for (i, s) in slots.iter().enumerate() {
            let sv = |k: &str| {
                f64v(
                    s.get(k).ok_or(format!("save: proj[{i}].{k} missing"))?,
                    "proj field",
                )
            };
            let slot = &mut fresh.combat.proj[i];
            slot.active = s.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
            slot.x = sv("x")?;
            slot.y = sv("y")?;
            slot.z = sv("z")?;
            slot.vx = sv("vx")?;
            slot.vy = sv("vy")?;
            slot.vz = sv("vz")?;
            slot.life = sv("life")?;
            slot.dmg = sv("dmg")?;
            if slot.active {
                active += 1;
            }
        }
        fresh.combat.proj_active = active;

        // pickups (matched by insertion order; extras are spawned fresh)
        let ps = get(extra, "pickups")?
            .as_array()
            .ok_or("save: pickups not an array")?;
        for (i, p) in ps.iter().enumerate() {
            let taken = p
                .get("taken")
                .and_then(|v| v.as_bool())
                .ok_or(format!("save: pickups[{i}].taken missing"))?;
            let amount = f64v(
                p.get("amount")
                    .ok_or(format!("save: pickups[{i}].amount missing"))?,
                "pickup amount",
            )?;
            let x = f64v(
                p.get("x").ok_or(format!("save: pickups[{i}].x missing"))?,
                "pickup x",
            )?;
            let z = f64v(
                p.get("z").ok_or(format!("save: pickups[{i}].z missing"))?,
                "pickup z",
            )?;
            if i < fresh.combat.pickups.len() {
                let rec = &mut fresh.combat.pickups[i];
                rec.taken = taken;
                if let Some(pc) = fresh.world.get_mut::<PickupComp>(rec.entity) {
                    pc.value = amount;
                }
                if let Some(t) = fresh.world.get_mut::<Transform>(rec.entity) {
                    t.position.x = x;
                    t.position.z = z;
                }
            } else {
                // drop-spawned pickup: recreate the entity directly (bypasses
                // the taken-slot reuse — the saved recs already encode it)
                let e = fresh.world.spawn();
                fresh.world.insert(
                    e,
                    Transform {
                        position: DVec3::new(x, 0.0, z),
                        rotation: glam::DQuat::IDENTITY,
                        scale: DVec3::ONE,
                    },
                );
                fresh.world.insert(
                    e,
                    PickupComp {
                        effect_id: "health".into(),
                        value: amount,
                    },
                );
                fresh.world.insert(
                    e,
                    Renderable {
                        mesh_ref: "pickup".into(),
                        material_ref: "pickup".into(),
                        visible: true,
                    },
                );
                fresh
                    .combat
                    .pickups
                    .push(crate::systems::combat::PickupRec { entity: e, taken });
            }
        }

        fresh.score = get(extra, "score")?.as_u64().ok_or("save: score missing")?;
        fresh.kills = get(extra, "kills")?.as_u64().ok_or("save: kills missing")?;
        fresh.pickups_taken = get(extra, "pickups_taken")?
            .as_u64()
            .ok_or("save: pickups_taken missing")?;
        fresh.events = serde_json::from_value(get(extra, "events")?.clone())
            .map_err(|_| "save: events bad")?;
        fresh.mode =
            serde_json::from_value(get(extra, "mode")?.clone()).map_err(|_| "save: mode bad")?;
        fresh.pause_latch = get(extra, "pause_latch")?
            .as_bool()
            .ok_or("save: pause_latch missing")?;
        fresh.hit_stop_pending = f64v(get(extra, "hit_stop_pending")?, "hit_stop")?;
        let loop_paused = get(extra, "loop_paused")?
            .as_bool()
            .ok_or("save: loop_paused missing")?;
        let cam = get(extra, "cam_pos")?
            .as_array()
            .ok_or("save: cam_pos missing")?;
        if cam.len() != 3 {
            return Err("save: cam_pos len != 3".into());
        }
        fresh.cam.pos = DVec3::new(
            f64v(&cam[0], "cam x")?,
            f64v(&cam[1], "cam y")?,
            f64v(&cam[2], "cam z")?,
        );
        fresh.tick = d.tick;

        *self.inner.borrow_mut() = fresh;
        self.game_loop.set_paused(loop_paused);
        Ok(())
    }

    // -- render snapshot -------------------------------------------------------

    /// Camera + item list for the renderer workstream.
    pub fn render_snapshot(&self) -> RenderSnapshot {
        let d = self.inner.borrow();
        let t = d
            .world
            .get::<Transform>(d.player.entity)
            .map(|t| t.position)
            .unwrap_or(DVec3::ZERO);
        let target = DVec3::new(t.x, t.y + 1.7, t.z);
        let mut items = Vec::new();
        // floor + walls + pillars (statics, visual only)
        items.push(RenderItem {
            kind: RenderKind::Floor,
            pos: DVec3::new(0.0, 0.0, 0.0),
            ry: 0.0,
            scale: 40.0,
            color: [0.55, 0.56, 0.59],
        });
        for z in [-ARENA_HALF - 0.5, ARENA_HALF + 0.5] {
            items.push(RenderItem {
                kind: RenderKind::Wall,
                pos: DVec3::new(0.0, 1.5, z),
                ry: 0.0,
                scale: 1.0,
                color: [0.5, 0.52, 0.55],
            });
        }
        for x in [-ARENA_HALF - 0.5, ARENA_HALF + 0.5] {
            items.push(RenderItem {
                kind: RenderKind::Wall,
                pos: DVec3::new(x, 1.5, 0.0),
                ry: 0.0,
                scale: 1.0,
                color: [0.5, 0.52, 0.55],
            });
        }
        for (x, z) in &d.pillar_spots {
            items.push(RenderItem {
                kind: RenderKind::Pillar,
                pos: DVec3::new(*x, 3.0, *z),
                ry: 0.0,
                scale: 1.0,
                color: [0.55, 0.58, 0.62],
            });
        }
        // player
        items.push(RenderItem {
            kind: RenderKind::Player,
            pos: t,
            ry: d.player.ry,
            scale: 1.0,
            color: [0.2, 0.5, 1.0],
        });
        // live enemies
        for r in &d.enemies.recs {
            if d.world
                .get::<Health>(r.entity)
                .is_some_and(|h| h.current > 0.0)
            {
                let p = d
                    .world
                    .get::<Transform>(r.entity)
                    .map(|t| t.position)
                    .unwrap_or(DVec3::ZERO);
                items.push(RenderItem {
                    kind: RenderKind::Enemy,
                    pos: p,
                    ry: r.ry,
                    scale: 1.0,
                    color: [1.0, 0.25, 0.2],
                });
            }
        }
        // active projectiles
        for s in d.combat.proj.iter().filter(|s| s.active) {
            items.push(RenderItem {
                kind: RenderKind::Projectile,
                pos: DVec3::new(s.x, s.y, s.z),
                ry: 0.0,
                scale: 0.13,
                color: [1.0, 1.0, 1.0],
            });
        }
        // untaken pickups
        for p in &d.combat.pickups {
            if !p.taken {
                let pos = d
                    .world
                    .get::<Transform>(p.entity)
                    .map(|t| t.position)
                    .unwrap_or(DVec3::ZERO);
                items.push(RenderItem {
                    kind: RenderKind::Pickup,
                    pos: DVec3::new(pos.x, 0.75, pos.z),
                    ry: 0.0,
                    scale: 1.0,
                    color: [0.2, 1.0, 0.3],
                });
            }
        }
        RenderSnapshot {
            cam_pos: d.cam.pos,
            cam_forward: d.cam.forward(target),
            items,
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng;

    /// The demo-local `Stream` must be bit-identical to `rng::mulberry32`.
    #[test]
    fn stream_matches_rng_crate() {
        for seed in [0u32, 1, 1337, 3268439969, u32::MAX] {
            let mut a = rng::mulberry32(seed);
            let mut b = Stream::new(seed);
            for _ in 0..2000 {
                let (x, y) = (a(), b.next());
                assert_eq!(x, y, "seed {seed}");
            }
            // state round-trips through u32
            let s = b.state();
            b.set_state(s.wrapping_add(7));
            b.set_state(s);
            assert_eq!(a(), b.next());
        }
    }

    #[test]
    fn ray_aabb_matches_ts_cases() {
        // ground box (-20,-1,-20)-(20,0,20): ray straight down from y=5
        let g = AABB {
            minx: -20.0,
            miny: -1.0,
            minz: -20.0,
            maxx: 20.0,
            maxy: 0.0,
            maxz: 20.0,
        };
        let t = ray_aabb(0.0, 5.0, 0.0, 0.0, -1.0, 0.0, &g, 100.0);
        assert_eq!(t, 5.0);
        // parallel ray outside the slab → Infinity
        let t = ray_aabb(25.0, 5.0, 0.0, 0.0, -1.0, 0.0, &g, 100.0);
        assert!(t.is_infinite());
        // ray starts inside → tmin 0
        let t = ray_aabb(0.0, -0.5, 0.0, 0.0, -1.0, 0.0, &g, 100.0);
        assert_eq!(t, 0.0);
        // miss in x after swap
        let t = ray_aabb(0.0, 5.0, 0.0, 1.0, 0.0, 0.0, &g, 100.0);
        assert!(t.is_infinite());
    }

    #[test]
    fn sphere_hits_static_matches_ts() {
        let g = AABB {
            minx: -20.0,
            miny: -1.0,
            minz: -20.0,
            maxx: 20.0,
            maxy: 0.0,
            maxz: 20.0,
        };
        let statics = [g];
        assert!(sphere_hits_static(0.0, 0.05, 0.0, 0.13, &statics));
        assert!(!sphere_hits_static(0.0, 0.2, 0.0, 0.13, &statics));
        // strict `< r²`: exactly touching does NOT count (TS uses `<` too)
        assert!(!sphere_hits_static(0.0, 0.13, 0.0, 0.13, &statics));
    }
}
