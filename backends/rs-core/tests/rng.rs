//! Bit-exactness tests for `rng`: ground-truth vectors generated from the
//! TS implementation via node (2026-10-19). The recipe is bit-exact, so
//! `assert_eq!` on the f64 values is correct — no epsilon.

// Vectors are copied verbatim from the ground-truth table in INTERFACE.md
// §rng; some trailing digits are excess f64 precision, kept
// character-identical to the contract for auditability.
#![allow(clippy::excessive_precision)]

use keel_rs::rng::{hash_seed, mulberry32};

#[test]
fn hash_seed_ground_truth() {
    assert_eq!(hash_seed(1337, "enemies"), 3268439969);
    assert_eq!(hash_seed(1337, "arena"), 934351928);
    assert_eq!(hash_seed(1337, "pickups"), 2403452701);
    assert_eq!(hash_seed(0, ""), 431477908);
}

#[test]
fn mulberry32_ground_truth() {
    let mut rng = mulberry32(3268439969);
    for expected in [
        0.66506679775193334f64,
        0.81788854091428220,
        0.89090276183560491,
        0.027450599707663059,
        0.98594892420805991,
    ] {
        assert_eq!(rng(), expected);
    }

    let mut rng0 = mulberry32(0);
    for expected in [
        0.26642920868471265f64,
        0.00032974570058286190,
        0.22327202744781971,
    ] {
        assert_eq!(rng0(), expected);
    }
}

#[test]
fn stream_independence() {
    // Consuming stream A must never shift stream B (per-system salt pattern).
    let mut a = mulberry32(hash_seed(1337, "enemies"));
    let mut b = mulberry32(hash_seed(1337, "arena"));
    let b_first = {
        let mut tmp = mulberry32(hash_seed(1337, "arena"));
        tmp()
    };
    for _ in 0..10_000 {
        a();
    }
    assert_eq!(b(), b_first);
}

#[test]
fn same_seed_same_stream() {
    let mut x = mulberry32(hash_seed(42, "pickups"));
    let mut y = mulberry32(hash_seed(42, "pickups"));
    for _ in 0..100 {
        assert_eq!(x(), y());
    }
}

#[test]
fn output_in_unit_interval() {
    let mut rng = mulberry32(1);
    for _ in 0..10_000 {
        let v = rng();
        assert!((0.0..1.0).contains(&v), "out of [0, 1): {v}");
    }
}
