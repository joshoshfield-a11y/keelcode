//! Scripted-input tests: press/release edges on the exact tick, axis math,
//! out-of-order script sorting, unknown actions rejected at load.

use keel_rs::input::InputSys;

/// The demo's action/axis registrations (INTERFACE.md §input).
fn demo_input() -> InputSys {
    let mut inp = InputSys::new();
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
        inp.define_action(a);
    }
    inp.define_axis("moveX", "moveLeft", "moveRight");
    inp.define_axis("moveY", "moveBack", "moveFwd");
    inp
}

#[test]
fn edges_fire_on_the_exact_tick() {
    let mut inp = demo_input();
    // Deliberately out of tick order: load_script must sort them.
    inp.load_script(
        r#"{"events":[
            {"tick":9,"action":"moveFwd","down":false},
            {"tick":2,"action":"jump","down":true},
            {"tick":5,"action":"moveFwd","down":true},
            {"tick":3,"action":"jump","down":false}
        ]}"#,
    )
    .unwrap();

    for tick in 0u64..=12 {
        inp.update(tick);
        assert_eq!(inp.pressed("jump"), tick == 2, "tick {tick}");
        assert_eq!(inp.released("jump"), tick == 3, "tick {tick}");
        assert_eq!(inp.is_down("jump"), tick == 2, "tick {tick}");
        assert_eq!(inp.pressed("moveFwd"), tick == 5, "tick {tick}");
        assert_eq!(inp.released("moveFwd"), tick == 9, "tick {tick}");
        assert_eq!(
            inp.is_down("moveFwd"),
            (5..9).contains(&tick),
            "tick {tick}"
        );
        // Edges are one-tick pulses: never both true.
        assert!(!(inp.pressed("jump") && inp.released("jump")));
    }
}

#[test]
fn axis_math_pos_minus_neg() {
    let mut inp = demo_input();
    inp.load_script(
        r#"{"events":[
            {"tick":4,"action":"moveLeft","down":true},
            {"tick":5,"action":"moveRight","down":true},
            {"tick":6,"action":"moveLeft","down":false},
            {"tick":8,"action":"moveRight","down":false}
        ]}"#,
    )
    .unwrap();

    let expected = [
        (0, 0.0),
        (4, -1.0),
        (5, 0.0), // both down: pos - neg = 0
        (6, 1.0), // left released
        (8, 0.0),
    ];
    for (tick, axis) in expected {
        for t in 0..=tick {
            inp.update(t);
        }
        assert_eq!(inp.axis("moveX"), axis, "tick {tick}");
    }

    // moveY untouched by this script.
    let mut inp2 = demo_input();
    inp2.load_script(r#"{"events":[]}"#).unwrap();
    inp2.update(0);
    assert_eq!(inp2.axis("moveY"), 0.0);
    assert_eq!(inp2.axis("nope"), 0.0);
}

#[test]
fn unknown_action_errors_on_load() {
    let mut inp = demo_input();
    let err = inp
        .load_script(r#"{"events":[{"tick":0,"action":"fly","down":true}]}"#)
        .expect_err("unknown action must be an error");
    assert!(err.contains("fly"), "unexpected error: {err}");

    // A failed load leaves the previous (empty) log untouched: nothing fires.
    inp.update(0);
    assert!(!inp.is_down("jump"));
}

#[test]
fn malformed_script_errors() {
    let mut inp = demo_input();
    assert!(inp.load_script("not json").is_err());
    assert!(inp.load_script(r#"{"events":"nope"}"#).is_err());
}

#[test]
fn unknown_names_are_inert() {
    let inp = demo_input();
    assert!(!inp.is_down("nope"));
    assert!(!inp.pressed("nope"));
    assert!(!inp.released("nope"));
    assert_eq!(inp.axis("nope"), 0.0);
}
