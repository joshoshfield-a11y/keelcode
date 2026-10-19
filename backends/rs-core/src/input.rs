//! Action-based input for the headless backend.
//!
//! Mirrors the TS action model (`defineAction`/`defineAxis`/`isDown`/`pressed`/
//! `released`/`axis`), with the hardware sources replaced by a scripted event
//! log (`load_script`). `update(tick)` snapshots once per tick — the sim loop
//! calls it in PreUpdate — and all sim substeps read the same snapshot.
//!
//! Storage is `BTreeMap`-only (no `HashMap` iteration anywhere).

use std::collections::BTreeMap;

#[derive(Clone, Copy, Default)]
struct ActionState {
    down: bool,
    prev: bool,
    pressed: bool,
    released: bool,
}

#[derive(Clone)]
struct InputEvent {
    tick: u64,
    action: String,
    down: bool,
}

/// Scripted input log: action press/release events keyed to sim ticks.
pub struct InputSys {
    actions: BTreeMap<String, ActionState>,
    axes: BTreeMap<String, (String, String)>, // name -> (neg, pos)
    events: Vec<InputEvent>,
    cursor: usize, // first unprocessed event; events are tick-sorted
}

impl InputSys {
    pub fn new() -> Self {
        Self {
            actions: BTreeMap::new(),
            axes: BTreeMap::new(),
            events: Vec::new(),
            cursor: 0,
        }
    }

    pub fn define_action(&mut self, name: &str) {
        self.actions
            .insert(name.to_string(), ActionState::default());
    }

    pub fn define_axis(&mut self, name: &str, neg: &str, pos: &str) {
        self.axes
            .insert(name.to_string(), (neg.to_string(), pos.to_string()));
    }

    /// Load and sort the scripted event log (`{"events":[{tick,action,down}]}`).
    /// Unknown actions are an error; a successful load replaces the log.
    pub fn load_script(&mut self, json: &str) -> Result<(), String> {
        #[derive(serde::Deserialize)]
        struct ScriptEvent {
            tick: u64,
            action: String,
            down: bool,
        }
        #[derive(serde::Deserialize)]
        struct Script {
            events: Vec<ScriptEvent>,
        }
        let script: Script = serde_json::from_str(json)
            .map_err(|e| format!("input script is not valid JSON: {e}"))?;
        for e in &script.events {
            if !self.actions.contains_key(&e.action) {
                return Err(format!(
                    "input script references unknown action '{}'",
                    e.action
                ));
            }
        }
        let mut events: Vec<InputEvent> = script
            .events
            .into_iter()
            .map(|e| InputEvent {
                tick: e.tick,
                action: e.action,
                down: e.down,
            })
            .collect();
        events.sort_by_key(|e| e.tick); // stable: script order kept within a tick
        self.events = events;
        self.cursor = 0;
        Ok(())
    }

    /// Snapshot for `tick`: apply due events in order, then derive edges.
    /// Called in PreUpdate. An event with a tick behind the current one is
    /// dropped; that cannot happen under the fixed-step loop, which calls
    /// `update` once per tick in ascending order.
    pub fn update(&mut self, tick: u64) {
        while self.cursor < self.events.len() && self.events[self.cursor].tick < tick {
            self.cursor += 1; // stale
        }
        while self.cursor < self.events.len() && self.events[self.cursor].tick == tick {
            let down = self.events[self.cursor].down;
            let action = self.events[self.cursor].action.clone();
            if let Some(a) = self.actions.get_mut(&action) {
                a.down = down;
            }
            self.cursor += 1;
        }
        for a in self.actions.values_mut() {
            a.pressed = a.down && !a.prev;
            a.released = !a.down && a.prev;
            a.prev = a.down;
        }
    }

    pub fn is_down(&self, name: &str) -> bool {
        self.actions.get(name).is_some_and(|a| a.down)
    }

    /// Live-input hook (Wave 2b desktop binary): set an action's `down`
    /// state directly, outside the scripted log. Unknown actions are
    /// ignored. Edges (`pressed`/`released`) are derived by the next
    /// `update(tick)` call exactly as for scripted events, so a key held
    /// across frames yields one `pressed` tick. Additive — script behavior
    /// is untouched.
    pub fn set_action_state(&mut self, name: &str, down: bool) {
        if let Some(a) = self.actions.get_mut(name) {
            a.down = down;
        }
    }

    /// True on the tick an action goes down (per-tick edge, like the TS
    /// scripted input; sub-frame taps are not a concept here).
    pub fn pressed(&self, name: &str) -> bool {
        self.actions.get(name).is_some_and(|a| a.pressed)
    }

    /// True on the tick an action goes up.
    pub fn released(&self, name: &str) -> bool {
        self.actions.get(name).is_some_and(|a| a.released)
    }

    /// `pos`-down as 1 minus `neg`-down as 1; unknown axes read 0.
    pub fn axis(&self, name: &str) -> f64 {
        let Some((neg, pos)) = self.axes.get(name) else {
            return 0.0;
        };
        let p = if self.is_down(pos) { 1.0 } else { 0.0 };
        let n = if self.is_down(neg) { 1.0 } else { 0.0 };
        p - n
    }
}

impl Default for InputSys {
    fn default() -> Self {
        Self::new()
    }
}
