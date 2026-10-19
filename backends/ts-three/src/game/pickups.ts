/** Pooled health pickups: green cross boxes, bobbing + spin (render-side),
 *  picked up on proximity. One InstancedMesh (2 instances per pickup).
 *  Entities live in the world with the engine Pickup component. */

import * as THREE from 'three';
import { C, World } from '../engine/ecs';
import type { Mats } from '../gfx/materials';
import { makeTransform, TransformFull } from './sim';

const POOL = 12;
const PICKUP_RADIUS = 1.15;

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

interface PickupComp { kind: 'health'; amount: number; taken: boolean }

export interface PickupState { x: number; z: number; amount: number; taken: boolean }

export class Pickups {
  private ids: number[] = [];
  private mesh: THREE.InstancedMesh;
  private time = 0;

  constructor(scene: THREE.Scene, private world: World, mats: Mats) {
    const geo = new THREE.BoxGeometry(0.34, 0.34, 0.12);
    this.mesh = new THREE.InstancedMesh(geo, mats.pickup, POOL * 2);
    this.mesh.frustumCulled = false;
    _v.set(0, -1000, 0); _s.set(0, 0, 0); _q.identity();
    for (let i = 0; i < POOL * 2; i++) {
      _m4.compose(_v, _q, _s);
      this.mesh.setMatrixAt(i, _m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    scene.add(this.mesh);
  }

  spawn(x: number, z: number, amount = 25): void {
    for (const id of this.ids) {
      const p = this.world.get<PickupComp>(id, C.Pickup);
      if (p && p.taken) {
        p.taken = false; p.amount = amount;
        const t = this.world.get<TransformFull>(id, C.Transform);
        if (t) { t.x = x; t.z = z; t.position.x = x; t.position.z = z; }
        return;
      }
    }
    if (this.ids.length >= POOL) return;
    const id = this.world.spawn({
      [C.Transform]: makeTransform(x, 0, z),
      [C.Pickup]: { kind: 'health', amount, taken: false } as PickupComp,
      [C.Renderable]: { mesh: 'pickup', tint: 0xffffff, visible: true },
    });
    this.ids.push(id);
  }

  clear(): void {
    for (const id of this.ids) this.world.despawn(id);
    this.ids.length = 0;
  }

  /** Proximity pickup vs player; bob/spin animated here (render-side). */
  update(dt: number, px: number, pz: number, onPickup: (amount: number, x: number, z: number) => void): void {
    this.time += dt;
    for (const id of this.ids) {
      const p = this.world.get<PickupComp>(id, C.Pickup);
      const t = this.world.get<TransformFull>(id, C.Transform);
      if (!p || !t || p.taken) continue;
      const dx = px - t.x, dz = pz - t.z;
      if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
        p.taken = true;
        onPickup(p.amount, t.x, t.z);
      }
    }
    // render matrices: cross = two boxes, one rotated 90°
    let slot = 0;
    for (const id of this.ids) {
      const p = this.world.get<PickupComp>(id, C.Pickup);
      const t = this.world.get<TransformFull>(id, C.Transform);
      const vis = !!(p && t && !p.taken);
      const y = vis ? 0.75 + Math.sin(this.time * 2.4 + id) * 0.16 : -1000;
      for (let arm = 0; arm < 2; arm++) {
        _e.set(0, this.time * 1.6 + arm * Math.PI / 2, 0);
        _q.setFromEuler(_e);
        _v.set(t ? t.x : 0, y, t ? t.z : 0);
        _s.set(vis ? 1 : 0, vis ? 1 : 0, vis ? 1 : 0);
        _m4.compose(_v, _q, _s);
        this.mesh.setMatrixAt(slot++, _m4);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  serialize(): PickupState[] {
    const out: PickupState[] = [];
    for (const id of this.ids) {
      const p = this.world.get<PickupComp>(id, C.Pickup);
      const t = this.world.get<TransformFull>(id, C.Transform);
      if (p && t) out.push({ x: t.x, z: t.z, amount: p.amount, taken: p.taken });
    }
    return out;
  }

  restore(states: PickupState[]): void {
    this.clear();
    for (const s of states) {
      const id = this.world.spawn({
        [C.Transform]: makeTransform(s.x, 0, s.z),
        [C.Pickup]: { kind: 'health', amount: s.amount, taken: s.taken } as PickupComp,
        [C.Renderable]: { mesh: 'pickup', tint: 0xffffff, visible: true },
      });
      this.ids.push(id);
    }
  }
}
