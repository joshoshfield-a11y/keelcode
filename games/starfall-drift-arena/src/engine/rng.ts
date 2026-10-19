/**
 * Seeded randomness for the sim.
 *
 * Owning knowledge: KB `core/01-math.md` ("Seeded RNG") and the per-system
 * salt pattern from XANDRIA's `generator/seedSet.ts` (pattern reimplemented,
 * not copied): one master seed per run, one independent stream per system,
 * so adding rolls in one system never shifts another system's sequence.
 *
 * Determinism is a recommended pattern here, not a contract (2026-10-18
 * redirect): sim code must still avoid `Math.random()` and wall-clock reads
 * so runs stay reproducible when we want them to be. Cosmetic systems
 * (audio, particles) may use `Math.random()` freely.
 */

/** mulberry32: tiny fast seeded PRNG. Returns a function yielding [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Mix a master seed with a string salt into a distinct 32-bit stream seed.
 * FNV-1a over the salt, then a finalizer mix with the master.
 */
export function hashSeed(master: number, salt: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let m = (master | 0) ^ h;
  m = Math.imul(m ^ (m >>> 16), 0x45d9f3b);
  m = Math.imul(m ^ (m >>> 16), 0x45d9f3b);
  m ^= m >>> 16;
  return m >>> 0;
}

/**
 * Build one independent RNG stream per salt, all derived from the master
 * seed. Example: `createStreams(seed, ['enemies', 'pickups', 'fx'])`.
 */
export function createStreams(master: number, salts: string[]): Record<string, () => number> {
  const out: Record<string, () => number> = {};
  for (const s of salts) {
    out[s] = mulberry32(hashSeed(master, s));
  }
  return out;
}
