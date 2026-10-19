/** Juice: trauma-based screenshake (render-side), hit-stop via loop,
 *  pooled particle bursts (capped). Cosmetic only — never writes simulation
 *  state. Particles use unseeded RNG (cosmetic).
 *
 *  Babylon port of the ts-three reference (game/juice.ts): identical trauma
 *  math and particle sim. THREE.Points becomes BABYLON.PointsCloudSystem
 *  (the core particle-point API — not a Babylon-ism adoption, just the
 *  renderer analog). Positions are render-space (see game/player.ts);
 *  burst() converts its sim-space arguments. buildMeshAsync() is awaited by
 *  main before the loop starts (Juice.ready). */

import * as BABYLON from '@babylonjs/core';
import type { CloudPoint } from '@babylonjs/core/Particles/cloudPoint';

const MAX_PARTICLES = 512;

const _off = new BABYLON.Vector3();

export class Juice {
  /** 0..1 trauma; decays in update(). */
  trauma = 0;
  /** Resolves when the points mesh is built; main awaits it pre-loop. */
  readonly ready: Promise<void>;

  private pcs: BABYLON.PointsCloudSystem;
  private mesh: BABYLON.Mesh | null = null;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array; // 3 per particle
  private life: Float32Array;
  private maxLife: Float32Array;
  private cursor = 0;
  private needsSync = false;

  constructor(scene: BABYLON.Scene) {
    this.pos = new Float32Array(MAX_PARTICLES * 3);
    this.col = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.maxLife = new Float32Array(MAX_PARTICLES);
    for (let i = 0; i < MAX_PARTICLES; i++) this.pos[i * 3 + 1] = -1000;

    this.pcs = new BABYLON.PointsCloudSystem('juice', 10, scene);
    this.pcs.addPoints(MAX_PARTICLES, (p: CloudPoint) => {
      p.position.set(0, -1000, 0);
      p.color = new BABYLON.Color4(1, 1, 1, 1);
    });
    this.ready = this.pcs.buildMeshAsync().then((mesh) => {
      this.mesh = mesh;
      mesh.alwaysSelectAsActiveMesh = true; // never frustum-culled
      this.needsSync = true;
    });
  }

  /** Screenshake impulse, 0..1, stacks to 1. */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + Math.max(0, amount));
  }

  /** Decay trauma; called in postupdate. */
  update(dt: number): void {
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    // particles
    let anyAlive = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      anyAlive = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        this.pos[i3 + 1] = -1000;
        continue;
      }
      this.vel[i3 + 1] -= 9.5 * dt; // gravity on debris
      this.vel[i3] *= 1 - 2.2 * dt;
      this.vel[i3 + 2] *= 1 - 2.2 * dt;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02) { this.pos[i3 + 1] = 0.02; this.vel[i3 + 1] = 0; }
      // fade color toward end of life
      const f = this.life[i] / this.maxLife[i];
      if (f < 0.4) {
        const m = f / 0.4;
        this.col[i3] *= 0.92 + 0.08 * m;
        this.col[i3 + 1] *= 0.92 + 0.08 * m;
        this.col[i3 + 2] *= 0.92 + 0.08 * m;
      }
    }
    if (anyAlive) this.needsSync = true;
    if (this.needsSync && this.mesh) {
      const pts = this.pcs.particles;
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const i3 = i * 3;
        pts[i].position.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
        const c = pts[i].color;
        if (c) c.set(this.col[i3], this.col[i3 + 1], this.col[i3 + 2], 1);
      }
      this.pcs.setParticles();
      this.needsSync = false;
    }
  }

  /** Camera-space shake offset (render-side). Caller adds before render, subtracts after. */
  shakeOffset(out: BABYLON.Vector3): BABYLON.Vector3 {
    if (this.trauma <= 0) return out.set(0, 0, 0);
    const s = this.trauma * this.trauma * 0.5;
    // smooth-ish noise via sin of wall clock (cosmetic)
    const t = performance.now() * 0.03;
    _off.set(
      Math.sin(t * 1.3) * 0.6 + Math.sin(t * 3.7) * 0.4,
      Math.cos(t * 1.7) * 0.6 + Math.cos(t * 4.3) * 0.4,
      0,
    );
    return out.copyFrom(_off).scaleInPlace(s);
  }

  /** Particle burst at world pos (sim-space; converted to render-space).
   *  Neutral palette. */
  burst(x: number, y: number, z: number, count = 14, speed = 5, life = 0.7): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const i3 = i * 3;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.3;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = -z;
      this.vel[i3] = Math.cos(a) * sp;
      this.vel[i3 + 1] = up * sp;
      this.vel[i3 + 2] = Math.sin(a) * sp;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.7);
      // neutral: white to light gray
      const g = 0.75 + Math.random() * 0.25;
      this.col[i3] = g; this.col[i3 + 1] = g; this.col[i3 + 2] = g * 1.02;
    }
    this.needsSync = true;
  }
}
