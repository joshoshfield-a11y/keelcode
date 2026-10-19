//! `sim_loop` workstream tests per INTERFACE.md §sim_loop.

use keel_rs::sim_loop::{FrameCtx, GameLoop, Phase, STEP};
use std::cell::RefCell;
use std::rc::Rc;

type NameLog = Rc<RefCell<Vec<String>>>;
type CtxLog = Rc<RefCell<Vec<FrameCtx>>>;

/// Shared phase-call log: handlers push their phase name (and optionally ctx).
fn phase_log() -> (NameLog, CtxLog) {
    (
        Rc::new(RefCell::new(Vec::new())),
        Rc::new(RefCell::new(Vec::new())),
    )
}

fn watch(g: &mut GameLoop, phase: Phase, names: &NameLog, ctxs: &CtxLog, tag: &'static str) {
    let names = Rc::clone(names);
    let ctxs = Rc::clone(ctxs);
    g.on(
        phase,
        Box::new(move |ctx: &FrameCtx| {
            names.borrow_mut().push(tag.to_string());
            ctxs.borrow_mut().push(*ctx);
        }),
    );
}

fn watch_all(g: &mut GameLoop) -> (NameLog, CtxLog) {
    let (names, ctxs) = phase_log();
    for (phase, tag) in [
        (Phase::PreUpdate, "preupdate"),
        (Phase::Update, "update"),
        (Phase::PostUpdate, "postupdate"),
        (Phase::Render, "render"),
    ] {
        watch(g, phase, &names, &ctxs, tag);
    }
    (names, ctxs)
}

#[test]
fn shed_fires_on_1s_virtual_jump() {
    let mut g = GameLoop::new();
    g.frame(0.0);
    g.frame(1000.0); // 1 s jump: frame dt clamps to 0.1 s -> 6 steps owed, 5 run
    assert_eq!(g.shed_count(), 1, "exactly one shed");
    assert_eq!(g.tick(), 5, "exactly MAX_STEPS sim steps ran");
    // A follow-up frame with no new wall time must not shed again.
    g.frame(1000.0);
    assert_eq!(g.shed_count(), 1);
    assert_eq!(g.tick(), 5);
}

#[test]
fn step_runs_three_sim_phases_in_order() {
    let mut g = GameLoop::new();
    let (names, ctxs) = watch_all(&mut g);

    g.step();

    assert_eq!(g.tick(), 1, "step() advances tick by exactly 1");
    let names = names.borrow();
    assert_eq!(
        names.as_slice(),
        &["preupdate", "update", "postupdate"],
        "preupdate once, then one (update, postupdate) step; no render"
    );
    // ctx carried through the phases: tick incremented, dt = STEP.
    let ctxs = ctxs.borrow();
    assert_eq!(ctxs[0].tick, 0, "preupdate runs before the tick increments");
    assert_eq!(ctxs[1].tick, 1);
    assert_eq!(ctxs[2].tick, 1);
    assert!((ctxs[1].dt - STEP).abs() < f64::EPSILON);
}

#[test]
fn step_ignores_pause_time_scale_and_hit_stop() {
    let mut g = GameLoop::new();
    g.set_paused(true);
    g.set_time_scale(0.0);
    g.hit_stop(10_000.0);
    g.step();
    g.step();
    assert_eq!(g.tick(), 2, "step() ignores pause/time_scale/hit-stop");
}

#[test]
fn pause_freezes_tick_but_phases_still_run() {
    let mut g = GameLoop::new();
    let (names, _ctxs) = watch_all(&mut g);

    g.set_paused(true);
    assert!(g.paused());
    g.frame(0.0);
    g.frame(1000.0);
    g.frame(2000.0);
    assert_eq!(g.tick(), 0, "no sim ticks while paused");

    // preupdate + render still run once per frame while paused.
    {
        let names = names.borrow();
        assert_eq!(
            names.as_slice(),
            &[
                "preupdate",
                "render",
                "preupdate",
                "render",
                "preupdate",
                "render",
            ]
        );
    } // drop the borrow before running more frames

    // Unpausing resumes the sim (accumulator was cleared on pause, so no
    // banked wall time: the 0.1 s clamp yields 5 steps + one shed).
    g.set_paused(false);
    assert!(!g.paused());
    g.frame(3000.0);
    assert_eq!(g.tick(), 5);
    assert_eq!(g.shed_count(), 1);
}

