//! `ecs` workstream tests per INTERFACE.md §ecs, plus schema-exact
//! serialization checks for the §components field names.

use glam::{DQuat, DVec3};
use keel_rs::components::*;
use keel_rs::ecs::{Component, ComponentId, Entity, World};
use serde_json::{Value, json};

fn transform(x: f64) -> Transform {
    Transform {
        position: DVec3::new(x, 0.0, 0.0),
        rotation: DQuat::IDENTITY,
        scale: DVec3::new(1.0, 1.0, 1.0),
    }
}

fn health(cur: f64) -> Health {
    Health {
        current: cur,
        max: 100.0,
    }
}

#[test]
fn spawn_insert_get_roundtrip() {
    let mut w = World::new();
    let e = w.spawn();
    w.insert(e, transform(3.0));
    w.insert(e, health(42.0));
    w.flush();

    let t = w.get::<Transform>(e).expect("transform present");
    assert_eq!(t.position, DVec3::new(3.0, 0.0, 0.0));
    assert_eq!(t.rotation, DQuat::IDENTITY);
    assert!(w.has::<Transform>(e));
    assert!(w.has::<Health>(e));
    assert!(!w.has::<Velocity>(e));
    assert_eq!(w.get::<Health>(e).unwrap().current, 42.0);
    assert!(w.get::<Velocity>(e).is_none());
}

#[test]
fn queued_spawn_visible_to_get_and_entities_before_flush() {
    let mut w = World::new();
    let e = w.spawn();
    w.insert(e, transform(1.0));

    // No flush yet: get() sees the queued spawn + insert (TS
    // committed()/spawnQueue semantics), and entities() lists it live.
    assert!(w.get::<Transform>(e).is_some());
    assert_eq!(w.entities(), vec![e]);
    assert!(w.is_alive(e));

    // query()/count() flush first (TS applyPending), committing the spawn.
    assert_eq!(w.query(&[ComponentId::Transform]), vec![e]);
    assert_eq!(w.count(), 1);
}

#[test]
fn despawn_hides_immediately() {
    let mut w = World::new();
    let e = w.spawn();
    w.insert(e, transform(1.0));
    w.flush();
    assert_eq!(w.count(), 1);

    w.despawn(e);
    // Hidden immediately, before any flush.
    assert!(w.get::<Transform>(e).is_none());
    assert!(!w.has::<Transform>(e));
    assert!(!w.is_alive(e));
    assert!(w.query(&[ComponentId::Transform]).is_empty());
    assert!(w.entities().is_empty());

    w.flush();
    assert_eq!(w.count(), 0);
    assert!(w.entities().is_empty());
}

#[test]
fn despawn_of_queued_spawn_cancels_it() {
    let mut w = World::new();
    let e = w.spawn();
    w.insert(e, transform(1.0));
    w.despawn(e); // spawn never committed
    w.flush();
    assert_eq!(w.count(), 0);
    assert!(w.query(&[ComponentId::Transform]).is_empty());
    assert!(!w.is_alive(e));
}

#[test]
fn insert_works_on_queued_entity_and_despawn_blocks_insert() {
    let mut w = World::new();
    let e = w.spawn();
    w.insert(e, health(10.0)); // insert before flush
    assert_eq!(w.get::<Health>(e).unwrap().current, 10.0);

    w.despawn(e);
    w.insert(e, health(99.0)); // no-op on despawn-queued entity (TS set() early-return)
    assert!(w.get::<Health>(e).is_none());
    w.flush();
    assert_eq!(w.count(), 0);
}

#[test]
fn query_multi_component_and_ascending() {
    let mut w = World::new();
    let a = w.spawn();
    w.insert(a, transform(0.0));
    w.insert(a, health(1.0));
    let b = w.spawn();
    w.insert(b, transform(0.0)); // no health
    let c = w.spawn();
    w.insert(c, transform(0.0));
    w.insert(c, health(1.0));
    w.insert(c, Player); // marker
    w.flush();

    // AND semantics: only a and c have both Transform and Health.
    let got = w.query(&[ComponentId::Transform, ComponentId::Health]);
    assert_eq!(got, vec![a, c]);
    assert!(got.windows(2).all(|p| p[0] < p[1]), "ascending id order");

    // Single-component query.
    assert_eq!(w.query(&[ComponentId::Player]), vec![c]);
    // Empty component list matches everything alive.
    assert_eq!(w.query(&[]), vec![a, b, c]);
}

