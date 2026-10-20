/** Pirates: 3 variants on the engine AI FSM.
 *
 * Variants: scout (fast, hull 30, dmg 6), raider (hull 60, dmg 10),
 * bruiser (slow, hull 140, dmg 18).
 * FSM: patrol -> engage (range 120) -> attack (range 40, strafing runs)
 *      -> disengage when hull < 25%.
 * Game-specific AI state lives in a TS Map keyed by entity id; the engine
 * AIC component mirrors the current state string.
 */

import * as THREE from 'three';
import {
  C, type AIC, type HealthC, type TransformC, type VelocityC,
} from '../engine/ecs';
import { attachMesh, type SimCtx } from './api';
import { createPirateShip, type PirateVariant } from '../gfx/spaceship';
import { fireLaser, setTargetRadius } from './projectiles';

export { type PirateVariant };

interface VariantSpec {
  hull: number; dmg: number; speed: number; turn: number; radius: number;
}

export const VARIANTS: Record<PirateVariant, VariantSpec> = {
  scout: { hull: 30, dmg: 6, speed: 30, turn: 2.6, radius: 3.0 },
  raider: { hull: 60, dmg: 10, speed: 22, turn: 1.8, radius: 3.8 },
  bruiser: { hull: 140, dmg: 18, speed: 14, turn: 1.2, radius: 5.2 },
};

export type PirateFsmState = 'patrol' | 'engage' | 'attack' | 'disengage';

export interface PirateData {
  variant: PirateVariant;
  state: PirateFsmState;
  fireCd: number;
  strafeDir: 1 | -1;
  wp: { x: number; y: number; z: number };
}

/** Parallel AI map (game-specific state; engine AIC mirrors state string). */
export const pirateData = new Map<number, PirateData>();

const ENGAGE_RANGE = 120;
const ATTACK_RANGE = 40;
const REACQUIRE_RANGE = 165;
const DISENGAGE_CLEAR = 230;

const _toPlayer = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function randWpAround(px: number, py: number, pz: number, r: number): { x: number; y: number; z: number } {
  const a = Math.random() * Math.PI * 2;
  const b = (Math.random() - 0.5) * Math.PI;
  return {
    x: px + Math.cos(a) * Math.cos(b) * r,
    y: py + Math.sin(b) * r * 0.5,
    z: pz + Math.sin(a) * Math.cos(b) * r,
  };
}

export function spawnPirate(ctx: SimCtx, variant: PirateVariant, x: number, y: number, z: number): number {
  const spec = VARIANTS[variant];
  const id = ctx.world.spawn({
    [C.Enemy]: {},
    [C.AI]: { brain: 'chaser', state: 'patrol', t: 0, target: ctx.state.playerShipId } as AIC,
    [C.Transform]: { x, y, z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } as TransformC,
    [C.Velocity]: { x: 0, y: 0, z: 0 } as VelocityC,
    [C.Health]: { hp: spec.hull, maxHp: spec.hull } as HealthC,
    [C.Collider]: { kind: 'sphere', hx: spec.radius, hy: spec.radius, hz: spec.radius, static: false },
    [C.Renderable]: { mesh: 'enemy', tint: 0xffffff, visible: true },
  });
  pirateData.set(id, {
    variant,
    state: 'patrol',
    fireCd: 1 + Math.random(),
    strafeDir: Math.random() < 0.5 ? 1 : -1,
    wp: randWpAround(x, y, z, 250),
  });
  setTargetRadius(id, spec.radius);
  attachMesh(ctx, id, createPirateShip(variant));
  return id;
}

/** Spawn n pirates in a ring 300–500u from the player, mixed variants. */
export function spawnPirateWave(ctx: SimCtx, n: number): void {
  const pt = ctx.world.get<TransformC>(ctx.state.playerShipId, C.Transform);
  const px = pt?.x ?? 0, py = pt?.y ?? 0, pz = pt?.z ?? 0;
  const variants: PirateVariant[] = ['scout', 'raider', 'bruiser'];
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.5;
    const r = 300 + Math.random() * 200;
    spawnPirate(
      ctx, variants[i % variants.length],
      px + Math.cos(a) * r, py + (Math.random() - 0.5) * 120, pz + Math.sin(a) * r,
    );
  }
}