#[test]
fn hit_stop_freezes_sim_but_render_runs() {
    let mut g = GameLoop::new();
    let (names, ctxs) = watch_all(&mut g);

    g.hit_stop(100.0);
    g.frame(0.0); // ft=0:   freeze 100 -> 100
    g.frame(50.0); // ft=50ms: freeze 100 -> 50
    g.frame(100.0); // ft=50ms: freeze 50 -> 0
    assert_eq!(g.tick(), 0, "sim frozen across hit-stop frames");
    assert_eq!(g.shed_count(), 0);

    // Render (and preupdate) ran on every frame despite the freeze.
    let render_dt: f64 = {
        let names = names.borrow();
        let ctxs = ctxs.borrow();
        assert_eq!(
            names.as_slice(),
            &[
                "preupdate",
                "render",
                "preupdate",
                "render",
                "preupdate",
                "render",
            ]
        );
        // Render ctx carries the real frame dt, not the sim step.
        ctxs.iter()
            .zip(names.iter())
            .filter(|(_, n)| *n == "render")
            .map(|(c, _)| c.dt)
            .nth(1)
            .unwrap()
    };
    assert!((render_dt - 0.05).abs() < 1e-12);

    // Once the freeze expires the sim resumes: 50 ms -> 3 steps.
    g.frame(150.0);
    assert_eq!(g.tick(), 3);
}

#[test]
fn hit_stop_takes_the_max() {
    let mut g = GameLoop::new();
    g.hit_stop(50.0);
    g.hit_stop(30.0); // smaller: keeps 50
    g.frame(0.0);
    g.frame(49.0); // 49 ms < 50 ms: still frozen
    assert_eq!(g.tick(), 0);
    g.frame(50.0); // freeze expires exactly here; still frozen this frame
    assert_eq!(g.tick(), 0);
    // Freeze over: 10 ms of wall time flows into the accumulator, but that is
    // less than one STEP, so no tick yet (the time is banked, not lost).
    g.frame(60.0);
    assert_eq!(g.tick(), 0);
    // Another 10 ms banks a full STEP -> one tick.
    g.frame(70.0);
    assert_eq!(g.tick(), 1);
}

#[test]
fn time_scale_halves_step_rate() {
    // Frame every 1/30 s (float-exact: dt_ms/1000 == 2*STEP). Scale 1.0 runs
    // 2 steps/frame; scale 0.5 runs exactly 1 step/frame: the rate halves.
    let dt_ms = 1000.0 / 30.0;

    let mut half = GameLoop::new();
    half.set_time_scale(0.5);
    half.frame(0.0);
    for k in 1..=60 {
        half.frame(k as f64 * dt_ms);
    }

    let mut full = GameLoop::new();
    full.frame(0.0);
    for k in 1..=60 {
        full.frame(k as f64 * dt_ms);
    }

    assert_eq!(full.tick(), 120);
    assert_eq!(half.tick(), 60);
    assert_eq!(full.tick(), half.tick() * 2);
}

#[test]
fn negative_time_scale_clamps_to_zero() {
    let mut g = GameLoop::new();
    g.set_time_scale(-2.5); // clamps to 0: no wall time enters the accumulator
    g.frame(0.0);
    g.frame(1000.0);
    g.frame(2000.0);
    assert_eq!(g.tick(), 0);
    assert_eq!(g.shed_count(), 0);
}

#[test]
fn frame_ctx_render_gets_real_dt_and_alpha() {
    let mut g = GameLoop::new();
    let (names, ctxs) = watch_all(&mut g);
    g.frame(0.0);
    g.frame(1000.0 / 60.0); // one STEP of wall time -> exactly one sim step

    assert_eq!(g.tick(), 1);
    let names = names.borrow();
    let ctxs = ctxs.borrow();
    let render = ctxs
        .iter()
        .zip(names.iter())
        .filter(|(_, n)| *n == "render")
        .map(|(c, _)| *c)
        .next_back()
        .unwrap();
    assert!(
        (render.dt - STEP).abs() < 1e-9,
        "render dt is real frame dt"
    );
    assert!(
        (render.alpha - 0.0).abs() < 1e-9,
        "alpha = accumulator/STEP = 0 after exact step"
    );
    assert_eq!(render.tick, 1);
}