#[test]
fn get_mut_edits_in_place() {
    let mut w = World::new();
    let e = w.spawn();
    w.insert(e, health(10.0));
    w.flush();
    w.get_mut::<Health>(e).unwrap().current = 7.0;
    assert_eq!(w.get::<Health>(e).unwrap().current, 7.0);
    // Unknown ids fail clean.
    assert!(w.get_mut::<Health>(9999).is_none());
    assert!(w.get::<Health>(9999).is_none());
}

#[test]
fn entity_ids_monotonic_from_one() {
    let mut w = World::new();
    let a = w.spawn();
    let b = w.spawn();
    assert_eq!((a, b), (1, 2));
    w.despawn(a);
    w.flush();
    let c = w.spawn(); // ids are never reused
    assert_eq!(c, 3);
    assert_eq!(w.entities(), vec![2, 3]);
}

#[test]
fn foreign_component_with_bogus_id_fails_clean() {
    // A downstream type can implement Component, but a lying id() must not
    // cause UB or phantom data: the TypeId-guarded dispatch returns None.
    struct Bogus;
    impl Component for Bogus {
        fn id() -> ComponentId {
            ComponentId::Transform
        }
    }
    let mut w = World::new();
    let e: Entity = w.spawn();
    w.insert(e, transform(5.0));
    w.insert::<Bogus>(e, Bogus); // no-op: matches no slot type
    assert!(w.get::<Bogus>(e).is_none());
    assert!(!w.has::<Bogus>(e));
    // The real Transform slot is untouched.
    assert_eq!(w.get::<Transform>(e).unwrap().position.x, 5.0);
}

// --- schema-exact serialization (portable surface) ---

#[test]
fn component_json_field_names_match_schema() {
    let t = transform(1.0);
    let v: Value = serde_json::to_value(t).unwrap();
    assert_eq!(
        v,
        json!({
            "position": {"x": 1.0, "y": 0.0, "z": 0.0},
            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0},
            "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
        })
    );

    let r = Renderable {
        mesh_ref: "player".into(),
        material_ref: "mat".into(),
        visible: true,
    };
    assert_eq!(
        serde_json::to_value(&r).unwrap(),
        json!({"meshRef": "player", "materialRef": "mat", "visible": true})
    );

    let c = Collider {
        shape: ShapeKind::Capsule,
        size: vec![0.5, 1.0],
        is_trigger: false,
    };
    assert_eq!(
        serde_json::to_value(&c).unwrap(),
        json!({"shape": "capsule", "size": [0.5, 1.0], "isTrigger": false})
    );
    // Box serializes lowercase too.
    let b = Collider {
        shape: ShapeKind::Box,
        size: vec![1.0, 1.0, 1.0],
        is_trigger: true,
    };
    assert_eq!(serde_json::to_value(&b).unwrap()["shape"], json!("box"));

    let p = ProjectileComp {
        damage: 10.0,
        owner_id: 7,
        piercing: false,
    };
    assert_eq!(
        serde_json::to_value(p).unwrap(),
        json!({"damage": 10.0, "ownerId": 7, "piercing": false})
    );

    let pk = PickupComp {
        effect_id: "heal".into(),
        value: 25.0,
    };
    assert_eq!(
        serde_json::to_value(&pk).unwrap(),
        json!({"effectId": "heal", "value": 25.0})
    );

    let ai = AIComp {
        brain_id: "chaser".into(),
        blackboard: json!({}),
    };
    assert_eq!(
        serde_json::to_value(&ai).unwrap(),
        json!({"brainId": "chaser", "blackboard": {}})
    );

    // Marker components serialize as null.
    assert_eq!(serde_json::to_value(Player).unwrap(), Value::Null);
    assert_eq!(serde_json::to_value(Enemy).unwrap(), Value::Null);

    // Component name strings match the TS `C` map.
    assert_eq!(ComponentId::Transform.name(), "Transform");
    assert_eq!(ComponentId::Input.name(), "Input");
    assert_eq!(ComponentId::AI.name(), "AI");
    assert_eq!(ComponentId::Script.name(), "Script");
    assert_eq!(ComponentId::Player.name(), "Player");
    assert_eq!(ComponentId::Enemy.name(), "Enemy");
}
