/** Shared materials: created once, flat colors, roughness ~0.8.
 *  Neutral placeholder palette — no emissive accents, no amber. */

import * as THREE from 'three';

export interface Mats {
  ground: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  pillar: THREE.MeshStandardMaterial;
  propA: THREE.MeshStandardMaterial;
  propB: THREE.MeshStandardMaterial;
  playerBody: THREE.MeshStandardMaterial;
  playerTrim: THREE.MeshStandardMaterial;
  enemyBody: THREE.MeshStandardMaterial;
  enemyCore: THREE.MeshStandardMaterial;
  projectile: THREE.MeshStandardMaterial;
  pickup: THREE.MeshStandardMaterial;
}

function std(color: string, roughness = 0.8, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.0, ...extra });
}

export function createMaterials(): Mats {
  return {
    ground: std('#8b9097', 0.95),
    wall: std('#6f747c', 0.85),
    pillar: std('#a8adb5', 0.8),
    propA: std('#7d838c', 0.85),
    propB: std('#989ea7', 0.85),
    playerBody: std('#4a6fa5', 0.75),   // steel blue
    playerTrim: std('#cfd6dd', 0.7),    // light gray
    enemyBody: std('#a14a3c', 0.8),     // muted rust
    enemyCore: std('#33373d', 0.6),     // charcoal
    // projectiles are plain emissive-white per the slice spec (no color glow)
    projectile: std('#ffffff', 0.4, { emissive: '#ffffff', emissiveIntensity: 1.1 }),
    pickup: std('#3fae5a', 0.6),
  };
}
