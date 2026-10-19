/** Pooled health pickups: green cross boxes, bobbing + spin (render-side),
 *  picked up on proximity. One instanced bucket (2 instances per pickup).
 *  Entities live in the world with the engine Pickup component.
 *
 *  Babylon port of the ts-three reference (game/pickups.ts): identical sim.
 *  The three.js InstancedMesh matrix writes become per-instance
 *  position/rotation/scaling (same world transform, one draw call).
 *  Render mapping: (x,y,z)->(x,y,-z), spin yaw a->(PI+a) (see game/player.ts). */

import * as BABYLON from '@babylonjs/core';
import { C, World } from '../engine/ecs';
import type { Mats } from '../gfx/materials';
import { makeTransform, TransformFull } from './sim';

const POOL = 12;
const PICKUP_RADIUS = 1.15;

interface PickupComp { kind: 'health'; amount: number; taken: boolean }

export interface PickupState { x: number; z: number; amount: number; taken: boolean }

export class Pickups {
  private ids: number[] = [];
  private instances: BABYLON.InstancedMesh[] = [];
  private time = 0;

  constructor(scene: BABYLON.Scene, private world: World, mats: Mats) {
    const src = BABYLON.MeshBuilder.CreateBox('pickup', { width: 0.34, height: 0.34, depth: 0.12 }, scene);
    src.material = mats.pickup;
    src.isVisible = false;
    for (let i = 0; i < POOL * 2; i++) {
      const inst = src.createInstance('pickup' + i);
      inst.position.set(0, -1000, 0);
      inst.scaling.setAll(0);
      this.instances.push(inst);
    }
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
    // render: cross = two boxes, one rotated 90°
    let slot = 0;
    for (const id of this.ids) {
      const p = this.world.get<PickupComp>(id, C.Pickup);
      const t = this.world.get<TransformFull>(id, C.Transform);
      const vis = !!(p && t && !p.taken);
      const y = vis ? 0.75 + Math.sin(this.time * 2.4 + id) * 0.16 : -1000;
      for (let arm = 0; arm < 2; arm++) {
        const inst = this.instances[slot++];
        inst.position.set(t ? t.x : 0, y, t ? -t.z : 0);
        inst.rotation.y = Math.PI + this.time * 1.6 + arm * Math.PI / 2;
        inst.scaling.setAll(vis ? 1 : 0);
      }
    }
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
