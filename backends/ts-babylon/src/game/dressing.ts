/** World dressing: seeded scatter of ~24 neutral props.
 *  Single owner: scatterDressing() — called exactly once by main.
 *  Two instanced buckets (boxes, pyramids) = 2 draw calls.
 *
 *  Babylon port of the ts-three reference (game/dressing.ts): identical
 *  placement math and seeds. three.js InstancedMesh.setMatrixAt is replaced
 *  by per-instance position/rotation/scaling on BABYLON.InstancedMesh
 *  (equivalent: the same world transform, no per-frame allocation).
 *  Render-space convention (see game/player.ts): sim (x,y,z) -> render
 *  (x,y,-z); yaw a -> (PI + a). */

import * as BABYLON from '@babylonjs/core';
import { hsl, type Mats } from '../gfx/materials';
import { createStreams } from '../engine/rng';
import { MASTER_SEED } from './arena';

const BOX_COUNT = 16;
const PYR_COUNT = 8;

export function scatterDressing(
  scene: BABYLON.Scene,
  mats: Mats,
  avoid: Array<{ x: number; z: number; r: number }>,
  shadow: BABYLON.ShadowGenerator,
): void {
  const rng = createStreams(MASTER_SEED, ['dressing'])['dressing'];

  const clearOf = (x: number, z: number, r: number): boolean => {
    if (Math.hypot(x, z) < 5 + r) return false;      // player spawn clearing
    if (Math.abs(x) > 18.5 - r || Math.abs(z) > 18.5 - r) return false;
    for (const a of avoid) {
      if (Math.hypot(x - a.x, z - a.z) < r + a.r + 0.6) return false;
    }
    return true;
  };

  const place = (): { x: number; z: number } => {
    let px = (rng() * 2 - 1) * 17, pz = (rng() * 2 - 1) * 17;
    for (let tries = 0; tries < 40 && !clearOf(px, pz, 1.2); tries++) {
      px = (rng() * 2 - 1) * 17;
      pz = (rng() * 2 - 1) * 17;
    }
    return { x: px, z: pz };
  };

  // low boxes
  const boxSrc = BABYLON.MeshBuilder.CreateBox('propBox', { width: 1, height: 1, depth: 1 }, scene);
  boxSrc.material = mats.propA;
  boxSrc.isVisible = false;
  boxSrc.registerInstancedBuffer('color', 4);
  for (let i = 0; i < BOX_COUNT; i++) {
    const p = place();
    const w = 1.0 + rng() * 1.6, h = 0.35 + rng() * 0.75, d = 1.0 + rng() * 1.2;
    const inst = boxSrc.createInstance('propBox' + i);
    inst.position.set(p.x, h / 2, -p.z);
    inst.rotation.y = Math.PI + rng() * Math.PI;
    inst.scaling.set(w, h, d);
    const c = hsl(0.58, 0.05, 0.5 + (rng() - 0.5) * 0.12);
    inst.instancedBuffers.color = new BABYLON.Color4(c.r, c.g, c.b, 1);
    inst.receiveShadows = true;
    shadow.addShadowCaster(inst);
  }

  // small pyramids (4-sided cones)
  const pyrSrc = BABYLON.MeshBuilder.CreateCylinder(
    'propPyr', { height: 1.4, diameterTop: 0, diameterBottom: 1.8, tessellation: 4 }, scene);
  pyrSrc.material = mats.propB;
  pyrSrc.isVisible = false;
  pyrSrc.registerInstancedBuffer('color', 4);
  for (let i = 0; i < PYR_COUNT; i++) {
    const p = place();
    const sc = 0.7 + rng() * 0.9;
    const inst = pyrSrc.createInstance('propPyr' + i);
    inst.position.set(p.x, 0.7 * sc, -p.z);
    inst.rotation.y = Math.PI + rng() * Math.PI + Math.PI / 4;
    inst.scaling.set(sc, sc, sc);
    const c = hsl(0.08, 0.06, 0.55 + (rng() - 0.5) * 0.1);
    inst.instancedBuffers.color = new BABYLON.Color4(c.r, c.g, c.b, 1);
    shadow.addShadowCaster(inst);
  }
}
