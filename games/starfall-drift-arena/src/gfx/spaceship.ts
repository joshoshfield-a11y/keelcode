/** Spaceship gfx: low-poly player + pirate ships, detail pass + draw-call merge.
 *
 * Parts are baked into merged geometries per material (transforms applied
 * via applyMatrix4 before mergeGeometries), so each ship is a handful of
 * meshes:
 * - player: 6 meshes (merged hull, merged trim, glass canopy, merged engine
 *   glow, emissive trim stripe, merged vertex-colored nav lights)
 * - pirates: 3 meshes each (merged hull / dark / engine glow), with the 3
 *   variants visually distinct (silhouette + accent glow color).
 *
 * Ship forward convention: -Z. Thruster positions are exposed on
 * `userData.engineTips` (player) / `userData.engineTip` (pirates) for the
 * trail FX in main.ts.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadBakedTexture } from './textures';

export type PirateVariant = 'scout' | 'raider' | 'bruiser';

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
  if (!g) throw new Error('[spaceship] mergeGeometries failed (incompatible attributes)');
  return g;
}

/** Small sphere with a baked vertex color, for merging nav lights. */
function coloredSphere(x: number, y: number, z: number, color: string, r = 0.09): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 8, 6);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return bake(g, { p: [x, y, z] });
}

function playerMats(): { hull: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; glass: THREE.MeshStandardMaterial } {
  return {
    hull: new THREE.MeshStandardMaterial({ map: loadBakedTexture('ships/player/hull'), roughness: 0.7, metalness: 0.1 }),
    trim: new THREE.MeshStandardMaterial({ color: '#cfd6dd', roughness: 0.6, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: '#1c2733', roughness: 0.15, metalness: 0.9 }),
  };
}

function pirateMats(): { hull: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial } {
  return {
    hull: new THREE.MeshStandardMaterial({ map: loadBakedTexture('ships/pirate/hull'), roughness: 0.8, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: '#33373d', roughness: 0.6, metalness: 0.3 }),
  };
}

/** Player fighter: dart fuselage, swept wings, twin engines. 6 meshes. */
export function createPlayerShip(): THREE.Group {
  const { hull, trim, glass } = playerMats();
  const ship = new THREE.Group();

  // Merged hull: body + swept wings + tail fin (baked hull texture).
  const hullGeo = merged([
    bake(new THREE.CylinderGeometry(0.55, 1.0, 4.4, 6), { r: [Math.PI / 2, 0, 0] }),
    bake(new THREE.BoxGeometry(3.4, 0.14, 1.7), { p: [-1.9, -0.1, 0.9], r: [0, 0.35, 0] }),
    bake(new THREE.BoxGeometry(3.4, 0.14, 1.7), { p: [1.9, -0.1, 0.9], r: [0, -0.35, 0] }),
    bake(new THREE.BoxGeometry(0.14, 1.3, 1.4), { p: [0, 0.8, 1.6] }),
  ]);
  ship.add(new THREE.Mesh(hullGeo, hull));

  // Merged trim: nose cone + wing tips + engine nacelles.
  const trimGeo = merged([
    bake(new THREE.ConeGeometry(0.55, 1.8, 6), { p: [0, 0, -3.1], r: [-Math.PI / 2, 0, 0] }),
    bake(new THREE.BoxGeometry(0.5, 0.5, 1.2), { p: [-3.4, 0.05, 1.5] }),
    bake(new THREE.BoxGeometry(0.5, 0.5, 1.2), { p: [3.4, 0.05, 1.5] }),
    bake(new THREE.CylinderGeometry(0.34, 0.4, 1.6, 8), { p: [-0.85, -0.15, 1.9], r: [Math.PI / 2, 0, 0] }),
    bake(new THREE.CylinderGeometry(0.34, 0.4, 1.6, 8), { p: [0.85, -0.15, 1.9], r: [Math.PI / 2, 0, 0] }),
  ]);
  ship.add(new THREE.Mesh(trimGeo, trim));

  // Glass canopy.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), glass);
  canopy.scale.set(0.8, 0.55, 1.4);
  canopy.position.set(0, 0.62, -0.9);
  ship.add(canopy);

  // Merged emissive engine glow discs.
  const glowGeo = merged([
    bake(new THREE.CircleGeometry(0.3, 12), { p: [-0.85, -0.15, 2.72] }),
    bake(new THREE.CircleGeometry(0.3, 12), { p: [0.85, -0.15, 2.72] }),
  ]);
  const glowMat = new THREE.MeshStandardMaterial({
    color: '#1a0d05', emissive: '#ff7a2a', emissiveIntensity: 3.2, roughness: 0.4, metalness: 0.0,
  });
  ship.add(new THREE.Mesh(glowGeo, glowMat));

  // Emissive cyan trim stripe along the hull spine.
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.05, 3.4),
    new THREE.MeshStandardMaterial({
      color: '#062a33', emissive: '#35e0ff', emissiveIntensity: 1.6, roughness: 0.4, metalness: 0.2,
    }),
  );
  stripe.position.set(0, 0.94, -0.5);
  ship.add(stripe);

  // Nav lights: port red / starboard green, merged via vertex colors.
  const navGeo = merged([
    coloredSphere(-3.55, 0.1, 1.35, '#ff2a2a'),
    coloredSphere(3.55, 0.1, 1.35, '#2aff66'),
  ]);
  ship.add(new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ vertexColors: true })));

  // Local thruster positions for the coordinator's trail FX.
  ship.userData.engineTips = [
    new THREE.Vector3(-0.85, -0.15, 2.9),
    new THREE.Vector3(0.85, -0.15, 2.9),
  ];

  return ship;
}

