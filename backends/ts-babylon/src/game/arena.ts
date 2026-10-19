/** Arena: 40x40 ground with subtle canvas grid, 4 walls, 7 instanced
 *  pillars, hemisphere + one shadowed directional light, fog, sky color.
 *  Single owner: buildArena(). Static colliders registered with the engine
 *  physics (Havok); the AABB list is also kept for projectile collision
 *  and camera raycasts (the engine physics exposes no query API).
 *
 *  Babylon port of the ts-three reference (game/arena.ts): identical
 *  layout, seeds, AABB math, and raycast helpers — only the scene-graph
 *  calls change. Render-space convention (see game/player.ts): sim
 *  (x,y,z) -> render (x,y,-z); rotations about Y become (PI + ry).
 *  All sim-space math below (statics, raycast, sphere tests) is untouched. */

import * as BABYLON from '@babylonjs/core';
import type { PhysicsSys } from '../engine/physics';
import { createStreams } from '../engine/rng';
import { hsl, type Mats } from '../gfx/materials';

export interface AABB { minx: number; miny: number; minz: number; maxx: number; maxy: number; maxz: number }

export interface ArenaData {
  half: number;
  pillarSpots: Array<{ x: number; z: number; r: number }>;
  statics: AABB[];
  /** The scene shadow generator (game code registers casters with it). */
  shadow: BABYLON.ShadowGenerator;
  /** Segment vs static AABBs; nearest hit distance or Infinity. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number;
  /** Sphere vs static AABBs. */
  sphereHitsStatic(x: number, y: number, z: number, r: number): boolean;
}

const SIZE = 40;
const HALF = SIZE / 2;
export const MASTER_SEED = 1337;

/** Controller-owned gravity sink, measured on the ts-three reference
 *  2026-10-19: the reference forces vy to {0, JUMP_VEL} every tick and
 *  Rapier's gravity-during-step sinks the body by this amount per tick
 *  (jump apex +0.079m in one tick, then this sink back to REST_Y).
 *  The Havok ANIMATED driver (Child A probe) applies no gravity, so the
 *  controller applies the sink itself. NOT a tuning constant — emergent
 *  behavior of the reference, replicated so the jump trajectory matches. */
export const CONTACT_SINK_PER_TICK = 0.0017;

/** Push the XZ circle (p.x, p.z, radius) at height p.y out of static AABBs
 *  whose y-range contains p.y (walls, pillars — never the ground slab).
 *  Mutates p.x/p.z; returns true if the position changed.
 *  Controller-owned contact for the Havok ANIMATED driver, which resolves
 *  no contacts (probe: animated sphere fell straight through the static
 *  ground to y=-25). ts-three's Rapier build resolved this inside the
 *  physics step; without an equivalent the characters walk through walls. */
export function resolveStaticContact(
  statics: AABB[],
  p: { x: number; y: number; z: number },
  radius: number,
): boolean {
  let moved = false;
  for (const b of statics) {
    if (p.y < b.miny || p.y > b.maxy) continue;
    const cx = Math.max(b.minx, Math.min(p.x, b.maxx));
    const cz = Math.max(b.minz, Math.min(p.z, b.maxz));
    const dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      const push = (radius - d) / d;
      p.x += dx * push;
      p.z += dz * push;
    } else {
      // center inside the AABB (e.g. spawn overlap): least-penetration axis
      const pl = p.x - b.minx, pr = b.maxx - p.x;
      const pn = p.z - b.minz, pf = b.maxz - p.z;
      const m = Math.min(pl, pr, pn, pf);
      if (m === pl) p.x = b.minx - radius;
      else if (m === pr) p.x = b.maxx + radius;
      else if (m === pn) p.z = b.minz - radius;
      else p.z = b.maxz + radius;
    }
    moved = true;
  }
  return moved;
}

