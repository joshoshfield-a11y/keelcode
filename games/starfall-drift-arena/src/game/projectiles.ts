/** Projectiles: laser bolts, manual sphere collision, damage, death FX.
 *
 * Ships integrate kinematically; all collision is sphere-vs-sphere by hand.
 */

import * as THREE from 'three';
import {
  C,
  type HealthC, type LifetimeC, type ProjectileC, type TransformC, type VelocityC,
} from '../engine/ecs';
import {
  attachMesh, despawnEntity, type SimCtx,
} from './api';
import { getFX } from '../gfx/fx';

/** Test helper: clear module-level projectile/FX state between tests. */
export function resetProjectileState(): void {
  targetRadius.clear();
  fxData.clear();
}

/** Collision radius for damageable targets, set by the spawner system. */
const targetRadius = new Map<number, number>();
export function setTargetRadius(id: number, r: number): void {
  targetRadius.set(id, r);
}
export function clearTargetRadius(id: number): void {
  targetRadius.delete(id);
}

interface FxData { t: number; max: number }
const fxData = new Map<number, FxData>();

export interface LaserOpts {
  damage: number;
  fromPlayer: boolean;
}

const boltGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.2, 6);
// bolt long axis -> Z so the Transform aim (forward = -Z) points it correctly
boltGeo.rotateX(Math.PI / 2);
const playerBoltMat = new THREE.MeshBasicMaterial({ color: '#cfe0ff' });
const enemyBoltMat = new THREE.MeshBasicMaterial({ color: '#ffc9a8' });

/** Radial glow sprite texture for bolts. Headless-safe: without a DOM
 * (unit tests) falls back to a 1x1 white DataTexture. */
let boltGlowTex: THREE.Texture | null = null;
function getBoltGlowTexture(): THREE.Texture {
  if (boltGlowTex) return boltGlowTex;
  if (typeof document === 'undefined') {
    boltGlowTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    boltGlowTex.needsUpdate = true;
    return boltGlowTex;
  }
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  boltGlowTex = new THREE.CanvasTexture(canvas);
  boltGlowTex.colorSpace = THREE.SRGBColorSpace;
  return boltGlowTex;
}

