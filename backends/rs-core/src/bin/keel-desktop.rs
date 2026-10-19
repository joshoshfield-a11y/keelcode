//! `keel-desktop` — native desktop binary (Wave 2b).
//!
//! ```sh
//! keel-desktop [--seed <u32>]
//! ```
//! Opens a winit window, runs the arena [`Demo`][keel_rs::demo::Demo] on
//! wall-clock via [`GameLoop::frame`][keel_rs::sim_loop::GameLoop] (the exact
//! same phase handlers the headless binary uses — no reimplementation),
//! and draws it with the minimal wgpu renderer.
//!
//! Controls: WASD/arrows move, Space jump, Shift sprint, left-click fire,
//! Esc pause, Enter start/restart. No mouse-look in 2b (the camera follows
//! the player like the headless demo).

use std::sync::Arc;
use std::time::Instant;

use clap::Parser;
use winit::application::ApplicationHandler;
use winit::event::{ElementState, KeyEvent, MouseButton, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::Window;

use keel_rs::demo::Demo;
use keel_rs::render::renderer::Renderer;
use keel_rs::render::window::{OverlayKind, create_window};

#[derive(Parser)]
#[command(
    name = "keel-desktop",
    about = "KeelCode Rust backend — desktop arena demo"
)]
struct Args {
    /// Master seed (the TS reference uses 1337).
    #[arg(long, default_value_t = 1337)]
    seed: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum AppState {
    /// Sim constructed and bound, no frames run yet.
    Title,
    Playing,
    Paused,
    Over,
}

impl AppState {
    fn overlay(self) -> OverlayKind {
        match self {
            AppState::Title => OverlayKind::Title,
            AppState::Playing => OverlayKind::None,
            AppState::Paused => OverlayKind::Paused,
            AppState::Over => OverlayKind::GameOver,
        }
    }
}

fn key_action(code: KeyCode) -> Option<&'static str> {
    match code {
        KeyCode::KeyW | KeyCode::ArrowUp => Some("moveFwd"),
        KeyCode::KeyS | KeyCode::ArrowDown => Some("moveBack"),
        KeyCode::KeyA | KeyCode::ArrowLeft => Some("moveLeft"),
        KeyCode::KeyD | KeyCode::ArrowRight => Some("moveRight"),
        KeyCode::Space => Some("jump"),
        KeyCode::ShiftLeft | KeyCode::ShiftRight => Some("sprint"),
        _ => None,
    }
}

const ACTIONS: [&str; 8] = [
    "moveFwd",
    "moveBack",
    "moveLeft",
    "moveRight",
    "jump",
    "sprint",
    "fire",
    "pause",
];

struct App {
    window: Option<Arc<Window>>,
    renderer: Option<Renderer>,
    demo: Demo,
    state: AppState,
    seed: u32,
    t0: Instant,
    frames: u32,
    fps_window_start: f64,
    fps: u32,
    last_render_error: Option<String>,
}

impl App {
    fn new(seed: u32) -> Self {
        let mut demo = Demo::new(seed);
        demo.bind_phases();
        Self {
            window: None,
            renderer: None,
            demo,
            state: AppState::Title,
            seed,
            t0: Instant::now(),
            frames: 0,
            fps_window_start: 0.0,
            fps: 0,
            last_render_error: None,
        }
    }

    fn now_ms(&self) -> f64 {
        self.t0.elapsed().as_secs_f64() * 1000.0
    }

    /// Release every action (hygiene on state transitions so a key held
    /// through a pause/restart cannot stick).
    fn clear_actions(&mut self) {
        for a in ACTIONS {
            self.demo.set_action_state(a, false);
        }
    }

    fn set_state(&mut self, s: AppState) {
        self.state = s;
        self.clear_actions();
        self.update_title();
    }

    fn start_playing(&mut self) {
        self.demo = Demo::new(self.seed);
        self.demo.bind_phases();
        self.set_state(AppState::Playing);
    }

    fn toggle_pause(&mut self) {
        match self.state {
            AppState::Playing => self.set_state(AppState::Paused),
            AppState::Paused => self.set_state(AppState::Playing),
            _ => {}
        }
    }

