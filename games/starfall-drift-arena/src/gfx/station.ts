/** Station gfx: big neutral-industrial drift station, greeble + merge pass.
 *
 * createStation(): THREE.Group — central hub cylinder + rotating ring +
 * dock arms, MeshStandardMaterial using the baked `station/dock/hull`
 * texture (/assets/station/dock/hull.png), plus blinking dock lights
 * (emissive small spheres).
 *
 * Static geometry is merged by material (baked transforms), so the station
 * is 7 draw meshes + the 12 individual blinking bulbs (kept separate —
 * they're the character):
 * - static hull merge (hub + dock claws), static dark merge (spire, dome,
 *   dock arms, arm pipes, antenna mast + dish), merged emissive window
 *   bands around the hub
 * - ring group (spins via userData.update): hull merge (torus + hull
 *   pods), dark merge (dark pods), window merge (pod window boxes)
 *
 * Same name/signature as the sim builder's `createStationStub()` swap target:
 * one import line replaces the stub. Animate via
 *   (group.userData.update as ((dt: number, t: number) => void) | undefined)?.(dt, t)
 * from the sim's update phase.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { loadBakedTexture } from './textures';

export interface StationAnimation {
  /** Rotates the ring, blinks the dock lights. t = seconds. */
  update(dt: number, t: number): void;
}

interface BakeOpts {
  p?: [number, number, number];
  r?: [number, number, number];
  s?: [number, number, number];
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _sv = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Bake a position/rotation/scale transform into a geometry (for merging). */
function bake(geo: THREE.BufferGeometry, opts: BakeOpts = {}): THREE.BufferGeometry {
  const [px, py, pz] = opts.p ?? [0, 0, 0];
  const [rx, ry, rz] = opts.r ?? [0, 0, 0];
  const [sx, sy, sz] = opts.s ?? [1, 1, 1];
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(px, py, pz);
  _sv.set(sx, sy, sz);
  _m.compose(_v, _q, _sv);
  geo.applyMatrix4(_m);
  return geo;
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('[station] mergeGeometries failed (incompatible attributes)');
  return g;
}

export function createStation(): THREE.Group {
  const group = new THREE.Group();

  const tex = loadBakedTexture('station/dock/hull');

  const hull = new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xb9bec6,
    roughness: 0.55,
    metalness: 0.35,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x4a5058,
    roughness: 0.7,
    metalness: 0.5,
    side: THREE.DoubleSide, // open antenna dish reads from both sides
  });
  const windows = new THREE.MeshStandardMaterial({
    color: 0x2a2118,
    emissive: 0xffd9a0,
    emissiveIntensity: 1.7,
    roughness: 0.4,
    metalness: 0.1,
  });

  // ---- static hull merge: central hub + dock claws ----
  const hullParts: THREE.BufferGeometry[] = [
    bake(new THREE.CylinderGeometry(16, 20, 70, 24)),
  ];
  // ---- static dark merge: spire, dome, dock arms, pipes, antenna ----
  const darkParts: THREE.BufferGeometry[] = [
    bake(new THREE.CylinderGeometry(4, 8, 30, 12), { p: [0, 50, 0] }), // spire
    bake(new THREE.SphereGeometry(10, 16, 12), { p: [0, -40, 0] }), // sensor dome
    bake(new THREE.CylinderGeometry(0.35, 0.35, 9, 6), { p: [0, 69, 0] }), // antenna mast
  ];
  // Antenna dish: open frustum, tilted up on the mast.
  const dish = new THREE.CylinderGeometry(5.2, 0.6, 2.4, 14, 1, true);
  bake(dish, { r: [0.5, 0, 0] });
  bake(dish, { p: [0, 74, 0] });
  darkParts.push(dish);

  // Dock arms: 4 struts from hub to ring with dock claws at the ends,
  // plus a pipe cylinder running along the top of each arm.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    darkParts.push(bake(new THREE.BoxGeometry(34, 4, 4), {
      p: [ca * 30, 12, sa * 30], r: [0, -a, 0],
    }));
    const pipe = new THREE.CylinderGeometry(0.45, 0.45, 30, 6);
    bake(pipe, { r: [0, 0, Math.PI / 2] }); // axis Y -> X
    bake(pipe, { p: [ca * 30, 14.6, sa * 30], r: [0, -a, 0] });
    darkParts.push(pipe);
    hullParts.push(bake(new THREE.BoxGeometry(8, 6, 12), {
      p: [ca * 47, 12, sa * 47], r: [0, -a, 0],
    }));
  }

  group.add(new THREE.Mesh(merged(hullParts), hull));
  group.add(new THREE.Mesh(merged(darkParts), dark));

  // Emissive window bands around the hub (radii follow the hub taper).
  const bandParts = [
    bake(new THREE.TorusGeometry(17.1, 0.45, 6, 48), { p: [0, 18, 0], r: [Math.PI / 2, 0, 0] }),
    bake(new THREE.TorusGeometry(19.15, 0.45, 6, 48), { p: [0, -18, 0], r: [Math.PI / 2, 0, 0] }),
  ];
  group.add(new THREE.Mesh(merged(bandParts), windows));

  // ---- rotating ring group: torus + cargo pods, merged by material ----
  const ring = new THREE.Group();
  const ringHullParts: THREE.BufferGeometry[] = [
    bake(new THREE.TorusGeometry(48, 6, 12, 48), { r: [Math.PI / 2, 0, 0] }),
  ];
  const ringDarkParts: THREE.BufferGeometry[] = [];
  const ringWinParts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const pod = bake(new THREE.BoxGeometry(14, 8, 10), {
      p: [Math.cos(a) * 48, 0, Math.sin(a) * 48], r: [0, -a, 0],
    });
    (i % 2 === 0 ? ringHullParts : ringDarkParts).push(pod);
    // Emissive window box on the pod's radially-outward face (+local X):
    // bake the pod-local offset first, then the pod's own transform.
    const win = new THREE.BoxGeometry(0.5, 1.6, 3.2);
    bake(win, { p: [7.2, 0.8, 0] });
    bake(win, { p: [Math.cos(a) * 48, 0, Math.sin(a) * 48], r: [0, -a, 0] });
    ringWinParts.push(win);
  }
  ring.add(new THREE.Mesh(merged(ringHullParts), hull));
  ring.add(new THREE.Mesh(merged(ringDarkParts), dark));
  ring.add(new THREE.Mesh(merged(ringWinParts), windows));
  group.add(ring);

  // Blinking dock lights: emissive spheres on the ring + hub (kept individual).
  const lightColors = [0xffb020, 0x30ff70, 0xff4040, 0x30c0ff];
  const lightMats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 12; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      emissive: lightColors[i % lightColors.length],
      emissiveIntensity: 2,
      roughness: 0.4,
      metalness: 0.1,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), mat);
    if (i < 8) {
      const a = (i / 8) * Math.PI * 2;
      bulb.position.set(Math.cos(a) * 48, 7, Math.sin(a) * 48);
    } else {
      const a = ((i - 8) / 4) * Math.PI * 2;
      bulb.position.set(Math.cos(a) * 20, 30, Math.sin(a) * 20);
    }
    group.add(bulb);
    lightMats.push(mat);
  }

  const anim: StationAnimation = {
    update(dt: number, t: number): void {
      ring.rotation.y += dt * 0.08;
      for (let i = 0; i < lightMats.length; i++) {
        const phase = Math.sin(t * 3 + i * 1.7);
        lightMats[i].emissiveIntensity = phase > 0 ? 2.4 : 0.2;
      }
    },
  };
  group.userData.update = anim.update;

  return group;
}
