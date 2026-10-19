# `keel-rs` Module Interface Contract — Wave 2a

Three workstreams (`ecs-loop`, `rng-input-save`, `physics`) implement against
this file in parallel. **Do not change a signature here without telling the
coordinator** — the demo workstream builds on these exact APIs.

Toolchain: `export PATH="$HOME/.cargo/bin:$PATH"` in every shell.
Crate: `keel-rs`, edition 2024, at `~/workspace/keelcode/backends/rs-core/`.
Gates per module: `cargo test`, `cargo clippy` clean, `cargo fmt --check` clean.

## Cross-cutting rules

- Sim math is `f64` everywhere (`glam::DVec3`, `glam::DQuat`). The only `f32`
  in the sim lives inside `physics.rs` at the Rapier boundary.
- **No `HashMap` iteration in sim code** (Rust randomizes it). `BTreeMap`,
  id-ordered `Vec`s, or slot arrays only. `HashMap` *storage* keyed by
  entity id is acceptable only if never iterated — prefer `Vec<Option<T>>`
  slot arrays indexed by entity id.
- No `bevy` crate. No panics on sim paths (`Option`/`Result`, fail clean).
- RNG salts are ASCII-only (documented assumption; `debug_assert!` it).

## `components` — canonical components, schema-exact field names

Field names follow `framework/schema/component.schema.json` exactly
(portable surface). `#[serde(rename_all = "camelCase")]` where the schema
uses camelCase. `glam` with the `serde` feature serializes `DVec3` as
`{"x","y","z"}` and `DQuat` as `{"x","y","z","w"}` — matching the schema.

```rust
pub struct Transform { pub position: DVec3, pub rotation: DQuat, pub scale: DVec3 }
pub struct Velocity { pub linear: DVec3, pub angular: DVec3 }
pub struct Health { pub current: f64, pub max: f64 }
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ShapeKind { Box, Sphere, Capsule }
pub struct Collider {
    pub shape: ShapeKind,
    #[serde(rename = "size")] pub size: Vec<f64>, // box:[hx,hy,hz] sphere:[r] capsule:[r,half_h]
    #[serde(rename = "isTrigger")] pub is_trigger: bool,
}
#[serde(rename_all = "camelCase")]
pub struct Renderable { pub mesh_ref: String, pub material_ref: String, pub visible: bool }
#[serde(rename_all = "camelCase")]
pub struct Script { pub behavior_id: String, pub params: serde_json::Value }
pub struct InputMarker { pub marker: bool }          // TS `Input`
#[serde(rename_all = "camelCase")]
pub struct AIComp { pub brain_id: String, pub blackboard: serde_json::Value }  // TS `AI`
pub struct Lifetime { pub remaining: f64 }
#[serde(rename_all = "camelCase")]
pub struct PickupComp { pub effect_id: String, pub value: f64 }  // TS `Pickup`
#[serde(rename_all = "camelCase")]
pub struct ProjectileComp { pub damage: f64, pub owner_id: u32, pub piercing: bool } // TS `Projectile`
pub struct Player;   // marker (serializes as null)
pub struct Enemy;    // marker (serializes as null)
```

Component name strings for saves/queries (match the TS `C` map):
`"Transform" "Velocity" "Health" "Collider" "Renderable" "Input" "AI"`
`"Lifetime" "Pickup" "Projectile" "Player" "Enemy"`.

## `ecs` — entity ids + per-component slot tables, queued mutation

Mirrors `backends/ts-three/src/engine/ecs.ts`: spawn/despawn queue to phase
end (`flush()`); `query()` flushes first and returns ids **ascending**;
`get` sees queued spawns/inserts and hides queued despawns — exactly the TS
`committed()`/`spawnQueue` semantics.

```rust
pub type Entity = u32;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ComponentId { Transform, Velocity, Health, Collider, Renderable,
    Script, Input, AI, Lifetime, Pickup, Projectile, Player, Enemy }

pub trait Component: 'static { fn id() -> ComponentId; }
// implemented for all 13 component types above

pub struct World { /* one Vec<Option<T>> slot table per component, id-indexed */ }

impl World {
    pub fn new() -> Self;
    /// Queue entity creation; returns the reserved id immediately.
    pub fn spawn(&mut self) -> Entity;
    /// Insert/overwrite a component. Works on queued (unflushed) entities too.
    pub fn insert<T: Component>(&mut self, e: Entity, c: T);
    /// Queue entity destruction (hides it from get/query immediately).
    pub fn despawn(&mut self, e: Entity);
    pub fn get<T: Component>(&self, e: Entity) -> Option<&T>;
    pub fn get_mut<T: Component>(&mut self, e: Entity) -> Option<&mut T>;
    pub fn has<T: Component>(&self, e: Entity) -> bool;
    /// Flush-then-collect: ids possessing ALL listed components, ascending.
    pub fn query(&mut self, ids: &[ComponentId]) -> Vec<Entity>;
    /// All live (flushed + queued-spawn, minus queued-despawn) ids, ascending.
    pub fn entities(&self) -> Vec<Entity>;
    pub fn count(&mut self) -> usize;   // flushes, like TS
    pub fn flush(&mut self);
    pub fn is_alive(&self, e: Entity) -> bool;
}
```

