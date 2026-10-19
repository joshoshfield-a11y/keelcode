/** Arena: 40x40 ground with subtle canvas grid, 4 walls, 7 instanced
 *  pillars, hemisphere + one shadowed directional light, fog, sky color.
 *  Single owner: buildArena(). Static colliders registered with the engine
 *  physics (Rapier); the AABB list is also kept for projectile collision
 *  and camera raycasts (the engine physics exposes no query API). */

import * as THREE from 'three';
import type { PhysicsSys } from '../engine/physics';
import { createStreams } from '../engine/rng';
import type { Mats } from '../gfx/materials';

export interface AABB { minx: number; miny: number; minz: number; maxx: number; maxy: number; maxz: number }

export interface ArenaData {
  half: number;
  pillarSpots: Array<{ x: number; z: number; r: number }>;
  statics: AABB[];
  /** Segment vs static AABBs; nearest hit distance or Infinity. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number;
  /** Sphere vs static AABBs. */
  sphereHitsStatic(x: number, y: number, z: number, r: number): boolean;
}

const SIZE = 40;
const HALF = SIZE / 2;
export const MASTER_SEED = 1337;

function makeGridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8b9097';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(70,74,80,0.55)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 253);
  g.fillStyle = 'rgba(255,255,255,0.04)';
  for (let i = 0; i < 120; i++) {
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 20); // one cell = 2 world units
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addStaticBox(physics: PhysicsSys, statics: AABB[], minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number): void {
  statics.push({ minx, miny, minz, maxx, maxy, maxz });
  physics.addBody({
    kind: 'box',
    hx: (maxx - minx) / 2, hy: (maxy - miny) / 2, hz: (maxz - minz) / 2,
    x: (minx + maxx) / 2, y: (miny + maxy) / 2, z: (minz + maxz) / 2,
    static: true,
  });
}

function rayAABB(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  b: AABB, maxDist: number,
): number {
  let tmin = 0, tmax = maxDist;
  // x
  if (Math.abs(dx) < 1e-9) {
    if (ox < b.minx || ox > b.maxx) return Infinity;
  } else {
    let t1 = (b.minx - ox) / dx, t2 = (b.maxx - ox) / dx;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  // y
  if (Math.abs(dy) < 1e-9) {
    if (oy < b.miny || oy > b.maxy) return Infinity;
  } else {
    let t1 = (b.miny - oy) / dy, t2 = (b.maxy - oy) / dy;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  // z
  if (Math.abs(dz) < 1e-9) {
    if (oz < b.minz || oz > b.maxz) return Infinity;
  } else {
    let t1 = (b.minz - oz) / dz, t2 = (b.maxz - oz) / dz;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

export function buildArena(scene: THREE.Scene, physics: PhysicsSys, mats: Mats, isMobile: boolean): ArenaData {
  scene.background = new THREE.Color('#9fb4c7');
  scene.fog = new THREE.Fog('#9fb4c7', 45, 95);
  const statics: AABB[] = [];

  // ground (visual plane + thin static box for physics)
  const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE);
  const groundMat = mats.ground.clone();
  groundMat.map = makeGridTexture();
  groundMat.color.set('#ffffff'); // texture carries the color
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  addStaticBox(physics, statics, -HALF, -1, -HALF, HALF, 0, HALF);

  // lights
  const hemi = new THREE.HemisphereLight('#d7e6f5', '#5a5f66', 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffffff', 1.7);
  sun.position.set(18, 26, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24;
  sc.near = 1; sc.far = 70;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);

  // walls
  const wallGeo = new THREE.BoxGeometry(SIZE + 2, 3, 1);
  for (const z of [-HALF - 0.5, HALF + 0.5]) {
    const w = new THREE.Mesh(wallGeo, mats.wall);
    w.position.set(0, 1.5, z);
    w.castShadow = true; w.receiveShadow = true;
    scene.add(w);
    addStaticBox(physics, statics, -SIZE / 2, 0, z - 0.5, SIZE / 2, 3, z + 0.5);
  }
  const wallGeoZ = new THREE.BoxGeometry(1, 3, SIZE + 2);
  for (const x of [-HALF - 0.5, HALF + 0.5]) {
    const w = new THREE.Mesh(wallGeoZ, mats.wall);
    w.position.set(x, 1.5, 0);
    w.castShadow = true; w.receiveShadow = true;
    scene.add(w);
    addStaticBox(physics, statics, x - 0.5, 0, -SIZE / 2, x + 0.5, 3, SIZE / 2);
  }

  // pillars: one InstancedMesh, seeded ring placement (stream 'arena')
  const streams = createStreams(MASTER_SEED, ['arena']);
  const rng = streams['arena'];
  const pillarSpots: Array<{ x: number; z: number; r: number }> = [];
  const N = 7;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const rad = 10 + rng() * 5;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    pillarSpots.push({ x, z, r: 0.9 });
  }
  const pillarGeo = new THREE.CylinderGeometry(0.8, 0.95, 6, 12);
  const pillars = new THREE.InstancedMesh(pillarGeo, mats.pillar, N);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const p = pillarSpots[i];
    m4.makeTranslation(p.x, 3, p.z);
    pillars.setMatrixAt(i, m4);
    pillars.setColorAt(i, col.setHSL(0.58, 0.04, 0.62 + (rng() - 0.5) * 0.08));
    addStaticBox(physics, statics, p.x - 0.8, 0, p.z - 0.8, p.x + 0.8, 6, p.z + 0.8);
  }
  pillars.instanceMatrix.needsUpdate = true;
  if (pillars.instanceColor) pillars.instanceColor.needsUpdate = true;
  pillars.castShadow = true;
  pillars.receiveShadow = true;
  scene.add(pillars);

  return {
    half: HALF,
    pillarSpots,
    statics,
    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      let best = Infinity;
      for (const b of statics) {
        const t = rayAABB(ox, oy, oz, dx, dy, dz, b, maxDist);
        if (t < best) best = t;
      }
      return best;
    },
    sphereHitsStatic(x, y, z, r) {
      for (const b of statics) {
        const cx = Math.max(b.minx, Math.min(x, b.maxx));
        const cy = Math.max(b.miny, Math.min(y, b.maxy));
        const cz = Math.max(b.minz, Math.min(z, b.maxz));
        const ddx = x - cx, ddy = y - cy, ddz = z - cz;
        if (ddx * ddx + ddy * ddy + ddz * ddz < r * r) return true;
      }
      return false;
    },
  };
}
