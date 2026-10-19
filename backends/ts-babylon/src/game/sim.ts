/** Sim-side component helpers.
 *
 *  The engine's component interfaces (src/engine/ecs.ts) use flat fields
 *  (Transform {x,y,z,...}, Health {hp,maxHp}), while framework/schema and
 *  the e2e debug surface also read nested names (Transform.position,
 *  Health.current). These helpers keep both shapes in sync on one object so
 *  game code, saves, and the debug surface all agree. Additive only — the
 *  engine never reads the extra fields.
 */

import type { TransformC, HealthC } from '../engine/ecs';

export interface TransformFull extends TransformC {
  position: { x: number; y: number; z: number };
}

export interface HealthFull extends HealthC {
  current: number;
  max: number;
}

export function makeTransform(x: number, y: number, z: number, ry = 0): TransformFull {
  return {
    x, y, z, rx: 0, ry, rz: 0, sx: 1, sy: 1, sz: 1,
    position: { x, y, z },
  };
}

/** Write position, keeping the flat fields and .position in sync. */
export function writePos(t: TransformFull, x: number, y: number, z: number): void {
  t.x = x; t.y = y; t.z = z;
  t.position.x = x; t.position.y = y; t.position.z = z;
}

export function makeHealth(hp: number, maxHp: number): HealthFull {
  return { hp, maxHp, current: hp, max: maxHp };
}

/** Read current HP (either field name). */
export function getHp(h: HealthFull): number {
  return h.current ?? h.hp;
}

/** Set HP, keeping both field names in sync. */
export function setHp(h: HealthFull, v: number): void {
  h.hp = v;
  h.current = v;
}

/** Add delta to HP, keeping both field names in sync. Returns new HP. */
export function addHp(h: HealthFull, d: number): number {
  const v = getHp(h) + d;
  setHp(h, v);
  return v;
}