Tests (`tests/ecs.rs`): spawn/insert/get round-trip; queued spawn invisible to
`query` until `flush` but visible to `get`; despawn hides immediately;
`query` multi-component AND semantics in ascending id order; `count`.

## `sim_loop` — fixed 60 Hz loop, named phases, shed guard

Mirrors `backends/ts-three/src/engine/loop.ts` exactly:

```rust
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase { PreUpdate, Update, PostUpdate, Render }

pub struct FrameCtx {
    pub dt: f64,        // 1/60 in sim phases; real frame dt in Render
    pub tick: u64,      // monotonic sim tick
    pub alpha: f64,     // accumulator / STEP (render interpolation)
    pub time_scale: f64,
}

pub struct GameLoop { /* .. */ }

impl GameLoop {
    pub fn new() -> Self;
    pub fn on(&mut self, phase: Phase, handler: Box<dyn FnMut(&FrameCtx)>);
    /// Advance with an explicit clock in ms (wall or virtual). Runs:
    /// preupdate once → up to 5 sim steps of (update, postupdate) → render.
    /// Clamps frame dt to 0.1s; sheds + logs + counts when over 5 steps.
    pub fn frame(&mut self, now_ms: f64);
    /// Manual single step: preupdate + one 1/60 step. Ignores pause,
    /// time_scale and hit-stop (same as TS `step()`).
    pub fn step(&mut self);
    pub fn tick(&self) -> u64;
    pub fn shed_count(&self) -> u64;
    pub fn set_paused(&mut self, p: bool);   // clears accumulator when pausing
    pub fn paused(&self) -> bool;
    pub fn set_time_scale(&mut self, x: f64); // x < 0 clamps to 0
    /// Freeze the sim for `ms`; render phase keeps running.
    pub fn hit_stop(&mut self, ms: f64);
}
```

Constants: `STEP = 1.0/60.0`, `MAX_STEPS = 5`, `MAX_FRAME = 0.1`.
Shed: `eprintln!("[keelcode] loop shed sim time (shed #N): sim slower than wall clock")`
— the same testable signal as the TS `console.warn`.

Tests (`tests/loop.rs`): 5-step shed fires on a 1s virtual jump (shed_count
goes 1, tick advances exactly 5); `step()` advances tick by 1 and runs all
three sim phases in order; pause freezes tick; hit_stop freezes sim ticks
across `frame()` calls while render handlers still run; time_scale 0.5 halves
the step rate over virtual time.

## `rng` — mulberry32 + `hash_seed`, bit-exact with the TS recipe

Mirrors `backends/ts-three/src/engine/rng.ts`. `>>>` is a *logical* shift of
the u32 bit pattern — the recipe below is verified against node output.

```rust
/// mulberry32 PRNG. Returns a closure yielding [0, 1).
pub fn mulberry32(seed: u32) -> impl FnMut() -> f64 {
    let mut state: i32 = seed as i32;
    move || {
        state = state.wrapping_add(0x6D2B_79F5u32 as i32);
        let s: u32 = state as u32;
        let mut t: i32 = ((s ^ (s >> 15)) as i32)
            .wrapping_mul((1u32 | s) as i32);
        let tu: u32 = t as u32;
        t = t.wrapping_add(
            ((tu ^ (tu >> 7)) as i32).wrapping_mul((61u32 | tu) as i32),
        ) ^ t;
        let out: u32 = t as u32;
        ((out ^ (out >> 14)) as f64) / 4294967296.0
    }
}

/// FNV-1a over the salt bytes, then the TS finalizer mix with the master seed.
/// Salts are ASCII-only.
pub fn hash_seed(master: u32, salt: &str) -> u32 {
    debug_assert!(salt.is_ascii());
    let mut h: u32 = 0x811C_9DC5;
    for b in salt.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    let mut m: i32 = (master as i32) ^ (h as i32);
    m = ((m as u32 ^ ((m as u32) >> 16)) as i32)
        .wrapping_mul(0x45D9_F3Bu32 as i32);
    m = ((m as u32 ^ ((m as u32) >> 16)) as i32)
        .wrapping_mul(0x45D9_F3Bu32 as i32);
    m ^= ((m as u32) >> 16) as i32;
    m as u32
}
```

