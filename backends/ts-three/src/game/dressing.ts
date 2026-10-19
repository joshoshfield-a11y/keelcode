/** World dressing: seeded scatter of ~24 neutral props.
 *  Single owner: scatterDressing() — called exactly once by main.
 *  Two InstancedMesh buckets (boxes, pyramids) = 2 draw calls. */

import * as THREE from 'three';
import type { Mats } from '../gfx/materials';
import { createStreams } from '../engine/rng';
import { MASTER_SEED } from './arena';

const BOX_COUNT = 16;
const PYR_COUNT = 8;

export function scatterDressing(
  scene: THREE.Scene,
  mats: Mats,
  avoid: Array<{ x: number; z: number; r: number }>,
): void {
  const rng = createStreams(MASTER_SEED, ['dressing'])['dressing'];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const col = new THREE.Color();

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
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const boxes = new THREE.InstancedMesh(boxGeo, mats.propA, BOX_COUNT);
  for (let i = 0; i < BOX_COUNT; i++) {
    const p = place();
    const w = 1.0 + rng() * 1.6, h = 0.35 + rng() * 0.75, d = 1.0 + rng() * 1.2;
    e.set(0, rng() * Math.PI, 0);
    q.setFromEuler(e);
    v.set(p.x, h / 2, p.z);
    s.set(w, h, d);
    m4.compose(v, q, s);
    boxes.setMatrixAt(i, m4);
    boxes.setColorAt(i, col.setHSL(0.58, 0.05, 0.5 + (rng() - 0.5) * 0.12));
  }
  boxes.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  boxes.castShadow = true;
  boxes.receiveShadow = true;
  scene.add(boxes);

  // small pyramids (4-sided cones)
  const pyrGeo = new THREE.ConeGeometry(0.9, 1.4, 4);
  const pyrs = new THREE.InstancedMesh(pyrGeo, mats.propB, PYR_COUNT);
  for (let i = 0; i < PYR_COUNT; i++) {
    const p = place();
    const sc = 0.7 + rng() * 0.9;
    e.set(0, rng() * Math.PI + Math.PI / 4, 0);
    q.setFromEuler(e);
    v.set(p.x, 0.7 * sc, p.z);
    s.set(sc, sc, sc);
    m4.compose(v, q, s);
    pyrs.setMatrixAt(i, m4);
    pyrs.setColorAt(i, col.setHSL(0.08, 0.06, 0.55 + (rng() - 0.5) * 0.1));
  }
  pyrs.instanceMatrix.needsUpdate = true;
  if (pyrs.instanceColor) pyrs.instanceColor.needsUpdate = true;
  pyrs.castShadow = true;
  scene.add(pyrs);
}
