// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createStreams, hashSeed, mulberry32 } from '../src/engine/rng';

/**
 * RNG contract under test (src/engine/rng.ts):
 * - mulberry32: canonical seeded PRNG yielding [0, 1)
 * - hashSeed(master, salt): FNV-1a + finalizer mix -> distinct uint32 stream seeds
 * - createStreams(master, salts): one independent stream per salt
 */

function drawN(fn: () => number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(fn());
  return out;
}

describe('mulberry32', () => {
  it('is reproducible: the same seed yields the same sequence', () => {
    expect(drawN(mulberry32(1234), 1000)).toEqual(drawN(mulberry32(1234), 1000));
  });

  it('different seeds diverge', () => {
    expect(drawN(mulberry32(1), 100)).not.toEqual(drawN(mulberry32(2), 100));
  });

  it('emits uniform floats in [0, 1)', () => {
    const vals = drawN(mulberry32(99), 10_000);
    expect(vals.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('matches the canonical reference vectors (guards against algorithm drift)', () => {
    const r0 = mulberry32(0);
    expect(r0()).toBeCloseTo(0.26642920868471265, 12);
    expect(r0()).toBeCloseTo(0.0003297457005828619, 12);
    expect(r0()).toBeCloseTo(0.22327202744781971, 12);

    const r1234 = mulberry32(1234);
    expect(r1234()).toBeCloseTo(0.07329497812315822, 12);
    expect(r1234()).toBeCloseTo(0.7034119898453355, 12);
    expect(r1234()).toBeCloseTo(0.9028560190927237, 12);
  });
});

describe('hashSeed', () => {
  it('is deterministic for a (master, salt) pair', () => {
    expect(hashSeed(42, 'worldgen')).toBe(hashSeed(42, 'worldgen'));
  });

  it('salts produce distinct stream seeds', () => {
    expect(hashSeed(42, 'worldgen')).not.toBe(hashSeed(42, 'loot'));
  });

  it('masters produce distinct stream seeds', () => {
    expect(hashSeed(42, 'worldgen')).not.toBe(hashSeed(43, 'worldgen'));
  });

  it('returns a 32-bit unsigned integer', () => {
    const h = hashSeed(42, 'worldgen');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
  });
});

describe('createStreams', () => {
  it('builds one stream per salt, keyed by salt name', () => {
    const s = createStreams(7, ['world', 'ai', 'fx']);
    expect(Object.keys(s).sort()).toEqual(['ai', 'fx', 'world']);
    for (const k of Object.keys(s)) expect(typeof s[k]).toBe('function');
  });

  it('the same master seed reproduces every stream', () => {
    const a = createStreams(7, ['world', 'ai']);
    const b = createStreams(7, ['world', 'ai']);
    expect(drawN(a['world'], 200)).toEqual(drawN(b['world'], 200));
    expect(drawN(a['ai'], 200)).toEqual(drawN(b['ai'], 200));
  });

  it('different master seeds give different streams', () => {
    const a = createStreams(1, ['world']);
    const b = createStreams(2, ['world']);
    expect(drawN(a['world'], 50)).not.toEqual(drawN(b['world'], 50));
  });

  it('different salts give different streams under one master', () => {
    const s = createStreams(7, ['world', 'ai']);
    expect(drawN(s['world'], 50)).not.toEqual(drawN(s['ai'], 50));
  });

  it('drawing from one stream never perturbs another', () => {
    const a = createStreams(7, ['world', 'ai', 'fx']);
    const b = createStreams(7, ['world', 'ai', 'fx']);
    const aWorld = drawN(a['world'], 20);

    // Hammer b's other streams between every world draw.
    const bWorld: number[] = [];
    for (let i = 0; i < 20; i++) {
      bWorld.push(b['world']());
      for (let j = 0; j < 50; j++) {
        b['ai']();
        b['fx']();
      }
    }
    expect(bWorld).toEqual(aWorld);
  });
});
