//! Seeded randomness for the sim: mulberry32 + `hash_seed`.
//!
//! Bit-exact port of `backends/ts-three/src/engine/rng.ts` (recipes verified
//! against node output; see `INTERFACE.md` §rng).
//!
//! **Shift subtlety:** TS `>>>` is a *logical* (zero-fill) right shift of the
//! u32 bit pattern, and `Math.imul` wraps to signed 32-bit. The recipe below
//! mirrors that: logical shifts on `u32`, wrapping arithmetic on `i32`, and
//! bit-pattern reinterprets via `as` casts.

/// mulberry32 PRNG. Returns a closure yielding [0, 1).
pub fn mulberry32(seed: u32) -> impl FnMut() -> f64 {
    let mut state: i32 = seed as i32;
    move || {
        state = state.wrapping_add(0x6D2B_79F5u32 as i32);
        let s: u32 = state as u32;
        let mut t: i32 = ((s ^ (s >> 15)) as i32).wrapping_mul((1u32 | s) as i32);
        let tu: u32 = t as u32;
        t = t.wrapping_add(((tu ^ (tu >> 7)) as i32).wrapping_mul((61u32 | tu) as i32)) ^ t;
        let out: u32 = t as u32;
        ((out ^ (out >> 14)) as f64) / 4294967296.0
    }
}

/// FNV-1a over the salt bytes, then the TS finalizer mix with the master seed.
///
/// Salts are ASCII-only (documented assumption; asserted in debug builds).
pub fn hash_seed(master: u32, salt: &str) -> u32 {
    debug_assert!(salt.is_ascii());
    let mut h: u32 = 0x811C_9DC5;
    for b in salt.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    let mut m: i32 = (master as i32) ^ (h as i32);
    m = ((m as u32 ^ ((m as u32) >> 16)) as i32).wrapping_mul(0x45D9_F3Bu32 as i32);
    m = ((m as u32 ^ ((m as u32) >> 16)) as i32).wrapping_mul(0x45D9_F3Bu32 as i32);
    m ^= ((m as u32) >> 16) as i32;
    m as u32
}
