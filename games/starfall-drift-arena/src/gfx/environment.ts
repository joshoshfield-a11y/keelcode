/** Scene environment for Drift Arena: light rig, fog, image-based lighting.
 *
 * Neutral palette, no voxel accents. Headless-safe: the PMREM step is
 * wrapped in try/catch so node unit tests (no WebGL context) can import
 * and call this module without a real renderer.
 *
 * Does NOT touch toneMapping — main.ts owns the renderer's tone mapping.
 */

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { QualityTier } from './quality';

export function setupEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  tier: QualityTier,
): { sun: THREE.DirectionalLight } {
  // Hemisphere: cool sky fill over a dark ground bounce.
  const hemi = new THREE.HemisphereLight(0xb8c8e8, 0x1a1410, 0.55);
  scene.add(hemi);

  // Key light: warm sun.
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
  sun.position.set(300, 400, 200);
  if (tier === 'desktop') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -160;
    cam.right = 160;
    cam.top = 160;
    cam.bottom = -160;
    cam.near = 10;
    cam.far = 1500;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.5;
  }
  scene.add(sun);

  // Rim: cool back-light so silhouettes read against the dark sky.
  const rim = new THREE.DirectionalLight(0x8fb0ff, 0.55);
  rim.position.set(-400, -150, -300);
  scene.add(rim);

  // Deep-space fog: barely there at gameplay range, softens distant rocks.
  scene.fog = new THREE.FogExp2(0x070a14, 0.00030);

  // Image-based lighting from a neutral room, kept subtle so the scene
  // stays dark-space: the sun remains the dominant light.
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.4;
    pmrem.dispose();
  } catch {
    // Headless (unit tests) or no-GL: IBL stays off, light rig still works.
  }

  return { sun };
}