function makeGridTexture(scene: BABYLON.Scene): BABYLON.Texture {
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
  const tex = new BABYLON.Texture(c.toDataURL(), scene);
  tex.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  tex.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  tex.uScale = 20; tex.vScale = 20; // one cell = 2 world units
  tex.anisotropicFilteringLevel = 4;
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

export function buildArena(scene: BABYLON.Scene, physics: PhysicsSys, mats: Mats, isMobile: boolean): ArenaData {
  scene.clearColor = BABYLON.Color4.FromHexString('#9fb4c7ff');
  scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
  scene.fogColor = BABYLON.Color3.FromHexString('#9fb4c7');
  scene.fogStart = 45;
  scene.fogEnd = 95;
  const statics: AABB[] = [];

  // ground (visual plane + thin static box for physics)
  const groundMat = new BABYLON.StandardMaterial('groundMap', scene);
  groundMat.diffuseTexture = makeGridTexture(scene);
  groundMat.diffuseColor = new BABYLON.Color3(1, 1, 1); // texture carries the color
  groundMat.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: SIZE, height: SIZE, subdivisions: 1 }, scene);
  ground.material = groundMat;
  ground.receiveShadows = true;
  addStaticBox(physics, statics, -HALF, -1, -HALF, HALF, 0, HALF);

  // lights
  const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
  hemi.diffuse = BABYLON.Color3.FromHexString('#d7e6f5');
  hemi.groundColor = BABYLON.Color3.FromHexString('#5a5f66');
  hemi.intensity = 0.75;
  const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-18, -26, 10).normalize(), scene);
  sun.diffuse = BABYLON.Color3.FromHexString('#ffffff');
  sun.intensity = 1.7;
  sun.position = new BABYLON.Vector3(18, 26, -10); // render-space mirror of (18,26,10)
  sun.shadowMinZ = 1;
  sun.shadowMaxZ = 70;
  const shadow = new BABYLON.ShadowGenerator(isMobile ? 1024 : 2048, sun);
  shadow.usePercentageCloserFiltering = true; // PCFSoft look
  shadow.bias = -0.0004;
  shadow.normalBias = 0.02;

  // walls
  const wallGeoZ = BABYLON.MeshBuilder.CreateBox('wallGeo', { width: SIZE + 2, height: 3, depth: 1 }, scene);
  wallGeoZ.isVisible = false;
  const wallGeoX = BABYLON.MeshBuilder.CreateBox('wallGeoX', { width: 1, height: 3, depth: SIZE + 2 }, scene);
  wallGeoX.isVisible = false;
  for (const z of [-HALF - 0.5, HALF + 0.5]) {
    const w = wallGeoZ.clone('wall');
    w.isVisible = true;
    w.material = mats.wall;
    w.position.set(0, 1.5, -z);
    w.receiveShadows = true;
    shadow.addShadowCaster(w);
    addStaticBox(physics, statics, -SIZE / 2, 0, z - 0.5, SIZE / 2, 3, z + 0.5);
  }
  for (const x of [-HALF - 0.5, HALF + 0.5]) {
    const w = wallGeoX.clone('wallX');
    w.isVisible = true;
    w.material = mats.wall;
    w.position.set(x, 1.5, 0);
    w.receiveShadows = true;
    shadow.addShadowCaster(w);
    addStaticBox(physics, statics, x - 0.5, 0, -SIZE / 2, x + 0.5, 3, SIZE / 2);
  }

  // pillars: instanced, seeded ring placement (stream 'arena')
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
  const pillarSrc = BABYLON.MeshBuilder.CreateCylinder(
    'pillar', { height: 6, diameterTop: 1.6, diameterBottom: 1.9, tessellation: 12 }, scene);
  pillarSrc.material = mats.pillar;
  pillarSrc.isVisible = false;
  pillarSrc.registerInstancedBuffer('color', 4);
  for (let i = 0; i < N; i++) {
    const p = pillarSpots[i];
    const inst = pillarSrc.createInstance('pillar' + i);
    inst.position.set(p.x, 3, -p.z);
    const c = hsl(0.58, 0.04, 0.62 + (rng() - 0.5) * 0.08);
    inst.instancedBuffers.color = new BABYLON.Color4(c.r, c.g, c.b, 1);
    inst.receiveShadows = true;
    shadow.addShadowCaster(inst);
    addStaticBox(physics, statics, p.x - 0.8, 0, p.z - 0.8, p.x + 0.8, 6, p.z + 0.8);
  }

  return {
    half: HALF,
    pillarSpots,
    statics,
    shadow,
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
