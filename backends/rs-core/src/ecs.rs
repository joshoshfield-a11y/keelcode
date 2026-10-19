//! ECS-lite: entity ids plus per-component slot tables, queued mutation.
//!
//! Mirrors `backends/ts-three/src/engine/ecs.ts`: `spawn`/`despawn` queue to
//! phase end (`flush()`); `query()` flushes first and returns ids ascending;
//! `get` sees queued spawns/inserts and hides queued despawns — the TS
//! `committed()`/`spawnQueue` semantics.
//!
//! No `HashMap` iteration anywhere: component data lives in
//! `Vec<Option<T>>` slot tables indexed by entity id, and queues are plain
//! `Vec`s drained in order (fully deterministic).

use std::any::TypeId;

use crate::components::{
    AIComp, Collider, Enemy, Health, InputMarker, Lifetime, PickupComp, Player, ProjectileComp,
    Renderable, Script, Transform, Velocity,
};

/// Entity handle. Ids are assigned monotonically from 1 and never reused
/// (mirrors the TS `nextId`).
pub type Entity = u32;

/// Canonical component identifier. Order is declaration order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ComponentId {
    Transform,
    Velocity,
    Health,
    Collider,
    Renderable,
    Script,
    Input,
    AI,
    Lifetime,
    Pickup,
    Projectile,
    Player,
    Enemy,
}

impl ComponentId {
    /// Component name string for saves/queries (matches the TS `C` map and
    /// the schema's `componentName` enum).
    pub fn name(&self) -> &'static str {
        match self {
            ComponentId::Transform => "Transform",
            ComponentId::Velocity => "Velocity",
            ComponentId::Health => "Health",
            ComponentId::Collider => "Collider",
            ComponentId::Renderable => "Renderable",
            ComponentId::Script => "Script",
            ComponentId::Input => "Input",
            ComponentId::AI => "AI",
            ComponentId::Lifetime => "Lifetime",
            ComponentId::Pickup => "Pickup",
            ComponentId::Projectile => "Projectile",
            ComponentId::Player => "Player",
            ComponentId::Enemy => "Enemy",
        }
    }
}

/// Implemented by the 13 canonical component types.
pub trait Component: 'static {
    fn id() -> ComponentId;
}

macro_rules! impl_component {
    ($ty:ty, $id:ident) => {
        impl Component for $ty {
            fn id() -> ComponentId {
                ComponentId::$id
            }
        }
    };
}

impl_component!(Transform, Transform);
impl_component!(Velocity, Velocity);
impl_component!(Health, Health);
impl_component!(Collider, Collider);
impl_component!(Renderable, Renderable);
impl_component!(Script, Script);
impl_component!(InputMarker, Input);
impl_component!(AIComp, AI);
impl_component!(Lifetime, Lifetime);
impl_component!(PickupComp, Pickup);
impl_component!(ProjectileComp, Projectile);
impl_component!(Player, Player);
impl_component!(Enemy, Enemy);

/// Entity/component store with queued structural mutation.
#[derive(Debug)]
pub struct World {
    transform: Vec<Option<Transform>>,
    velocity: Vec<Option<Velocity>>,
    health: Vec<Option<Health>>,
    collider: Vec<Option<Collider>>,
    renderable: Vec<Option<Renderable>>,
    script: Vec<Option<Script>>,
    input: Vec<Option<InputMarker>>,
    ai: Vec<Option<AIComp>>,
    lifetime: Vec<Option<Lifetime>>,
    pickup: Vec<Option<PickupComp>>,
    projectile: Vec<Option<ProjectileComp>>,
    player: Vec<Option<Player>>,
    enemy: Vec<Option<Enemy>>,
    /// Committed live entities (flushed spawns not yet despawned).
    alive: Vec<bool>,
    /// Spawned but not yet flushed.
    pending_spawn: Vec<bool>,
    /// Despawn queued: hidden from get/query immediately, applied at flush.
    pending_despawn: Vec<bool>,
    /// Queued spawns in reservation order.
    spawn_queue: Vec<Entity>,
    /// Queued despawns.
    despawn_queue: Vec<Entity>,
    /// Next id to reserve. Starts at 1 like the TS reference.
    next_id: Entity,
}

impl World {
    pub fn new() -> Self {
        Self {
            transform: Vec::new(),
            velocity: Vec::new(),
            health: Vec::new(),
            collider: Vec::new(),
            renderable: Vec::new(),
            script: Vec::new(),
            input: Vec::new(),
            ai: Vec::new(),
            lifetime: Vec::new(),
            pickup: Vec::new(),
            projectile: Vec::new(),
            player: Vec::new(),
            enemy: Vec::new(),
            alive: Vec::new(),
            pending_spawn: Vec::new(),
            pending_despawn: Vec::new(),
            spawn_queue: Vec::new(),
            despawn_queue: Vec::new(),
            next_id: 1,
        }
    }

