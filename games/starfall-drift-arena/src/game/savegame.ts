/** Game save layer: DriftArenaSave persisted through the engine's SaveSys
 * (checksum envelope, atomic write) in namespace 'drift-arena', slot 'slot0'.
 *
 * Forward-only: version 1 is the only known game version. Unknown future
 * versions fail clean (load returns null) — never guess, never crash.
 */

import type { SaveSys } from '../engine/save';
import type { UpgradeLevels } from './economy';

export const SAVE_NAMESPACE = 'drift-arena';
export const SAVE_SLOT = 'slot0';
export const DRIFT_ARENA_SAVE_VERSION = 1;

const COMPONENT_KEY = -1; // reserved negative id: can never collide with ECS entity ids

export interface DriftArenaSave {
  version: 1;
  credits: number;
  ore: number;
  upgrades: UpgradeLevels;
  questProgress: Record<string, number>;
  questDone: Record<string, boolean>;
  playerHull: number;
  tick: number;
}

export function saveGame(sys: SaveSys, slot: string, state: DriftArenaSave): void {
  sys.save(slot, {
    engine: 'keelcode',
    format_version: 1,
    seed: 0,
    tick: state.tick,
    components: { [COMPONENT_KEY]: state as unknown as Record<string, unknown> },
  });
}

export function loadGame(sys: SaveSys, slot: string): DriftArenaSave | null {
  const data = sys.load(slot);
  if (!data) return null;
  return migrate(data.components[COMPONENT_KEY]);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clampLevel(v: unknown): number {
  const n = Math.floor(num(v, 0));
  return Math.max(0, Math.min(3, n));
}

/**
 * Validate + normalize a stored payload into DriftArenaSave.
 * Returns null for anything unknown or untrusted — never throws.
 */
export function migrate(save: unknown): DriftArenaSave | null {
  if (!isRecord(save)) return null;
  const version = save['version'];
  if (typeof version !== 'number') return null;
  if (version > DRIFT_ARENA_SAVE_VERSION) return null; // future version: refuse, don't guess
  if (version < DRIFT_ARENA_SAVE_VERSION) return null; // no known migration path: fail clean

  const up = isRecord(save['upgrades']) ? save['upgrades'] : {};
  const upgrades: UpgradeLevels = {
    guns: clampLevel(up['guns']),
    engine: clampLevel(up['engine']),
    shield: clampLevel(up['shield']),
  };

  const qp = isRecord(save['questProgress']) ? save['questProgress'] : {};
  const questProgress: Record<string, number> = {};
  for (const [k, v] of Object.entries(qp)) questProgress[k] = Math.max(0, Math.floor(num(v, 0)));

  const qd = isRecord(save['questDone']) ? save['questDone'] : {};
  const questDone: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(qd)) questDone[k] = v === true;

  return {
    version: 1,
    credits: Math.max(0, Math.floor(num(save['credits'], 0))),
    ore: Math.max(0, Math.floor(num(save['ore'], 0))),
    upgrades,
    questProgress,
    questDone,
    playerHull: Math.max(0, num(save['playerHull'], 100)),
    tick: Math.max(0, Math.floor(num(save['tick'], 0))),
  };
}
