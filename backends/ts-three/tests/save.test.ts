// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSave, type SaveSys } from '../src/engine/save';
import {
  installMockStorage,
  installWindowStub,
  uninstallMockStorage,
  uninstallWindowStub,
  type MockStorage,
} from './helpers';

/**
 * Save contract under test (src/engine/save.ts):
 * - slots namespaced as `${namespace}:save:${slot}` over window.localStorage
 * - atomic writes: temp key -> live key -> temp removed (temp always cleaned)
 * - integrity: FNV-1a checksum envelope; corruption fails clean (null)
 * - versioning: format_version stamped on write; forward-only migrations;
 *   unknown paths (incl. format_version 0 with no registered migration) and
 *   newer versions fail clean instead of half-migrating
 */

const NS = 'keel-test';
const liveKey = (slot: string): string => `${NS}:save:${slot}`;
const tempKey = (slot: string): string => `${NS}:save:${slot}.tmp`;

/** FNV-1a, mirroring the engine's checksum so tests can craft envelopes. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function envelopeFor(inner: unknown): string {
  const data = JSON.stringify(inner);
  return JSON.stringify({ sum: fnv1a(data), data });
}

function makeData() {
  return {
    engine: 'keelcode' as const,
    format_version: 1,
    seed: 4242,
    tick: 3600,
    components: {
      0: {
        Transform: { x: 1, y: 2, z: 3, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
        Health: { hp: 80, maxHp: 100 },
      },
      1: {
        Transform: { x: -4, y: 0, z: 9, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
        AI: { brain: 'chaser', state: 'seek', t: 0, target: 0 },
      },
    },
  };
}

describe('save system', () => {
  let storage: MockStorage;
  let sys: SaveSys;

  beforeEach(() => {
    storage = installMockStorage();
    // The engine uses window.localStorage when present; the stub lets the
    // tests observe the exact keys (live + temp) it writes.
    installWindowStub({ localStorage: storage });
    sys = createSave(NS);
  });

  afterEach(() => {
    uninstallWindowStub();
    uninstallMockStorage();
  });

  it('round-trips a save through save/load with semantic fidelity', () => {
    const data = makeData();
    sys.save('slot0', data);
    expect(sys.load('slot0')).toEqual({ ...data, engine: 'keelcode', format_version: 1 });
  });

  it('stamps engine and format_version on write', () => {
    sys.save('slot0', { ...makeData(), format_version: 99 });
    expect(sys.load('slot0')?.format_version).toBe(1);
  });

  it('writes atomically: the temp key is cleaned and the live key holds a checksummed envelope', () => {
    sys.save('slot0', makeData());

    expect(storage.getItem(tempKey('slot0'))).toBeNull();

    const raw = storage.getItem(liveKey('slot0'));
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw as string) as { sum: number; data: string };
    expect(typeof envelope.sum).toBe('number');
    expect(fnv1a(envelope.data)).toBe(envelope.sum); // checksum covers the payload

    const inner = JSON.parse(envelope.data);
    expect(inner.engine).toBe('keelcode');
    expect(inner.format_version).toBe(1);
    expect(inner.tick).toBe(3600);
  });

  it('cleans a stale temp key left behind by a crashed write', () => {
    storage.setItem(tempKey('slot0'), '{corrupt');
    sys.save('slot0', makeData());
    expect(storage.getItem(tempKey('slot0'))).toBeNull();
    expect(sys.load('slot0')?.tick).toBe(3600);
  });

  it('load returns null for a missing slot', () => {
    expect(sys.load('nope')).toBeNull();
  });

  it('load returns null for a non-JSON payload instead of throwing', () => {
    storage.setItem(liveKey('slot0'), '{not json');
    expect(sys.load('slot0')).toBeNull();
  });

  it('load returns null when the checksum does not match (tampered payload)', () => {
    const good = JSON.parse(envelopeFor(makeData())) as { sum: number; data: string };
    const tampered = { sum: good.sum, data: good.data.replace('3600', '3601') };
    storage.setItem(liveKey('slot0'), JSON.stringify(tampered));
    expect(sys.load('slot0')).toBeNull();
  });

  it('load returns null for a save from a newer version', () => {
    storage.setItem(liveKey('slot0'), envelopeFor({ ...makeData(), format_version: 2 }));
    expect(sys.load('slot0')).toBeNull();
  });

  it('load refuses a format_version 0 save with no registered migration (fails clean)', () => {
    // The migrations table is currently empty, so there is no path 0 -> 1.
    // The engine must refuse rather than half-migrate. NOTE: the Wave 1
    // brief asks for forward migration from format_version 0; that migration
    // is not implemented yet — see tests/api-contract.md.
    storage.setItem(liveKey('slot0'), envelopeFor({ ...makeData(), format_version: 0 }));
    expect(sys.load('slot0')).toBeNull();
  });

  it('list() and remove() manage slots', () => {
    sys.save('b', makeData());
    sys.save('a', makeData());
    expect(sys.list()).toEqual(['a', 'b']);

    sys.remove('a');
    expect(sys.load('a')).toBeNull();
    expect(sys.list()).toEqual(['b']);
    expect(storage.getItem(tempKey('a'))).toBeNull();
  });
});
