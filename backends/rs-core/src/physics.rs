//! Rapier physics behind the driver boundary.
//!
//! Mirrors `backends/ts-three/src/engine/physics.ts` (rapier3d 0.22, f32).
//! Sim math is `f64` (`glam::DVec3`); `f32` lives only here, converted at
//! the Rapier boundary. rapier3d 0.22 has no `f64` feature — the TS side's
//! WASM build is also f32, so this is the closest behavioral match.
//!
//! Exact mapping (per INTERFACE.md §physics):
//! - gravity `(0, -9.81, 0)`; static → `RigidBodyBuilder::fixed()`,
//!   dynamic → `RigidBodyBuilder::dynamic()`
//! - box → `ColliderBuilder::cuboid(hx,hy,hz)`; sphere → `ball(max(hx,0.001))`;
//!   capsule → `capsule_y(max(hy,0.0), max(hx,0.001))` (Y-axis, matching
//!   rapier.js `ColliderDesc.capsule`)
//! - `set_kinematic_position` teleports: `set_translation(v, true)` (wake)
//! - world steps at the sim's fixed dt via `PhysicsPipeline::step`, never at
//!   frame dt
//!
//! Note: 0.22 names the builders `RigidBodyBuilder`/`ColliderBuilder` (the
//! `RigidBodyDesc`/`ColliderDesc` names exist only in the rapier.js TS API).

use std::collections::BTreeMap;

use glam::DVec3;
use rapier3d::prelude::*;

use crate::components::ShapeKind;

/// Body construction options (mirrors TS `BodyOpts`).
pub struct BodyOpts {
    pub kind: ShapeKind,
    pub hx: f64,
    pub hy: f64,
    pub hz: f64,
    pub pos: DVec3,
    pub is_static: bool,
}

/// Gravity used by the sim, matching the TS reference.
const GRAVITY: [Real; 3] = [0.0, -9.81, 0.0];

/// f64 sim position → f32 Rapier vector.
fn to_vec(p: DVec3) -> Vector<Real> {
    Vector::new(p.x as Real, p.y as Real, p.z as Real)
}

/// f32 Rapier vector → f64 sim position.
fn to_dvec(v: &Vector<Real>) -> DVec3 {
    DVec3::new(v.x as f64, v.y as f64, v.z as f64)
}

pub struct PhysicsSys {
    pipeline: PhysicsPipeline,
    islands: IslandManager,
    broad_phase: BroadPhaseMultiSap,
    narrow_phase: NarrowPhase,
    bodies: RigidBodySet,
    colliders: ColliderSet,
    impulse_joints: ImpulseJointSet,
    multibody_joints: MultibodyJointSet,
    ccd_solver: CCDSolver,
    query_pipeline: QueryPipeline,
    gravity: Vector<Real>,
    ids: BTreeMap<u32, RigidBodyHandle>,
    next_id: u32,
}

impl Default for PhysicsSys {
    fn default() -> Self {
        Self::new()
    }
}

impl PhysicsSys {
    pub fn new() -> Self {
        Self {
            pipeline: PhysicsPipeline::new(),
            islands: IslandManager::new(),
            broad_phase: BroadPhaseMultiSap::new(),
            narrow_phase: NarrowPhase::new(),
            bodies: RigidBodySet::new(),
            colliders: ColliderSet::new(),
            impulse_joints: ImpulseJointSet::new(),
            multibody_joints: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
            query_pipeline: QueryPipeline::new(),
            gravity: Vector::new(GRAVITY[0], GRAVITY[1], GRAVITY[2]),
            ids: BTreeMap::new(),
            next_id: 1, // mirrors the TS `nextId` starting at 1
        }
    }

    /// Step at the sim's fixed dt (1/60). Never at frame dt.
    pub fn step(&mut self, dt: f64) {
        let params = IntegrationParameters {
            dt: dt as Real,
            ..Default::default()
        };
        let Self {
            pipeline,
            gravity,
            islands,
            broad_phase,
            narrow_phase,
            bodies,
            colliders,
            impulse_joints,
            multibody_joints,
            ccd_solver,
            query_pipeline,
            ..
        } = self;
        pipeline.step(
            gravity,
            &params,
            islands,
            broad_phase,
            narrow_phase,
            bodies,
            colliders,
            impulse_joints,
            multibody_joints,
            ccd_solver,
            Some(query_pipeline),
            &(),
            &(),
        );
    }

    pub fn add_body(&mut self, o: BodyOpts) -> u32 {
        let builder = if o.is_static {
            RigidBodyBuilder::fixed()
        } else {
            RigidBodyBuilder::dynamic()
        };
        let body = builder.translation(to_vec(o.pos)).build();
        let handle = self.bodies.insert(body);
        let collider_builder = match o.kind {
            ShapeKind::Box => ColliderBuilder::cuboid(o.hx as Real, o.hy as Real, o.hz as Real),
            ShapeKind::Sphere => ColliderBuilder::ball((o.hx as Real).max(0.001)),
            ShapeKind::Capsule => {
                ColliderBuilder::capsule_y((o.hy as Real).max(0.0), (o.hx as Real).max(0.001))
            }
        };
        let collider = collider_builder.build();
        self.colliders
            .insert_with_parent(collider, handle, &mut self.bodies);
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.ids.insert(id, handle);
        id
    }

    pub fn remove_body(&mut self, id: u32) {
        if let Some(handle) = self.ids.remove(&id) {
            self.bodies.remove(
                handle,
                &mut self.islands,
                &mut self.colliders,
                &mut self.impulse_joints,
                &mut self.multibody_joints,
                true,
            );
        }
    }

    pub fn get_position(&self, id: u32) -> Option<DVec3> {
        self.ids
            .get(&id)
            .and_then(|h| self.bodies.get(*h))
            .map(|b| to_dvec(b.translation()))
    }

    pub fn set_velocity(&mut self, id: u32, v: DVec3) {
        if let Some(handle) = self.ids.get(&id)
            && let Some(body) = self.bodies.get_mut(*handle)
        {
            body.set_linvel(to_vec(v), true);
        }
    }

    /// Teleport-style kinematic move; the controller above owns the feel.
    pub fn set_kinematic_position(&mut self, id: u32, p: DVec3) {
        if let Some(handle) = self.ids.get(&id)
            && let Some(body) = self.bodies.get_mut(*handle)
        {
            body.set_translation(to_vec(p), true);
        }
    }
}
