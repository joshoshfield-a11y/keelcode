/** Asteroid + station-stub gfx.
 *
 * - `createAsteroidMesh`: returns an empty THREE.Group PROXY
 *   (`userData = { isRockProxy: true, radius, seed }`). Rocks are drawn by
 *   6 shared InstancedMesh variants — call `syncRockInstances(scene)` every
 *   frame after the normal mesh sync to write each proxy's world matrix
 *   into its variant slot. The proxy itself is a real Object3D: game code
 *   sets `.visible` (depleted), `.scale` (mining shrink), `.position` /
 *   `.rotation` (Transform sync) on it exactly as it did on the old Mesh.
 * - `createOrePickupMesh`: small green octahedron (ore chunk).
 * - `createStation`: STUB placeholder for the station. The meta builder swaps
 *   this one import line for the real `src/gfx/station.ts` `createStation()`
 *   (same name, same signature: `(): THREE.Group`).
 */

import * as THREE from 'three';
import { loadBakedTexture } from './textures';

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Rock instancing: proxies + 6 shared InstancedMesh variants
// ---------------------------------------------------------------------------

const ROCK_VARIANTS = 6;
const ROCK_CAPACITY = 128; // instances per variant

const rockProxies: THREE.Group[] = [];
let rockMeshes: THREE.InstancedMesh[] | null = null;
let rockScene: THREE.Scene | null = null;

const _m4 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

/** Unit rock geometry for one variant: displaced icosahedron.
 * Displacement is keyed by vertex position so duplicated polyhedron
 * vertices move together (watertight). Same 0.72–1.28 lump range as the
 * old per-rock geometry, so a unit rock scaled by `radius` matches the
 * old visual size. */
function rockVariantGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const rand = mulberry(seed);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 0.72 + rand() * 0.56;
      seen.set(key, k);
    }
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildRockMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  const mat = new THREE.MeshStandardMaterial({
    map: loadBakedTexture('rocks/field/rock'),
    roughness: 0.95, metalness: 0.0, flatShading: true,
  });
  const out: THREE.InstancedMesh[] = [];
  for (let v = 0; v < ROCK_VARIANTS; v++) {
    const im = new THREE.InstancedMesh(rockVariantGeometry(5000 + v * 977), mat, ROCK_CAPACITY);
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.count = 0; // syncRockInstances sets the live count every frame
    for (let i = 0; i < ROCK_CAPACITY; i++) im.setMatrixAt(i, _zero);
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    out.push(im);
  }
  return out;
}

function teardownRockMeshes(): void {
  if (rockMeshes && rockScene) {
    for (const m of rockMeshes) {
      rockScene.remove(m);
      m.dispose();
    }
  }
  rockMeshes = null;
  rockScene = null;
}

/** Rock proxy: empty Group registered for instanced rendering.
 * .visible / .scale / .position / .rotation behave normally (game code
 * drives them); the actual pixels come from syncRockInstances(). */
export function createAsteroidMesh(radius: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.userData = { isRockProxy: true, radius, seed };
  rockProxies.push(g);
  return g;
}

/** Assign every registered rock proxy to a variant slot (round-robin by
 * seed) and write its world matrix (position/quaternion/scale × radius).
 * Invisible proxies get a zero-scale matrix. Lazily creates the 6
 * InstancedMesh variants in the given scene on first call. Call every
 * frame, after the normal Transform→mesh sync. */
export function syncRockInstances(scene: THREE.Scene): void {
  if (!rockMeshes || rockScene !== scene) {
    teardownRockMeshes();
    rockMeshes = buildRockMeshes(scene);
    rockScene = scene;
  }
  const counters = new Array<number>(ROCK_VARIANTS).fill(0);
  for (const proxy of rockProxies) {
    const seed = Math.trunc(proxy.userData.seed as number);
    const v = ((seed % ROCK_VARIANTS) + ROCK_VARIANTS) % ROCK_VARIANTS;
    const idx = counters[v]++;
    if (idx >= ROCK_CAPACITY) continue;
    const im = rockMeshes[v];
    if (!proxy.visible) {
      im.setMatrixAt(idx, _zero);
      continue;
    }
    proxy.updateWorldMatrix(true, false);
    proxy.matrixWorld.decompose(_p, _q, _s);
    _s.multiplyScalar(proxy.userData.radius as number);
    _m4.compose(_p, _q, _s);
    im.setMatrixAt(idx, _m4);
  }
  for (let v = 0; v < ROCK_VARIANTS; v++) {
    const im = rockMeshes[v];
    // Only the assigned slots render — capacity-sized zero-scale instances
    // still cost full vertex processing in every pass (main + shadow).
    im.count = counters[v];
    im.instanceMatrix.needsUpdate = true;
  }
}

/** Test hygiene: drop all registered proxies and remove the InstancedMeshes. */
export function resetRockRegistry(): void {
  rockProxies.length = 0;
  teardownRockMeshes();
}

/** Floating ore chunk pickup. */
export function createOrePickupMesh(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: '#3fae5a', roughness: 0.5, metalness: 0.2,
    emissive: '#1d5c30', emissiveIntensity: 0.8,
  });
  return new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), mat);
}

/** STUB station: spindle + ring + dock arm, baked dock texture.
 *  Signature matches the real `src/gfx/station.ts` `createStation()`. */
export function createStation(): THREE.Group {
  const tex = loadBakedTexture('station/dock/hull');
  const hull = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: '#4a4f57', roughness: 0.7, metalness: 0.3 });
  const g = new THREE.Group();

  const spindle = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 60, 10), hull);
  spindle.rotation.z = Math.PI / 2;
  g.add(spindle);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(22, 3.2, 8, 24), dark);
  ring.rotation.y = Math.PI / 2;
  g.add(ring);

  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 2), hull);
    arm.position.set(s * 12, -8, 0);
    g.add(arm);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(6, 0.8, 8), dark);
    pad.position.set(s * 18, -8, 0);
    g.add(pad);
  }

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 10, 8),
    new THREE.MeshBasicMaterial({ color: '#e8ecf2' }),
  );
  beacon.position.set(0, 34, 0);
  g.add(beacon);

  return g;
}
