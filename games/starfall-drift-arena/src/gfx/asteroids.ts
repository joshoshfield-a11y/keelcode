/** Asteroid + station-stub gfx.
 *
 * - `createAsteroidMesh`: displaced icosahedron with the baked rock texture.
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

/** Lumpy low-poly rock, flat-shaded, baked rock texture. */
export function createAsteroidMesh(radius: number, seed: number): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(radius, 1);
  const rand = mulberry(seed);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = 0.72 + rand() * 0.56;
    v.multiplyScalar(k);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: loadBakedTexture('rocks/field/rock'),
    roughness: 0.95, metalness: 0.0, flatShading: true,
  });
  return new THREE.Mesh(geo, mat);
}

/** Floating ore chunk pickup. */
export function createOrePickupMesh(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: '#3fae5a', roughness: 0.5, metalness: 0.2,
    emissive: '#1d5c30', emissiveIntensity: 0.35,
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
