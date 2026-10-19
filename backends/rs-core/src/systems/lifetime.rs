//! Lifetime countdown → despawn.
//!
//! Counts down every entity's `Lifetime.remaining` by `dt` and despawns the
//! entity when it reaches 0. Not wired into the arena demo's phases: the TS
//! reference (`main.ts`) wires player → enemies → projectiles → pickups →
//! physics.step, and none of the demo's entities carry a `Lifetime`
//! component (projectiles use their own pool, not ECS lifetimes). The system
//! exists for games built on the engine, and is unit-tested here.

use crate::components::Lifetime;
use crate::ecs::{ComponentId, World};

pub struct LifetimeSys;

impl LifetimeSys {
    pub fn update(dt: f64, world: &mut World) {
        let ids = world.query(&[ComponentId::Lifetime]);
        for id in ids {
            let expired = match world.get_mut::<Lifetime>(id) {
                Some(l) => {
                    l.remaining -= dt;
                    l.remaining <= 0.0
                }
                None => false,
            };
            if expired {
                world.despawn(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::Transform;
    use glam::{DQuat, DVec3};

    #[test]
    fn countdown_then_despawn() {
        let mut world = World::new();
        let e = world.spawn();
        world.insert(e, Lifetime { remaining: 0.04 });
        world.insert(
            e,
            Transform {
                position: DVec3::ZERO,
                rotation: DQuat::IDENTITY,
                scale: DVec3::ONE,
            },
        );
        LifetimeSys::update(1.0 / 60.0, &mut world);
        assert!(world.is_alive(e));
        // 0.04 - 1/60 > 0 → still alive; two more steps push it below 0
        LifetimeSys::update(1.0 / 60.0, &mut world);
        assert!(world.is_alive(e));
        LifetimeSys::update(1.0 / 60.0, &mut world);
        assert!(!world.is_alive(e));
        // the component row is gone after flush
        world.flush();
        assert!(world.get::<Lifetime>(e).is_none());
    }

    #[test]
    fn no_lifetime_components_noop() {
        let mut world = World::new();
        let e = world.spawn();
        world.insert(
            e,
            Transform {
                position: DVec3::ZERO,
                rotation: DQuat::IDENTITY,
                scale: DVec3::ONE,
            },
        );
        LifetimeSys::update(1.0 / 60.0, &mut world);
        assert!(world.is_alive(e));
    }
}