Ground-truth vectors (generated from the TS implementation via node,
2026-10-19 — tests MUST assert these):

| call | expected |
|---|---|
| `hash_seed(1337, "enemies")` | `3268439969` |
| `hash_seed(1337, "arena")` | `934351928` |
| `hash_seed(1337, "pickups")` | `2403452701` |
| `hash_seed(0, "")` | `431477908` |
| first 5 `mulberry32(3268439969)` | `0.66506679775193334, 0.81788854091428220, 0.89090276183560491, 0.027450599707663059, 0.98594892420805991` |
| first 3 `mulberry32(0)` | `0.26642920868471265, 0.00032974570058286190, 0.22327202744781971` |

Compare floats with `to_precision`/exact f64 equality — the recipe is
bit-exact, so `assert_eq!` on the f64 values is correct. Also assert stream
independence: consuming stream A never shifts stream B.

## `input` — action map + scripted input log (headless)

Mirrors the TS action model (`defineAction`/`defineAxis`/`isDown`/`pressed`/
`released`/`axis`) with the hardware sources replaced by a scripted log.

Script JSON format (`--input` file):
```json
{ "events": [
    { "tick": 0,   "action": "moveFwd", "down": true },
    { "tick": 120, "action": "moveFwd", "down": false },
    { "tick": 30,  "action": "jump",    "down": true },
    { "tick": 31,  "action": "jump",    "down": false }
]}
```

```rust
pub struct InputSys { /* BTreeMap<String, ActionState>, BTreeMap axes, sorted events */ }

impl InputSys {
    pub fn new() -> Self;
    pub fn define_action(&mut self, name: &str);
    pub fn define_axis(&mut self, name: &str, neg: &str, pos: &str);
    /// Load and sort the scripted event log. Unknown actions are an error.
    pub fn load_script(&mut self, json: &str) -> Result<(), String>;
    /// Snapshot for `tick`: apply due events, derive edges. Called in PreUpdate.
    pub fn update(&mut self, tick: u64);
    pub fn is_down(&self, name: &str) -> bool;
    pub fn pressed(&self, name: &str) -> bool;   // down && !prev
    pub fn released(&self, name: &str) -> bool;  // !down && prev
    pub fn axis(&self, name: &str) -> f64;       // pos-down as 1 minus neg-down as 1
}
```

The demo registers: actions `moveFwd moveBack moveLeft moveRight jump sprint
fire pause`; axes `moveX(moveLeft,moveRight)`, `moveY(moveBack,moveFwd)`.
`update(tick)` applies all events with `event.tick == tick` (events sorted;
a cursor avoids rescanning). `pressed` is true on the tick an action goes
down — matches TS edge semantics for scripted (per-tick) input.

Tests (`tests/input.rs`): script with press/release, edge on the exact tick,
axis math, unknown action errors on load.

## `save` — JSON envelope, checksum, atomic writes, forward-only migrations

Mirrors `backends/ts-three/src/engine/save.ts` including the checksum
envelope. File-backed (dir passed in); atomic via temp file + rename.

```rust
pub const CURRENT_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
pub struct SaveData {
    pub engine: String,        // always "keelcode"
    pub format_version: u32,
    pub seed: u32,
    pub tick: u64,
    /// entity id -> component name -> component JSON (names per §components)
    pub components: BTreeMap<u32, BTreeMap<String, serde_json::Value>>,
    pub score: u64,            // demo extension (TS DemoSave)
    /// demo-specific extra state (rng stream states, controller state, …)
    #[serde(default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

pub struct SaveSys { /* dir: PathBuf, namespace: String */ }

impl SaveSys {
    pub fn new(dir: &std::path::Path, namespace: &str) -> Self;
    /// Atomic: write `<slot>.tmp`, rename to `<slot>`. Stamps engine/version.
    pub fn save(&self, slot: &str, data: &SaveData) -> Result<(), String>;
    /// `None` on missing / corrupt / checksum-mismatch / newer-version —
    /// fail clean, never load garbage (mirrors TS).
    pub fn load(&self, slot: &str) -> Option<SaveData>;
    pub fn list(&self) -> Vec<String>;   // sorted, no .tmp entries
    pub fn remove(&self, slot: &str);
}
```

