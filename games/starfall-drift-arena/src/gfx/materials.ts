/** Shared materials: created once, PBR-tuned for the Drift Arena
 *  graphics wave (sun + hemisphere + IBL from gfx/environment.ts).
 *  Neutral palette — ships are worked metal, scenery stays rough,
 *  projectiles are the bloom target. */

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

function std(
  color: string,
  roughness = 0.8,
  metalness = 0.1,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

export function createMaterials(): Mats {
  return {
    // Scenery: rough, barely metallic.
    ground: std('#8b9097', 0.95, 0.1),
    wall: std('#6f747c', 0.85, 0.1),
    pillar: std('#a8adb5', 0.8, 0.1),
    propA: std('#7d838c', 0.85, 0.1),
    propB: std('#989ea7', 0.85, 0.1),
    // Ships: worked metal so the sun/rim/IBL have something to play on.
    playerBody: std('#4a6fa5', 0.45, 0.55), // steel blue
    playerTrim: std('#cfd6dd', 0.35, 0.7), // light gray, shinier
    enemyBody: std('#a14a3c', 0.55, 0.45), // muted rust
    enemyCore: std('#33373d', 0.4, 0.6), // charcoal, metallic
    // Projectiles: bright emissive white — the bloom target.
    projectile: std('#ffffff', 0.4, 0.0, { emissive: '#ffffff', emissiveIntensity: 2.6 }),
    // Pickups: soft self-glow so ore reads at range.
    pickup: std('#3fae5a', 0.6, 0.1, { emissive: '#3fae5a', emissiveIntensity: 0.7 }),
  };
}
