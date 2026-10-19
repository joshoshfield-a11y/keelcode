/** Shared materials: created once, flat colors.
 *  Neutral placeholder palette — no emissive accents, no amber.
 *
 *  Babylon port of the ts-three reference (gfx/materials.ts): same palette,
 *  same keys. three.js MeshStandardMaterial(roughness ~0.8, metalness 0) is
 *  approximated with Babylon StandardMaterial: diffuseColor carries the
 *  color, specularColor is kept small ((1-roughness)*0.35) for the same matte
 *  look. Babylon materials need a Scene, so createMaterials takes one —
 *  the only signature change vs the reference.
 *
 *  HSL helper: the reference varies instance tints with THREE.Color.setHSL;
 *  Babylon has no HSL factory, so hsl() below reproduces it for the
 *  per-instance color variation in arena/dressing. */

import * as BABYLON from '@babylonjs/core';

export interface Mats {
  ground: BABYLON.StandardMaterial;
  wall: BABYLON.StandardMaterial;
  pillar: BABYLON.StandardMaterial;
  propA: BABYLON.StandardMaterial;
  propB: BABYLON.StandardMaterial;
  playerBody: BABYLON.StandardMaterial;
  playerTrim: BABYLON.StandardMaterial;
  enemyBody: BABYLON.StandardMaterial;
  enemyCore: BABYLON.StandardMaterial;
  projectile: BABYLON.StandardMaterial;
  pickup: BABYLON.StandardMaterial;
}

function std(
  scene: BABYLON.Scene,
  name: string,
  color: string,
  roughness = 0.8,
  extra: { emissive?: string } = {},
): BABYLON.StandardMaterial {
  const m = new BABYLON.StandardMaterial(name, scene);
  m.diffuseColor = BABYLON.Color3.FromHexString(color);
  // matte approximation of three.js roughness: dim the specular lobe
  const s = (1 - roughness) * 0.35;
  m.specularColor = new BABYLON.Color3(s, s, s);
  if (extra.emissive) m.emissiveColor = BABYLON.Color3.FromHexString(extra.emissive);
  return m;
}

export function createMaterials(scene: BABYLON.Scene): Mats {
  return {
    ground: std(scene, 'ground', '#8b9097', 0.95),
    wall: std(scene, 'wall', '#6f747c', 0.85),
    pillar: std(scene, 'pillar', '#a8adb5', 0.8),
    propA: std(scene, 'propA', '#7d838c', 0.85),
    propB: std(scene, 'propB', '#989ea7', 0.85),
    playerBody: std(scene, 'playerBody', '#4a6fa5', 0.75), // steel blue
    playerTrim: std(scene, 'playerTrim', '#cfd6dd', 0.7), // light gray
    enemyBody: std(scene, 'enemyBody', '#a14a3c', 0.8),   // muted rust
    enemyCore: std(scene, 'enemyCore', '#33373d', 0.6),   // charcoal
    // projectiles are plain emissive-white per the slice spec (no color glow)
    projectile: std(scene, 'projectile', '#ffffff', 0.4, { emissive: '#ffffff' }),
    pickup: std(scene, 'pickup', '#3fae5a', 0.6),
  };
}

/** THREE.Color.setHSL equivalent (h,s,l in 0..1) → Babylon Color3. */
export function hsl(h: number, s: number, l: number): BABYLON.Color3 {
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return new BABYLON.Color3(r, g, b);
}