const playerGlowMat = new THREE.SpriteMaterial({
  color: '#7fb2ff', transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const enemyGlowMat = new THREE.SpriteMaterial({
  color: '#ffb37f', transparent: true, opacity: 0.85,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

function makeBolt(fromPlayer: boolean): THREE.Mesh {
  const bolt = new THREE.Mesh(boltGeo, fromPlayer ? playerBoltMat : enemyBoltMat);
  // Additive glow halo around the bolt core (visual only).
  const glowMat = fromPlayer ? playerGlowMat : enemyGlowMat;
  if (!glowMat.map) {
    glowMat.map = getBoltGlowTexture();
    glowMat.needsUpdate = true;
  }
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(1.6, 1.6, 1);
  bolt.add(glow);
  return bolt;
}

export function fireLaser(
  ctx: SimCtx,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  speed: number,
  opts: LaserOpts,
): number {
  const len = Math.hypot(dx, dy, dz) || 1;
  const id = ctx.world.spawn({
    [C.Transform]: {
      x: ox, y: oy, z: oz,
      rx: Math.asin(Math.max(-1, Math.min(1, dy / len))),
      ry: Math.atan2(-dx / len, -dz / len),
      rz: 0, sx: 1, sy: 1, sz: 1,
    } as TransformC,
    [C.Velocity]: { x: (dx / len) * speed, y: (dy / len) * speed, z: (dz / len) * speed } as VelocityC,
    [C.Projectile]: { damage: opts.damage, fromPlayer: opts.fromPlayer } as ProjectileC,
    [C.Lifetime]: { t: 0, max: 2.0 } as LifetimeC,
    [C.Renderable]: { mesh: 'projectile', tint: 0xffffff, visible: true },
  });
  const bolt = makeBolt(opts.fromPlayer);
  bolt.rotation.order = 'YXZ';
  attachMesh(ctx, id, bolt);
  return id;
}

/** Small expanding-sphere explosion; cleaned up when done. */
export function spawnExplosion(ctx: SimCtx, x: number, y: number, z: number, scale = 1): void {
  const id = ctx.world.spawn({
    [C.Transform]: { x, y, z, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } as TransformC,
    [C.Lifetime]: { t: 0, max: 0.45 } as LifetimeC,
    [C.Renderable]: { mesh: 'prop', tint: 0xffffff, visible: true },
  });
  // Additive flash sphere (visual only) + a pooled particle burst.
  const mat = new THREE.MeshBasicMaterial({
    color: '#ffb36b', transparent: true, opacity: 0.9, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(2 * scale, 10, 8), mat);
  m.userData['fxScale'] = scale;
  attachMesh(ctx, id, m);
  fxData.set(id, { t: 0, max: 0.45 });
  getFX()?.burst(x, y, z, {
    count: 42, color: ['#ffc98a', '#ff7a2a', '#ffffff'],
    speed: 30, life: 0.75, size: 2.4,
  });
}

function killTarget(ctx: SimCtx, id: number): void {
  const t = ctx.world.get<TransformC>(id, C.Transform);
  const isEnemy = ctx.world.has(id, C.Enemy);
  if (t) {
    spawnExplosion(ctx, t.x, t.y, t.z, isEnemy ? 1.4 : 1.0);
    if (isEnemy) {
      ctx.api.addQuestProgress('kill', 1);
      ctx.state.hooks.onEnemyKilled?.(t.x, t.y, t.z);
    }
  }
  clearTargetRadius(id);
  despawnEntity(ctx, id);
}

export function createProjectileSystem(ctx: SimCtx): void {
  ctx.loop.on('update', (c) => {
    const dt = c.dt;
    const bolts = ctx.world.query(C.Projectile, C.Transform, C.Velocity, C.Lifetime);

    // player + enemies snapshot for collision
    const playerId = ctx.state.playerShipId;
    const pt = ctx.world.get<TransformC>(playerId, C.Transform);
    const enemies = ctx.world.query(C.Enemy, C.Transform, C.Health);

    for (const id of bolts) {
      const t = ctx.world.get<TransformC>(id, C.Transform);
      const v = ctx.world.get<VelocityC>(id, C.Velocity);
      const p = ctx.world.get<ProjectileC>(id, C.Projectile);
      const life = ctx.world.get<LifetimeC>(id, C.Lifetime);
      if (!t || !v || !p || !life) continue;

      t.x += v.x * dt;
      t.y += v.y * dt;
      t.z += v.z * dt;
      life.t += dt;
      if (life.t >= life.max) {
        despawnEntity(ctx, id);
        continue;
      }

      if (p.fromPlayer) {
        for (const eid of enemies) {
          const et = ctx.world.get<TransformC>(eid, C.Transform);
          if (!et) continue;
          const r = targetRadius.get(eid) ?? 3.5;
          const dx = t.x - et.x, dy = t.y - et.y, dz = t.z - et.z;
          if (dx * dx + dy * dy + dz * dz < r * r) {
            const h = ctx.world.get<HealthC>(eid, C.Health);
            if (h) {
              h.hp -= p.damage;
              if (h.hp <= 0) killTarget(ctx, eid);
            }
            despawnEntity(ctx, id);
            break;
          }
        }
      } else if (pt && !ctx.state.docked) {
        const dx = t.x - pt.x, dy = t.y - pt.y, dz = t.z - pt.z;
        if (dx * dx + dy * dy + dz * dz < 4.2 * 4.2) {
          ctx.api.damagePlayer(p.damage);
          ctx.loop.hitStop(70);
          spawnExplosion(ctx, t.x, t.y, t.z, 0.7);
          despawnEntity(ctx, id);
        }
      }
    }

    // explosion FX update
    for (const [id, fx] of fxData) {
      fx.t += dt;
      const m = ctx.meshes.get(id) as THREE.Mesh | undefined;
      const mat = m?.material as THREE.MeshBasicMaterial | undefined;
      if (m && mat) {
        const k = fx.t / fx.max;
        const s = (m.userData['fxScale'] as number) * (1 + k * 4);
        m.scale.setScalar(s);
        mat.opacity = Math.max(0, 0.9 * (1 - k));
      }
      if (fx.t >= fx.max) {
        fxData.delete(id);
        despawnEntity(ctx, id);
      }
    }
    // Lifetime component on FX entities is decorative; fxData drives cleanup.
  });
}
