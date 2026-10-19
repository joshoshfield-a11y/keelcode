//! winit window glue for the desktop binary (Wave 2b).
//!
//! [`OverlayKind`] is the 2b screen system: flat full-screen tint panels.
//! No text rendering in 2b — the screen name also goes into the window
//! title, where it is unambiguous.

use std::sync::Arc;

use winit::dpi::PhysicalSize;
use winit::event_loop::ActiveEventLoop;
use winit::window::{Window, WindowAttributes};

/// The 2b "screens": a flat tinted panel over the frozen/live arena plus a
/// window-title label. `Title` shows before the first sim frame runs;
/// `Paused` freezes the sim; `GameOver` on player death (Enter restarts).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum OverlayKind {
    None,
    Title,
    Paused,
    GameOver,
}

impl OverlayKind {
    /// Panel tint as linear-ish RGBA (renderer blends it over the scene).
    pub fn rgba(self) -> [f32; 4] {
        match self {
            OverlayKind::None => [0.0, 0.0, 0.0, 0.0],
            OverlayKind::Title => [0.02, 0.03, 0.06, 0.78],
            OverlayKind::Paused => [0.0, 0.0, 0.0, 0.45],
            OverlayKind::GameOver => [0.45, 0.05, 0.05, 0.5],
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            OverlayKind::None => "PLAYING",
            OverlayKind::Title => "TITLE — press Enter",
            OverlayKind::Paused => "PAUSED — Esc to resume",
            OverlayKind::GameOver => "GAME OVER — Enter to restart",
        }
    }
}

/// Create the desktop window (1280×720). Fails cleanly when there is no
/// display — this is the expected failure point on a headless box.
pub fn create_window(event_loop: &ActiveEventLoop, title: &str) -> Result<Arc<Window>, String> {
    let attrs = WindowAttributes::default()
        .with_title(title)
        .with_inner_size(PhysicalSize::new(1280u32, 720u32));
    event_loop
        .create_window(attrs)
        .map(Arc::new)
        .map_err(|e| format!("winit: create window: {e}"))
}
