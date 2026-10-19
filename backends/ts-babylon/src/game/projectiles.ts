/** Pooled projectiles (capacity 64): plain emissive-white spheres.
 *  Kinematic with fixed 2 substeps per tick to avoid tunneling.
 *  Collides vs arena static AABBs and live enemy capsules (via world query).
 *  Zero per-frame allocation: flat Float32Array state + module scratch.
 *
 *  Babylon port of the ts-three reference (game/projectiles.ts): identical
 *  sim. The three.js InstancedMesh matrix writes become per-instance
 *  position/scaling on BABYLON.InstancedMesh (same world transform, still
 *  one hardware-instanced draw call). Render mapping: (x,y,z)->(x,y,-z). */

import * as BABYLON from '@babylonjs/core';
import { C, World } from '../engine/ecs';
import type { ArenaData } from './arena';
import { getHp, TransformFull, HealthFull } from './sim';

const POOL = 64;
const SUBSTEPS = 2;

export interface ProjectileHooks {
  onHitEnemy: (id: number, dmg: number, x: number, y: number, z: number) => void;
  onHitWorld: (x: number, y: number, z: number) => void;
}

export class Projectiles {
  private px = new Float32Array(POOL);
  private py = new Float32Array(POOL);
  private pz = new Float32Array(POOL);
  private vx = new Float32Array(POOL);
  private vy = new Float32Array(POOL);
  private vz = new Float32Array(POOL);
  private life = new Float32Array(POOL);
  private dmg = new Float32Array(POOL);
  private active = new Uint8Array(POOL);
  private instances: BABYLON.InstancedMesh[] = [];
  activeCount = 0;

  constructor(
    scene: BABYLON.Scene,
    private world: World,
    private arena: ArenaData,
    private hooks: ProjectileHooks,
  ) {
    const mat = new BABYLON.StandardMaterial('projectileFx', scene);
    mat.diffuseColor = new BABYLON.Color3(1, 1, 1);
    mat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    mat.specularColor = new BABYLON.Color3(0, 0, 0);
    const src = BABYLON.MeshBuilder.CreateSphere('projectile', { diameter: 0.26, segments: 10 }, scene);
    src.material = mat;
    src.isVisible = false;
    for (let i = 0; i < POOL; i++) {
      const inst = src.createInstance('proj' + i);
      inst.position.set(0, -1000, 0);
      inst.scaling.setAll(0);
      this.instances.push(inst);
    }
  }

  fire(fx: number, fy: number, fz: number, dx: number, dy: number, dz: number, speed: number, damage: number, life = 2.0): void {
    for (let i = 0; i < POOL; i++) {
      if (this.active[i]) continue;
      this.active[i] = 1;
      this.px[i] = fx; this.py[i] = fy; this.pz[i] = fz;
      this.vx[i] = dx * speed; this.vy[i] = dy * speed; this.vz[i] = dz * speed;
      this.life[i] = life;
      this.dmg[i] = damage;
      this.activeCount++;
      return;
    }
  }

  clear(): void {
    this.active.fill(0);
    this.activeCount = 0;
  }

  update(dt: number): void {
    const sdt = dt / SUBSTEPS;
    const enemyIds = this.world.query(C.Enemy, C.Transform, C.Health);
    for (let i = 0; i < POOL; i++) {
      if (!this.active[i]) continue;
      this.life[i] -= dt;
      let dead = this.life[i] <= 0 || this.py[i] < -2;
      for (let s = 0; s < SUBSTEPS && !dead; s++) {
        this.px[i] += this.vx[i] * sdt;
        this.py[i] += this.vy[i] * sdt;
        this.pz[i] += this.vz[i] * sdt;
        if (this.arena.sphereHitsStatic(this.px[i], this.py[i], this.pz[i], 0.13)) {
          this.hooks.onHitWorld(this.px[i], this.py[i], this.pz[i]);
          dead = true;
          break;
        }
        // enemy capsule approx: center y+1.0, radius 0.55, height 1.9
        for (let k = 0; k < enemyIds.length; k++) {
          const t = this.world.get<TransformFull>(enemyIds[k], C.Transform);
          const h = this.world.get<HealthFull>(enemyIds[k], C.Health);
          if (!t || !h || getHp(h) <= 0) continue;
          const dx = this.px[i] - t.x, dz = this.pz[i] - t.z;
          const dy = this.py[i] - (t.y + 1.0);
          if (dx * dx + dz * dz < 0.55 && dy > -1.0 && dy < 1.0) {
            this.hooks.onHitEnemy(enemyIds[k], this.dmg[i], this.px[i], this.py[i], this.pz[i]);
            dead = true;
            break;
          }
        }
      }
      const inst = this.instances[i];
      if (dead) {
        this.active[i] = 0;
        this.activeCount--;
        inst.position.set(0, -1000, 0);
        inst.scaling.setAll(0);
      } else {
        inst.position.set(this.px[i], this.py[i], -this.pz[i]);
        inst.scaling.setAll(1);
      }
    }
  }
}
