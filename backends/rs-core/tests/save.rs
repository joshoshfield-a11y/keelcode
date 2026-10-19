//! Save-slot tests: round-trip fidelity, fail-clean loads (tampered,
//! newer-version, missing), sorted `list` without `.tmp`, no temp left behind.

use std::collections::BTreeMap;
use std::path::PathBuf;

use keel_rs::save::{CURRENT_VERSION, SaveData, SaveSys};

fn tmpdir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("keel-rs-save-test-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d); // stale from an interrupted run
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn sample() -> SaveData {
    let mut comps = BTreeMap::new();
    let mut health = BTreeMap::new();
    health.insert("current".to_string(), serde_json::json!(80.0));
    health.insert("max".to_string(), serde_json::json!(100.0));
    comps.insert(7u32, health);
    SaveData {
        engine: "keelcode".to_string(),
        format_version: CURRENT_VERSION,
        seed: 1337,
        tick: 12345,
        components: comps,
        score: 42,
        extra: [(
            "rng_state".to_string(),
            serde_json::json!({"enemies": 3268439969u64}),
        )]
        .into_iter()
        .collect(),
    }
}

fn cleanup(d: &PathBuf) {
    let _ = std::fs::remove_dir_all(d);
}

#[test]
fn round_trip_fidelity() {
    let d = tmpdir("roundtrip");
    let sys = SaveSys::new(&d, "keel");
    let data = sample();
    sys.save("slot1", &data).unwrap();
    let back = sys.load("slot1").expect("round-trip must load");
    assert_eq!(back, data);
    assert_eq!(back.engine, "keelcode");
    assert_eq!(back.format_version, CURRENT_VERSION);
    assert_eq!(back.seed, 1337);
    assert_eq!(back.tick, 12345);
    assert_eq!(back.score, 42);
    assert_eq!(back.components[&7]["current"], serde_json::json!(80.0));
    cleanup(&d);
}

#[test]
fn missing_slot_is_none() {
    let d = tmpdir("missing");
    let sys = SaveSys::new(&d, "keel");
    assert!(sys.load("nope").is_none());
    cleanup(&d);
}

#[test]
fn tampered_checksum_returns_none() {
    let d = tmpdir("tamper");
    let sys = SaveSys::new(&d, "keel");
    sys.save("a", &sample()).unwrap();

    // Mutate the inner payload but keep the original sum: checksum must fail.
    let raw = std::fs::read_to_string(d.join("keel:save:a")).unwrap();
    let mut env: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let data = env["data"].as_str().unwrap().to_string();
    env["data"] = serde_json::Value::String(format!("{data} "));
    std::fs::write(d.join("keel:save:a"), serde_json::to_string(&env).unwrap()).unwrap();

    assert!(sys.load("a").is_none());
    cleanup(&d);
}

#[test]
fn corrupt_envelope_returns_none() {
    let d = tmpdir("corrupt");
    let sys = SaveSys::new(&d, "keel");
    std::fs::write(d.join("keel:save:a"), b"this is not json").unwrap();
    assert!(sys.load("a").is_none());
    std::fs::write(d.join("keel:save:a"), r#"{"sum":"x","data":1}"#).unwrap();
    assert!(sys.load("a").is_none());
    cleanup(&d);
}

#[test]
fn newer_version_returns_none() {
    fn fnv1a(bytes: &[u8]) -> u32 {
        let mut h: u32 = 0x811C_9DC5;
        for b in bytes {
            h ^= u32::from(*b);
            h = h.wrapping_mul(0x0100_0193);
        }
        h
    }
    let d = tmpdir("newer");
    let sys = SaveSys::new(&d, "keel");
    // Craft a payload stamped with a future version (save() would stamp CURRENT).
    let mut future = sample();
    future.format_version = CURRENT_VERSION + 1;
    let inner = serde_json::to_string(&future).unwrap();
    let env = serde_json::json!({"sum": fnv1a(inner.as_bytes()), "data": inner});
    std::fs::write(d.join("keel:save:a"), serde_json::to_string(&env).unwrap()).unwrap();
    assert!(sys.load("a").is_none());
    cleanup(&d);
}

#[test]
fn list_sorted_without_tmp() {
    let d = tmpdir("list");
    let sys = SaveSys::new(&d, "keel");
    sys.save("b", &sample()).unwrap();
    sys.save("a", &sample()).unwrap();
    // A stray temp file must never surface in the listing.
    std::fs::write(d.join("keel:save:zzz.tmp"), b"partial").unwrap();
    // Another namespace's saves must not leak in.
    let other = SaveSys::new(&d, "other");
    other.save("q", &sample()).unwrap();

    assert_eq!(sys.list(), vec!["a".to_string(), "b".to_string()]);
    assert_eq!(other.list(), vec!["q".to_string()]);
    cleanup(&d);
}

#[test]
fn temp_file_never_left_behind() {
    let d = tmpdir("tmp");
    let sys = SaveSys::new(&d, "keel");
    sys.save("slot1", &sample()).unwrap();
    sys.save("slot1", &sample()).unwrap(); // overwrite path also atomics
    let leftovers: Vec<_> = std::fs::read_dir(&d)
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(leftovers.is_empty(), "tmp files left behind: {leftovers:?}");
    // And the live slot still loads.
    assert!(sys.load("slot1").is_some());
    cleanup(&d);
}

#[test]
fn remove_drops_slot_and_tmp() {
    let d = tmpdir("remove");
    let sys = SaveSys::new(&d, "keel");
    sys.save("a", &sample()).unwrap();
    sys.remove("a");
    assert!(sys.load("a").is_none());
    assert!(sys.list().is_empty());
    cleanup(&d);
}
