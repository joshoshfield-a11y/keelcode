//! Save slots: JSON envelope with FNV-1a checksum, atomic writes,
//! forward-only migrations.
//!
//! Mirrors `backends/ts-three/src/engine/save.ts`. File-backed (dir passed
//! in); atomic via temp file + rename. Loads fail clean: `None` on missing,
//! corrupt, checksum-mismatch, or newer-version payloads — never garbage.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Bump when the persisted shape changes; add a migration entry below.
pub const CURRENT_VERSION: u32 = 1;

/// One migration entry moves a payload from version N to N+1.
type Migration = fn(SaveData) -> SaveData;

/// Forward-only migrations keyed by from-version. Empty for v1.
fn migrations() -> BTreeMap<u32, Migration> {
    BTreeMap::new()
}

/// Persisted snapshot (engine name + version stamped on save).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SaveData {
    /// Always `"keelcode"` on a stamped save.
    pub engine: String,
    pub format_version: u32,
    pub seed: u32,
    pub tick: u64,
    /// entity id -> component name -> component JSON (names per §components)
    pub components: BTreeMap<u32, BTreeMap<String, serde_json::Value>>,
    /// Demo extension (TS `DemoSave`).
    pub score: u64,
    /// Demo-specific extra state (rng stream states, controller state, …).
    #[serde(default)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

/// On-disk envelope: `{"sum": fnv1a(inner bytes), "data": inner}`.
#[derive(Serialize, Deserialize)]
struct Envelope {
    sum: u32,
    data: String,
}

/// 32-bit FNV-1a over the UTF-8 bytes (ASCII JSON ⇒ matches the TS side).
fn fnv1a(bytes: &[u8]) -> u32 {
    let mut h: u32 = 0x811C_9DC5;
    for b in bytes {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

pub struct SaveSys {
    dir: PathBuf,
    namespace: String,
}

impl SaveSys {
    pub fn new(dir: &Path, namespace: &str) -> Self {
        Self {
            dir: dir.to_path_buf(),
            namespace: namespace.to_string(),
        }
    }

    fn live_name(&self, slot: &str) -> String {
        format!("{}:save:{}", self.namespace, slot)
    }

    fn tmp_name(&self, slot: &str) -> String {
        format!("{}:save:{}.tmp", self.namespace, slot)
    }

    fn prefix(&self) -> String {
        format!("{}:save:", self.namespace)
    }

    /// Atomic: write `<slot>.tmp`, rename to `<slot>`. Stamps engine/version.
    pub fn save(&self, slot: &str, data: &SaveData) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir)
            .map_err(|e| format!("save dir {:?} is not writable: {e}", self.dir))?;
        let stamped = SaveData {
            engine: "keelcode".to_string(),
            format_version: CURRENT_VERSION,
            ..data.clone()
        };
        let inner =
            serde_json::to_string(&stamped).map_err(|e| format!("save serialize failed: {e}"))?;
        let envelope = Envelope {
            sum: fnv1a(inner.as_bytes()),
            data: inner,
        };
        let payload =
            serde_json::to_string(&envelope).map_err(|e| format!("save serialize failed: {e}"))?;
        let live = self.dir.join(self.live_name(slot));
        let tmp = self.dir.join(self.tmp_name(slot));
        if let Err(e) =
            std::fs::write(&tmp, payload.as_bytes()).and_then(|()| std::fs::rename(&tmp, &live))
        {
            // Never leave a temp behind; the old save stays live.
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("save slot {slot:?} failed: {e}"));
        }
        Ok(())
    }

    /// `None` on missing / corrupt / checksum-mismatch / newer-version —
    /// fail clean, never load garbage (mirrors TS).
    pub fn load(&self, slot: &str) -> Option<SaveData> {
        let raw = std::fs::read_to_string(self.dir.join(self.live_name(slot))).ok()?;
        let env: Envelope = serde_json::from_str(&raw).ok()?;
        if fnv1a(env.data.as_bytes()) != env.sum {
            return None; // checksum mismatch: do not trust a byte
        }
        let mut data: SaveData = serde_json::from_str(&env.data).ok()?;
        if data.engine != "keelcode" {
            return None;
        }
        if data.format_version > CURRENT_VERSION {
            return None; // save from a newer version: fail clean, never guess
        }
        let mig = migrations();
        while data.format_version < CURRENT_VERSION {
            let m = mig.get(&data.format_version)?; // no path forward: refuse
            data = m(data);
            data.format_version += 1;
        }
        Some(data)
    }

    /// Sorted slot names, no `.tmp` entries.
    pub fn list(&self) -> Vec<String> {
        let prefix = self.prefix();
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return out;
        };
        for entry in entries.flatten() {
            if !entry.file_type().is_ok_and(|t| t.is_file()) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with(&prefix) && !name.ends_with(".tmp") {
                out.push(name[prefix.len()..].to_string());
            }
        }
        out.sort();
        out
    }

    pub fn remove(&self, slot: &str) {
        let _ = std::fs::remove_file(self.dir.join(self.live_name(slot)));
        let _ = std::fs::remove_file(self.dir.join(self.tmp_name(slot)));
    }
}