const PIRATE_GLOW: Record<PirateVariant, string> = {
  scout: '#35e0ff', // cyan
  raider: '#ff7a2a', // orange
  bruiser: '#ff2a2a', // red
};

/** Pirate ship: rust-hulled frame, scaled per variant. 3 merged meshes.
 *
 * Variants are visually distinct:
 * - scout: slim elongated hull (x 0.7), long spike nose, cyan glow
 * - raider: standard frame, orange glow
 * - bruiser: wide hull, extra armor plates + shoulder pods, twin red glows
 */
export function createPirateShip(variant: PirateVariant): THREE.Group {
  const { hull, dark } = pirateMats();
  const ship = new THREE.Group();

  const scale = variant === 'scout' ? 0.8 : variant === 'bruiser' ? 1.5 : 1.0;

  const hullParts: THREE.BufferGeometry[] = [];
  const darkParts: THREE.BufferGeometry[] = [];
  const glowParts: THREE.BufferGeometry[] = [];

  if (variant === 'scout') {
    // Slim elongated body, narrow blades, long spike nose.
    hullParts.push(bake(new THREE.BoxGeometry(1.6, 1.1, 3.6), { s: [0.7, 1, 1.15] }));
    for (const s of [-1, 1]) {
      hullParts.push(bake(new THREE.BoxGeometry(2.6, 0.16, 1.1), {
        p: [s * 1.2, 0, -0.6], r: [0, s * 0.5, 0], s: [0.7, 1, 1],
      }));
    }
    darkParts.push(bake(new THREE.ConeGeometry(0.55, 3.0, 4), {
      p: [0, 0, -3.55], r: [-Math.PI / 2, Math.PI / 4, 0],
    }));
    darkParts.push(bake(new THREE.BoxGeometry(0.5, 0.9, 3.0), { p: [0, 0.85, 0.4], s: [0.7, 1, 1.15] }));
    glowParts.push(bake(new THREE.CircleGeometry(0.42, 10), { p: [0, 0, 2.08] }));
  } else {
    hullParts.push(bake(new THREE.BoxGeometry(1.6, 1.1, 3.6), {
      s: variant === 'bruiser' ? [1.25, 1.1, 1] : [1, 1, 1],
    }));
    for (const s of [-1, 1]) {
      hullParts.push(bake(new THREE.BoxGeometry(2.6, 0.16, 1.1), {
        p: [s * 1.7, 0, -0.6], r: [0, s * 0.5, 0],
      }));
    }
    darkParts.push(bake(new THREE.ConeGeometry(0.8, 1.6, 4), {
      p: [0, 0, -2.6], r: [-Math.PI / 2, Math.PI / 4, 0],
    }));
    darkParts.push(bake(new THREE.BoxGeometry(0.5, 0.9, 3.0), { p: [0, 0.85, 0.4] }));

    if (variant === 'bruiser') {
      // Heavy armor: side plates (dark) + shoulder pods (hull).
      for (const s of [-1, 1]) {
        darkParts.push(bake(new THREE.BoxGeometry(0.4, 1.6, 2.2), { p: [s * 1.2, 0, 0.6] }));
        hullParts.push(bake(new THREE.BoxGeometry(1.0, 0.9, 1.5), { p: [s * 1.45, 0.85, 0.3] }));
      }
      // Twin engine glows.
      for (const s of [-1, 1]) {
        glowParts.push(bake(new THREE.CircleGeometry(0.42, 10), { p: [s * 0.55, 0, 1.82] }));
      }
    } else {
      glowParts.push(bake(new THREE.CircleGeometry(0.5, 10), { p: [0, 0, 1.82] }));
    }
  }

  ship.add(new THREE.Mesh(merged(hullParts), hull));
  ship.add(new THREE.Mesh(merged(darkParts), dark));
  const glowMat = new THREE.MeshStandardMaterial({
    color: '#140b06', emissive: PIRATE_GLOW[variant], emissiveIntensity: 2.6, roughness: 0.4, metalness: 0.0,
  });
  ship.add(new THREE.Mesh(merged(glowParts), glowMat));

  ship.scale.setScalar(scale);
  // Approx rear-center thruster position (world-ish, includes variant scale).
  ship.userData.engineTip = new THREE.Vector3(0, 0, 2.1 * scale);
  return ship;
}
