/** STARFALL: Drift Arena — scaffold stub.
 *
 * Bootstrapped via `keel new games/starfall-drift-arena --backend ts-three`.
 * Minimal boot (renderer + starfield + __keel hook) so `keel build` passes.
 * The sim builder (brief 4d-sim) replaces this file with the full game boot.
 */

import * as THREE from 'three';
import { createWorld, type World } from './engine/ecs';
import { createLoop, type Loop } from './engine/loop';
import { createInput, type InputSys } from './engine/input';

declare global {
  interface Window {
    __keel: { world: World; loop: Loop; input: InputSys; renderer: THREE.WebGLRenderer; playerId: number };
  }
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 0, 40);

  // placeholder starfield until the gfx builder lands the real one
  const n = 900;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 1600;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 1600;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 1600;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xbfd0ff, size: 1.6, sizeAttenuation: false })));

  const world: World = createWorld();
  const loop: Loop = createLoop();
  const input: InputSys = createInput();
  input.attach();

  loop.on('preupdate', () => input.update());
  loop.on('render', () => renderer.render(scene, camera));

  window.__keel = { world, loop, input, renderer, playerId: -1 };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  loop.start();
}

void boot();