Envelope on disk: `{"sum": <fnv1a over inner JSON bytes>, "data": "<inner JSON>"}`,
`fnv1a` = 32-bit FNV-1a over the UTF-8 bytes (ASCII JSON ⇒ matches TS).
Forward-only migrations: `BTreeMap<u32, fn(SaveData) -> SaveData>` keyed by
from-version; empty for v1; a save with `format_version > CURRENT_VERSION`
loads as `None`. Filenames: `<namespace>:save:<slot>` (colon is legal in
filenames; keeps the TS slot-naming convention).

Tests (`tests/save.rs`): round-trip fidelity; tampered byte ⇒ `None`;
newer-version payload ⇒ `None`; `list` sorted without `.tmp`; temp file
never left behind.

## `audio` — null driver (Wave 2a)

```rust
pub trait AudioDriver { fn play(&mut self, name: &str); }
pub struct NullAudio;
impl AudioDriver for NullAudio { fn play(&mut self, _name: &str) {} }
```
The demo wires game events to `play()` calls so Wave 2b / real drivers can
attach later. No tests needed beyond a smoke.

## `physics` — rapier3d 0.22 behind the driver boundary

Mirrors `backends/ts-three/src/engine/physics.ts`. Crate `rapier3d = "=0.22.0"`
(f32-only — same precision as the TS WASM build; conversion at the boundary).

```rust
pub struct BodyOpts {
    pub kind: ShapeKind,          // from components
    pub hx: f64, pub hy: f64, pub hz: f64,
    pub pos: DVec3,
    pub is_static: bool,
}

pub struct PhysicsSys { /* RigidBodySet, ColliderSet, pipeline bits, BTreeMap<u32, RigidBodyHandle>, next id */ }

impl PhysicsSys {
    pub fn new() -> Self;
    /// Step at the sim's fixed dt (1/60). Never at frame dt.
    pub fn step(&mut self, dt: f64);
    pub fn add_body(&mut self, o: BodyOpts) -> u32;
    pub fn remove_body(&mut self, id: u32);
    pub fn get_position(&self, id: u32) -> Option<DVec3>;
    pub fn set_velocity(&mut self, id: u32, v: DVec3);
    /// Teleport-style kinematic move (the controller owns feel).
    pub fn set_kinematic_position(&mut self, id: u32, p: DVec3);
}
```

Mapping (exact): gravity `(0, -9.81, 0)`; static → `RigidBodyDesc::fixed()`,
else `dynamic()`; box → `ColliderDesc::cuboid(hx,hy,hz)`,
sphere → `ball(max(hx, 0.001))`, capsule → `capsule(max(hy, 0.0),
max(hx, 0.001))`; `set_kinematic_position` = `set_translation(v, true)` on
the body (wake). rapier3d 0.22 API: `RigidBodySet`/`ColliderSet` +
`PhysicsPipeline::step` with `IntegrationParameters { dt, .. }`,
`IslandManager`, `BroadPhase`, `NarrowPhase`, `ImpulseJointSet`,
`MultibodyJointSet`, `CCDSolver`, `QueryPipeline`, hooks/events `()`.
Check docs.rs for 0.22 signatures — do NOT guess from newer versions.

Tests (`tests/physics.rs`): a dynamic capsule falls under gravity onto the
static ground box and comes to rest near the expected height; teleport moves
exactly; remove drops the body.

## `demo` (demo workstream) — arena assembly + binary + parity

`src/demo.rs` owns: the arena scene (40×40, walls, 7 seeded pillars via the
`arena` stream — consuming rolls in the SAME order as TS `buildArena`),
player controller port, enemy FSM port, projectile pool port, pickup port,
score + event log, `serialize_state()`/`restore_state()` through `SaveData`
(including rng stream states and controller state in `extra`, so the
round-trip test is exact), and the outcome vector.

`src/main.rs` CLI: `keel-rs --seed <u32> --input <script.json> --ticks <u64>`
prints the outcome vector JSON to stdout.

Outcome vector (JSON): seed, ticks, score, player {hp,x,y,z}, enemies
[{x,z,hp,state}], kills, pickups_taken, projectiles_active, events
[{tick, kind, detail}]. `tests/parity.rs` asserts this against the TS
reference's recorded vectors (recorded by the demo workstream from the
Playwright e2e harness — read `backends/ts-three/e2e/` first).