export function createPirateSystem(ctx: SimCtx): void {
  ctx.loop.on('update', (c) => {
    const dt = c.dt;
    const pt = ctx.world.get<TransformC>(ctx.state.playerShipId, C.Transform);
    if (!pt) return;

    for (const id of ctx.world.query(C.Enemy, C.AI, C.Transform, C.Velocity, C.Health)) {
      const pd = pirateData.get(id);
      const t = ctx.world.get<TransformC>(id, C.Transform);
      const v = ctx.world.get<VelocityC>(id, C.Velocity);
      const h = ctx.world.get<HealthC>(id, C.Health);
      const ai = ctx.world.get<AIC>(id, C.AI);
      if (!pd || !t || !v || !h || !ai) continue;

      const spec = VARIANTS[pd.variant];
      _toPlayer.set(pt.x - t.x, pt.y - t.y, pt.z - t.z);
      const dist = _toPlayer.length();
      if (dist > 1e-4) _toPlayer.divideScalar(dist);

      // ---- FSM transitions ----
      switch (pd.state) {
        case 'patrol':
          if (dist < ENGAGE_RANGE) pd.state = 'engage';
          break;
        case 'engage':
          if (dist < ATTACK_RANGE) pd.state = 'attack';
          else if (dist > REACQUIRE_RANGE) pd.state = 'patrol';
          break;
        case 'attack':
          if (h.hp < h.maxHp * 0.25) pd.state = 'disengage';
          else if (dist > REACQUIRE_RANGE) pd.state = 'engage';
          break;
        case 'disengage':
          if (dist > DISENGAGE_CLEAR) pd.state = 'patrol';
          break;
      }
      ai.state = pd.state;
      ai.t += dt;

      // ---- steering ----
      switch (pd.state) {
        case 'patrol': {
          _desired.set(pd.wp.x - t.x, pd.wp.y - t.y, pd.wp.z - t.z);
          if (_desired.length() < 25) pd.wp = randWpAround(pt.x, pt.y, pt.z, 300);
          break;
        }
        case 'engage':
          _desired.copy(_toPlayer);
          break;
        case 'attack': {
          // strafing run: orbit the player, closing when far, opening when close
          _tangent.crossVectors(UP, _toPlayer);
          if (_tangent.lengthSq() < 1e-6) _tangent.set(1, 0, 0);
          _tangent.normalize().multiplyScalar(pd.strafeDir);
          _desired.copy(_tangent);
          if (dist > 60) _desired.addScaledVector(_toPlayer, 0.8);
          else if (dist < 24) _desired.addScaledVector(_toPlayer, -0.9);
          break;
        }
        case 'disengage':
          _desired.copy(_toPlayer).multiplyScalar(-1);
          break;
      }
      if (_desired.lengthSq() > 1e-8) _desired.normalize();

      // current forward from transform
      const cp = Math.cos(t.rx);
      _fwd.set(-cp * Math.sin(t.ry), Math.sin(t.rx), -cp * Math.cos(t.ry));

      // turn toward desired, limited by turn rate
      const dot = Math.max(-1, Math.min(1, _fwd.dot(_desired)));
      const angle = Math.acos(dot);
      const maxTurn = spec.turn * dt;
      if (angle > 1e-4) {
        const k = Math.min(1, maxTurn / angle);
        _fwd.lerp(_desired, k).normalize();
        t.rx = Math.asin(Math.max(-1, Math.min(1, _fwd.y)));
        t.ry = Math.atan2(-_fwd.x, -_fwd.z);
      }

      const speed = pd.state === 'disengage' ? spec.speed * 1.25 : spec.speed;
      v.x = _fwd.x * speed;
      v.y = _fwd.y * speed;
      v.z = _fwd.z * speed;
      t.x += v.x * dt;
      t.y += v.y * dt;
      t.z += v.z * dt;

      // ---- pirate fire ----
      pd.fireCd -= dt;
      if ((pd.state === 'attack' || pd.state === 'engage') && pd.fireCd <= 0 && dist < 110) {
        pd.fireCd = 0.9 + Math.random() * 0.7;
        // lead slightly + spread so it isn't aimbotted
        const spread = 0.06;
        const dx = _toPlayer.x + (Math.random() - 0.5) * spread;
        const dy = _toPlayer.y + (Math.random() - 0.5) * spread;
        const dz = _toPlayer.z + (Math.random() - 0.5) * spread;
        fireLaser(ctx, t.x, t.y, t.z, dx, dy, dz, 120, { damage: spec.dmg, fromPlayer: false });
      }
    }
  });
}
