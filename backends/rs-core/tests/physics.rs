//! PhysicsSys tests (per INTERFACE.md §physics): a dynamic capsule falls
//! under gravity onto a static ground box and rests near the expected
//! height; teleport moves exactly; remove drops the body.

use glam::DVec3;
use keel_rs::components::ShapeKind;
use keel_rs::physics::{BodyOpts, PhysicsSys};

/// The sim's fixed step.
const DT: f64 = 1.0 / 60.0;

fn body(kind: ShapeKind, hx: f64, hy: f64, hz: f64, pos: DVec3, is_static: bool) -> BodyOpts {
    BodyOpts {
        kind,
        hx,
        hy,
        hz,
        pos,
        is_static,
    }
}

#[test]
fn capsule_falls_and_rests_on_static_ground() {
    let mut phys = PhysicsSys::new();
    // Ground: 40x1x40 box, top surface at y = 0.5.
    let ground = phys.add_body(body(
        ShapeKind::Box,
        20.0,
        0.5,
        20.0,
        DVec3::new(0.0, 0.0, 0.0),
        true,
    ));
    // Capsule: radius 0.4, half-height 0.5, dropped from y = 5.
    let capsule = phys.add_body(body(
        ShapeKind::Capsule,
        0.4,
        0.5,
        0.4,
        DVec3::new(0.0, 5.0, 0.0),
        false,
    ));

    for _ in 0..300 {
        phys.step(DT);
    }

    let p = phys
        .get_position(capsule)
        .expect("capsule still registered");
    // Capsule half-extent 0.5 + 0.4 = 0.9; ground top 0.5 → rest center ≈ 1.4.
    assert!(
        p.y > 1.2,
        "capsule fell through the ground box: y = {}",
        p.y
    );
    assert!(
        (p.y - 1.4).abs() < 0.15,
        "capsule did not rest near the expected height 1.4: y = {}",
        p.y
    );
    assert!(
        p.x.abs() < 0.05 && p.z.abs() < 0.05,
        "capsule drifted sideways: {:?}",
        p
    );
    // The static ground never moved.
    assert_eq!(phys.get_position(ground), Some(DVec3::new(0.0, 0.0, 0.0)));
}

#[test]
fn teleport_moves_exactly() {
    let mut phys = PhysicsSys::new();
    let id = phys.add_body(body(
        ShapeKind::Sphere,
        0.5,
        0.5,
        0.5,
        DVec3::new(0.0, 1.0, 0.0),
        false,
    ));

    let target = DVec3::new(3.0, 4.0, 5.0);
    phys.set_kinematic_position(id, target);
    assert_eq!(phys.get_position(id), Some(target));

    // A physics step with zero velocity keeps the teleported body put.
    phys.set_velocity(id, DVec3::ZERO);
    phys.step(DT);
    let p = phys.get_position(id).unwrap();
    assert!(
        (p - target).length() < 0.02,
        "body drifted off the teleport point: {:?}",
        p
    );
}

#[test]
fn remove_drops_the_body() {
    let mut phys = PhysicsSys::new();
    let a = phys.add_body(body(
        ShapeKind::Box,
        0.5,
        0.5,
        0.5,
        DVec3::new(0.0, 2.0, 0.0),
        false,
    ));
    let b = phys.add_body(body(
        ShapeKind::Box,
        0.5,
        0.5,
        0.5,
        DVec3::new(5.0, 2.0, 0.0),
        false,
    ));
    assert!(phys.get_position(a).is_some());
    assert!(phys.get_position(b).is_some());

    phys.remove_body(a);
    assert_eq!(phys.get_position(a), None, "removed body still queryable");

    // Stepping after removal neither resurrects it nor disturbs the other body.
    for _ in 0..10 {
        phys.step(DT);
    }
    assert_eq!(phys.get_position(a), None);
    assert!(phys.get_position(b).is_some());

    // Unknown ids fail clean, never panic.
    assert_eq!(phys.get_position(999), None);
    phys.remove_body(999);
    phys.set_velocity(999, DVec3::new(1.0, 1.0, 1.0));
    phys.set_kinematic_position(999, DVec3::ZERO);
}