    /// Grow every slot table / flag vector so index `e` is addressable.
    fn ensure(&mut self, e: Entity) {
        let need = e as usize + 1;
        macro_rules! grow {
            ($field:ident) => {
                if self.$field.len() < need {
                    self.$field.resize(need, None);
                }
            };
        }
        grow!(transform);
        grow!(velocity);
        grow!(health);
        grow!(collider);
        grow!(renderable);
        grow!(script);
        grow!(input);
        grow!(ai);
        grow!(lifetime);
        grow!(pickup);
        grow!(projectile);
        grow!(player);
        grow!(enemy);
        if self.alive.len() < need {
            self.alive.resize(need, false);
        }
        if self.pending_spawn.len() < need {
            self.pending_spawn.resize(need, false);
        }
        if self.pending_despawn.len() < need {
            self.pending_despawn.resize(need, false);
        }
    }

    /// True if `e` names a reserved id (spawned at some point).
    fn reserved(&self, e: Entity) -> bool {
        e != 0 && (e as usize) < self.next_id as usize
    }

    /// Queue entity creation; returns the reserved id immediately.
    pub fn spawn(&mut self) -> Entity {
        let e = self.next_id;
        self.next_id += 1;
        self.ensure(e);
        let i = e as usize;
        self.pending_spawn[i] = true;
        self.spawn_queue.push(e);
        e
    }

    /// Insert/overwrite a component. Works on queued (unflushed) entities
    /// too; no-ops on unknown ids and on despawn-queued entities (mirrors
    /// the TS `set`, which returns early for the despawn queue).
    pub fn insert<T: Component>(&mut self, e: Entity, c: T) {
        let i = e as usize;
        if !self.reserved(e) || self.pending_despawn[i] {
            return;
        }
        // Dispatch on the concrete type. TypeId equality proves `T` is the
        // slot's type, so the pointer cast is sound; a foreign type with a
        // bogus id simply matches no arm (fail clean, no UB).
        macro_rules! try_insert {
            ($ty:ty, $field:ident) => {
                if TypeId::of::<T>() == TypeId::of::<$ty>() {
                    // SAFETY: TypeId equality proves `T` and `$ty` are the same
                    // type, so reinterpreting `c`'s bits as `$ty` is sound.
                    // `ManuallyDrop` + `ptr::read` moves the value out without
                    // running `c`'s destructor (no double-free for Vec/String).
                    let c = std::mem::ManuallyDrop::new(c);
                    let value: $ty = unsafe { std::ptr::read(&*c as *const T as *const $ty) };
                    self.$field[i] = Some(value);
                    return;
                }
            };
        }
        try_insert!(Transform, transform);
        try_insert!(Velocity, velocity);
        try_insert!(Health, health);
        try_insert!(Collider, collider);
        try_insert!(Renderable, renderable);
        try_insert!(Script, script);
        try_insert!(InputMarker, input);
        try_insert!(AIComp, ai);
        try_insert!(Lifetime, lifetime);
        try_insert!(PickupComp, pickup);
        try_insert!(ProjectileComp, projectile);
        try_insert!(Player, player);
        try_insert!(Enemy, enemy);
    }

    /// Queue entity destruction (hides it from get/query immediately).
    pub fn despawn(&mut self, e: Entity) {
        let i = e as usize;
        if !self.reserved(e) || self.pending_despawn[i] {
            return;
        }
        self.pending_despawn[i] = true;
        self.despawn_queue.push(e);
    }

    /// Component lookup. Sees queued spawns/inserts, hides queued despawns.
    pub fn get<T: Component>(&self, e: Entity) -> Option<&T> {
        let i = e as usize;
        if !self.reserved(e) || self.pending_despawn[i] {
            return None;
        }
        macro_rules! try_get {
            ($ty:ty, $field:ident) => {
                if TypeId::of::<T>() == TypeId::of::<$ty>() {
                    return self.$field.get(i).and_then(|o| o.as_ref()).map(|r| {
                        // SAFETY: guarded by the TypeId check above.
                        unsafe { &*(r as *const $ty as *const T) }
                    });
                }
            };
        }
        try_get!(Transform, transform);
        try_get!(Velocity, velocity);
        try_get!(Health, health);
        try_get!(Collider, collider);
        try_get!(Renderable, renderable);
        try_get!(Script, script);
        try_get!(InputMarker, input);
        try_get!(AIComp, ai);
        try_get!(Lifetime, lifetime);
        try_get!(PickupComp, pickup);
        try_get!(ProjectileComp, projectile);
        try_get!(Player, player);
        try_get!(Enemy, enemy);
        None
    }

