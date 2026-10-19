//! Fixed 60 Hz loop with named scheduler phases and a shed guard.
//!
//! Mirrors `backends/ts-three/src/engine/loop.ts` exactly: the sim ticks at a
//! fixed 60 Hz via an accumulator; render interpolates between ticks
//! (`alpha = accumulator / STEP`) and never drives simulation.
//!
//! Guards (same as TS):
//! - frame time clamped at 0.1 s: a hitch sheds sim time instead of spiraling.
//! - max 5 catch-up steps per frame: beyond that the sim sheds load, logs the
//!   shed, and keeps running (slow-motion under load beats a lockup).
//! - `time_scale` scales how much wall time enters the accumulator, never the
//!   step size: every sim step is still exactly 1/60.
//! - `hit_stop` freezes the sim for N ms while the render phase keeps
//!   running, so juice (particles/screenshake) continues during the freeze.
//!
//! Phase order per frame: preupdate (input snapshot, once) -> N sim steps of
//! (update, postupdate) -> render. `step()` runs one full logical step
//! (preupdate + one 1/60 step) for tests; it ignores pause/time_scale.
//!
//! Note: the TS `Loop` drives itself via `requestAnimationFrame`
//! (`start()`/`stop()`); this headless port advances explicitly through
//! `frame(now_ms)`, so there is no `running` gate — every `frame()` call
//! runs the full pipeline.

/// Fixed sim step: 1/60 s.
pub const STEP: f64 = 1.0 / 60.0;
/// Max catch-up sim steps per frame before shedding.
pub const MAX_STEPS: u32 = 5;
/// Max wall-clock frame time admitted into the accumulator (seconds).
pub const MAX_FRAME: f64 = 0.1;

/// Named scheduler phases, in per-frame execution order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    PreUpdate,
    Update,
    PostUpdate,
    Render,
}

/// Per-phase context passed to handlers.
#[derive(Debug, Clone, Copy)]
pub struct FrameCtx {
    /// Sim step dt (1/60) during sim phases; real frame dt during render.
    pub dt: f64,
    /// Monotonic sim tick.
    pub tick: u64,
    /// Render interpolation factor, 0..1 (accumulator / STEP).
    pub alpha: f64,
    /// Current time scale.
    pub time_scale: f64,
}

type Handler = Box<dyn FnMut(&FrameCtx)>;

/// Fixed-timestep game loop. See module docs.
pub struct GameLoop {
    handlers: [Vec<Handler>; 4],
    ctx: FrameCtx,
    tick: u64,
    accumulator: f64,
    last_ms: Option<f64>,
    paused: bool,
    scale: f64,
    hit_stop_ms: f64,
    shed_count: u64,
}

impl GameLoop {
    pub fn new() -> Self {
        Self {
            handlers: std::array::from_fn(|_| Vec::new()),
            ctx: FrameCtx {
                dt: STEP,
                tick: 0,
                alpha: 1.0,
                time_scale: 1.0,
            },
            tick: 0,
            accumulator: 0.0,
            last_ms: None,
            paused: false,
            scale: 1.0,
            hit_stop_ms: 0.0,
            shed_count: 0,
        }
    }

    /// Register a handler for a scheduler phase.
    pub fn on(&mut self, phase: Phase, handler: Handler) {
        self.handlers[phase as usize].push(handler);
    }

    fn run_phase(&mut self, phase: Phase) {
        // Snapshot, like the TS loop's single reused ctx object: handlers see
        // a consistent view and cannot retain or mutate it (`&FrameCtx`).
        let c = self.ctx;
        for h in self.handlers[phase as usize].iter_mut() {
            h(&c);
        }
    }

    fn run_sim_step(&mut self, dt: f64) {
        self.tick += 1;
        self.ctx.tick = self.tick;
        self.ctx.dt = dt;
        self.ctx.time_scale = self.scale;
        self.run_phase(Phase::Update);
        self.run_phase(Phase::PostUpdate);
    }

    /// Advance with an explicit clock in ms (wall or virtual). Runs:
    /// preupdate once -> up to 5 sim steps of (update, postupdate) -> render.
    /// Clamps frame dt to 0.1 s; sheds + logs + counts when over 5 steps.
    pub fn frame(&mut self, now_ms: f64) {
        let frame_time = match self.last_ms {
            // First call: no wall time has elapsed yet (mirrors TS `start()`
            // seeding `last` before the first rAF fires).
            None => 0.0,
            Some(last) => {
                let mut ft = (now_ms - last) / 1000.0;
                // Deliberately not `ft.clamp(0.0, MAX_FRAME)`: clamp() panics
                // on NaN, while the TS reference propagates it; this if-chain
                // mirrors loop.ts line-for-line and never panics.
                #[allow(clippy::manual_clamp)]
                {
                    if ft > MAX_FRAME {
                        ft = MAX_FRAME;
                    }
                    if ft < 0.0 {
                        ft = 0.0;
                    }
                }
                ft
            }
        };
        self.last_ms = Some(now_ms);

        self.ctx.time_scale = self.scale;

        // Preupdate: input snapshot, exactly once per frame.
        self.ctx.dt = STEP;
        self.run_phase(Phase::PreUpdate);

        if self.hit_stop_ms > 0.0 {
            // Sim frozen; render still runs below.
            self.hit_stop_ms -= frame_time * 1000.0;
        } else if !self.paused {
            self.accumulator += frame_time * self.scale;
            let mut steps = 0;
            while self.accumulator >= STEP && steps < MAX_STEPS {
                self.run_sim_step(STEP);
                self.accumulator -= STEP;
                steps += 1;
            }
            if self.accumulator >= STEP {
                // Sim cannot keep up: shed honestly, log it, keep the game alive.
                self.shed_count += 1;
                self.accumulator = 0.0;
                eprintln!(
                    "[keelcode] loop shed sim time (shed #{}): sim slower than wall clock",
                    self.shed_count
                );
            }
        } else {
            self.accumulator = 0.0;
        }

        self.ctx.alpha = self.accumulator / STEP;
        self.ctx.dt = frame_time; // render phase: real frame dt for juice/smoothing
        self.run_phase(Phase::Render);
    }

    /// Manual single step: preupdate + one 1/60 step. Ignores pause,
    /// time_scale and hit-stop (same as TS `step()`).
    pub fn step(&mut self) {
        self.ctx.dt = STEP;
        self.run_phase(Phase::PreUpdate);
        self.run_sim_step(STEP);
    }

    pub fn tick(&self) -> u64 {
        self.tick
    }

    pub fn shed_count(&self) -> u64 {
        self.shed_count
    }

    /// Pause/unpause. Pausing clears the accumulator (never bank wall time
    /// while paused), mirroring TS `setPaused`.
    pub fn set_paused(&mut self, p: bool) {
        self.paused = p;
        if p {
            self.accumulator = 0.0;
        }
    }

    pub fn paused(&self) -> bool {
        self.paused
    }

    /// Set the time scale; negative values clamp to 0.
    pub fn set_time_scale(&mut self, x: f64) {
        self.scale = if x < 0.0 { 0.0 } else { x };
        self.ctx.time_scale = self.scale;
    }

    /// Freeze the sim for `ms` milliseconds; the render phase keeps running.
    /// Takes the max with any freeze already in effect (mirrors TS).
    pub fn hit_stop(&mut self, ms: f64) {
        if ms > self.hit_stop_ms {
            self.hit_stop_ms = ms;
        }
    }
}

impl Default for GameLoop {
    fn default() -> Self {
        Self::new()
    }
}