    fn update_title(&self) {
        if let Some(w) = &self.window {
            w.set_title(&format!(
                "KeelCode arena — {} — {} fps",
                self.state.overlay().label(),
                self.fps
            ));
        }
    }

    fn tick_frame(&mut self) {
        // Sim step first (needs &mut self, no renderer borrow held).
        if self.state == AppState::Playing {
            let now = self.now_ms();
            self.demo.frame(now);
            // Game over: the sim's `die()` sets Mode::Over (no public
            // getter), which the outcome vector exposes as player hp ≤ 0.
            let hp = self.demo.outcome_vector()["player"]["hp"]
                .as_f64()
                .unwrap_or(1.0);
            if hp <= 0.0 {
                self.set_state(AppState::Over);
            }
        }

        let window = match &self.window {
            Some(w) => w.clone(),
            None => return,
        };
        let renderer = match &mut self.renderer {
            Some(r) => r,
            None => return,
        };

        let snap = self.demo.render_snapshot();
        match renderer.render(&snap, self.state.overlay()) {
            Ok(_) => {
                self.last_render_error = None;
            }
            Err(e) => {
                // Don't spam: log once per distinct error.
                if self.last_render_error.as_deref() != Some(e.as_str()) {
                    eprintln!("keel-desktop: render error: {e}");
                    self.last_render_error = Some(e);
                }
            }
        }

        // `fire` is a one-shot per click: pressed edge consumed by this
        // frame's PreUpdate, released right after.
        self.demo.set_action_state("fire", false);

        self.frames += 1;
        let now_s = self.now_ms() / 1000.0;
        if now_s - self.fps_window_start >= 0.5 {
            self.fps = (self.frames as f64 / (now_s - self.fps_window_start).max(1e-6)) as u32;
            self.frames = 0;
            self.fps_window_start = now_s;
            self.update_title();
        }

        window.request_redraw();
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        event_loop.set_control_flow(ControlFlow::Poll);
        let window = match create_window(event_loop, "KeelCode arena") {
            Ok(w) => w,
            Err(e) => {
                eprintln!("keel-desktop: {e}");
                event_loop.exit();
                return;
            }
        };
        match Renderer::new(&window) {
            Ok(r) => {
                self.window = Some(window);
                self.renderer = Some(r);
                self.update_title();
            }
            Err(e) => {
                // Expected on a GPU-less box: everything up to the adapter
                // request worked (window created, sim bound).
                eprintln!("keel-desktop: {e}");
                event_loop.exit();
            }
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: winit::window::WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                if let Some(r) = &mut self.renderer {
                    r.resize(size.width, size.height);
                }
            }
            WindowEvent::KeyboardInput {
                event:
                    KeyEvent {
                        physical_key: PhysicalKey::Code(code),
                        state,
                        repeat,
                        ..
                    },
                ..
            } => {
                if repeat {
                    return;
                }
                let down = state == ElementState::Pressed;
                if let Some(action) = key_action(code) {
                    self.demo.set_action_state(action, down);
                }
                if !down {
                    return;
                }
                match code {
                    KeyCode::Escape => self.toggle_pause(),
                    KeyCode::Enter => match self.state {
                        AppState::Title => self.set_state(AppState::Playing),
                        AppState::Over => self.start_playing(),
                        _ => {}
                    },
                    _ => {}
                }
            }
            WindowEvent::MouseInput { state, button, .. } => {
                if button == MouseButton::Left {
                    // One-shot: released at the end of tick_frame().
                    self.demo
                        .set_action_state("fire", state == ElementState::Pressed);
                }
            }
            WindowEvent::RedrawRequested => self.tick_frame(),
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        // Poll mode: keep redrawing every loop iteration.
        if let Some(w) = &self.window {
            w.request_redraw();
        }
    }
}

fn main() {
    let args = Args::parse();
    let event_loop = match EventLoop::new() {
        Ok(el) => el,
        Err(e) => {
            eprintln!("keel-desktop: cannot create event loop (no display?): {e}");
            std::process::exit(3);
        }
    };
    let mut app = App::new(args.seed);
    if let Err(e) = event_loop.run_app(&mut app) {
        eprintln!("keel-desktop: event loop error: {e}");
        std::process::exit(3);
    }
}
