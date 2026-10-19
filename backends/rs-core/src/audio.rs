//! Audio driver boundary (Wave 2a): the null driver.
//!
//! The demo wires game events to `play()` calls so real drivers can attach in
//! Wave 2b; nothing in the sim blocks on audio.

/// Audio output driver.
pub trait AudioDriver {
    fn play(&mut self, name: &str);
}

/// Discards all playback; keeps the sim headless and deterministic.
#[derive(Default)]
pub struct NullAudio;

impl AudioDriver for NullAudio {
    fn play(&mut self, _name: &str) {}
}