    /// Mutable component lookup; same visibility rules as `get`.
    pub fn get_mut<T: Component>(&mut self, e: Entity) -> Option<&mut T> {
        let i = e as usize;
        if !self.reserved(e) || self.pending_despawn[i] {
            return None;
        }
        macro_rules! try_get_mut {
            ($ty:ty, $field:ident) => {
                if TypeId::of::<T>() == TypeId::of::<$ty>() {
                    return self.$field.get_mut(i).and_then(|o| o.as_mut()).map(|r| {
                        // SAFETY: guarded by the TypeId check above.
                        unsafe { &mut *(r as *mut $ty as *mut T) }
                    });
                }
            };
        }
        try_get_mut!(Transform, transform);
        try_get_mut!(Velocity, velocity);
        try_get_mut!(Health, health);
        try_get_mut!(Collider, collider);
        try_get_mut!(Renderable, renderable);
        try_get_mut!(Script, script);
        try_get_mut!(InputMarker, input);
        try_get_mut!(AIComp, ai);
        try_get_mut!(Lifetime, lifetime);
        try_get_mut!(PickupComp, pickup);
        try_get_mut!(ProjectileComp, projectile);
        try_get_mut!(Player, player);
        try_get_mut!(Enemy, enemy);
        None
    }

    pub fn has<T: Component>(&self, e: Entity) -> bool {
        self.get::<T>(e).is_some()
    }

    /// Slot presence for a component id (used by `query`).
    fn has_id(&self, e: Entity, id: ComponentId) -> bool {
        let i = e as usize;
        match id {
            ComponentId::Transform => self.transform.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Velocity => self.velocity.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Health => self.health.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Collider => self.collider.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Renderable => self.renderable.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Script => self.script.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Input => self.input.get(i).is_some_and(|o| o.is_some()),
            ComponentId::AI => self.ai.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Lifetime => self.lifetime.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Pickup => self.pickup.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Projectile => self.projectile.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Player => self.player.get(i).is_some_and(|o| o.is_some()),
            ComponentId::Enemy => self.enemy.get(i).is_some_and(|o| o.is_some()),
        }
    }

    /// Clear every component slot for an entity id.
    fn clear_components(&mut self, i: usize) {
        self.transform[i] = None;
        self.velocity[i] = None;
        self.health[i] = None;
        self.collider[i] = None;
        self.renderable[i] = None;
        self.script[i] = None;
        self.input[i] = None;
        self.ai[i] = None;
        self.lifetime[i] = None;
        self.pickup[i] = None;
        self.projectile[i] = None;
        self.player[i] = None;
        self.enemy[i] = None;
    }

    /// Flush-then-collect: ids possessing ALL listed components, ascending.
    pub fn query(&mut self, ids: &[ComponentId]) -> Vec<Entity> {
        self.flush();
        let mut out = Vec::new();
        for e in 1..self.next_id {
            if self.alive[e as usize] && ids.iter().all(|id| self.has_id(e, *id)) {
                out.push(e);
            }
        }
        out
    }

    /// All live (flushed + queued-spawn, minus queued-despawn) ids, ascending.
    /// Does NOT flush.
    pub fn entities(&self) -> Vec<Entity> {
        let mut out = Vec::new();
        for e in 1..self.next_id {
            let i = e as usize;
            if (self.alive[i] || self.pending_spawn[i]) && !self.pending_despawn[i] {
                out.push(e);
            }
        }
        out
    }

    /// Entity count. Flushes first, like the TS `count()`.
    pub fn count(&mut self) -> usize {
        self.flush();
        self.alive.iter().filter(|&&a| a).count()
    }

    /// Apply queued spawn/despawn ops. Despawns first (also cancelling
    /// queued spawns), then commits remaining spawns — the TS
    /// `applyPending()` order.
    pub fn flush(&mut self) {
        if self.spawn_queue.is_empty() && self.despawn_queue.is_empty() {
            return;
        }
        let despawns = std::mem::take(&mut self.despawn_queue);
        for e in despawns {
            let i = e as usize;
            self.clear_components(i);
            self.alive[i] = false;
            self.pending_spawn[i] = false;
            self.pending_despawn[i] = false;
        }
        let spawns = std::mem::take(&mut self.spawn_queue);
        for e in spawns {
            let i = e as usize;
            if !self.pending_spawn[i] {
                continue; // cancelled by a queued despawn above
            }
            self.pending_spawn[i] = false;
            self.alive[i] = true;
        }
    }

    /// Live = committed or queued-spawn, minus queued-despawn.
    pub fn is_alive(&self, e: Entity) -> bool {
        let i = e as usize;
        self.reserved(e) && (self.alive[i] || self.pending_spawn[i]) && !self.pending_despawn[i]
    }
}

impl Default for World {
    fn default() -> Self {
        Self::new()
    }
}
