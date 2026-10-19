/** STARFALL: Drift Arena — full game boot (sim core).
 *
 * Arcade 6DOF-ish space sim: flight + pirates + mining + station.
 * Auto-starts on canvas click (pointer lock). The title screen arrives via
 * the meta builder's patch — this boot keeps working when it lands.
 */

import * as THREE from 'three';
import { createWorld, type World, C, type TransformC } from './engine/ecs';
import { createLoop, type Loop } from './engine/loop';
import { createInput, type InputSys } from './engine/input';
import {
  createGameState, type GameAPI, type SimCtx,
} from './game/api';
import { createFlightSystem, spawnPlayerShip, clampLookDelta } from './game/flight';
import { createPirateSystem, spawnPirateWave } from './game/pirates';
import { createProjectileSystem } from './game/projectiles';
import {
  createAsteroidField, createAsteroidSystem, createStationEntity, syncMiningBeam,
} from './game/asteroids';
import { createStarfield } from './gfx/starfield';

declare global {
  interface Window {
    __keel: {
      world: World; loop: Loop; input: InputSys;
      renderer: THREE.WebGLRenderer; playerId: number; game: GameAPI;
    };
  }
}

const _camDesired = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _shipFwd = new THREE.Vector3();

function defineActions(input: InputSys): void {
  input.defineAction('thrustFwd', [{ type: 'key', code: 'KeyW' }]);
  input.defineAction('thrustBack', [{ type: 'key', code: 'KeyS' }]);
  input.defineAction('strafeLeft', [{ type: 'key', code: 'KeyA' }]);
  input.defineAction('strafeRight', [{ type: 'key', code: 'KeyD' }]);
  input.defineAxis('thrust', 'thrustBack', 'thrustFwd');
  input.defineAxis('strafe', 'strafeLeft', 'strafeRight');
  input.defineAction('boost', [
    { type: 'key', code: 'ShiftLeft' }, { type: 'key', code: 'ShiftRight' },
  ]);
  input.defineAction('fire', [{ type: 'mouse', button: 0 }]);
  input.defineAction('mine', [{ type: 'key', code: 'KeyE' }]);
  input.defineAction('dock', [{ type: 'key', code: 'KeyF' }]);
}

function syncMeshes(ctx: SimCtx): void {
  for (const [id, obj] of ctx.meshes) {
    const t = ctx.world.get<TransformC>(id, C.Transform);
    if (!t) {
      ctx.scene.remove(obj);
      ctx.meshes.delete(id);
      continue;
    }
    obj.position.set(t.x, t.y, t.z);
    obj.rotation.set(t.rx, t.ry, t.rz);
  }
}

function updateChaseCamera(ctx: SimCtx, rdt: number): void {
  const cam = ctx.camera;
  if (!cam) return;
  const t = ctx.world.get<TransformC>(ctx.state.playerShipId, C.Transform);
  if (!t) return;
  const cp = Math.cos(t.rx);
  _shipFwd.set(-cp * Math.sin(t.ry), Math.sin(t.rx), -cp * Math.cos(t.ry));
  _camDesired.set(
    t.x - _shipFwd.x * 17,
    t.y - _shipFwd.y * 17 + 5.5,
    t.z - _shipFwd.z * 17,
  );
  const k = 1 - Math.exp(-6 * Math.max(0.0001, rdt));
  cam.position.lerp(_camDesired, k);
  _camLook.set(t.x + _shipFwd.x * 26, t.y + _shipFwd.y * 26, t.z + _shipFwd.z * 26);
  cam.lookAt(_camLook);
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const ui = document.getElementById('ui')!;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  app.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070d);
  const camera = new THREE.PerspectiveCamera(
    62, window.innerWidth / window.innerHeight, 0.1, 4000,
  );
  camera.position.set(0, 6, 18);

  scene.add(new THREE.AmbientLight(0x8a93a6, 0.85));
  const sun = new THREE.DirectionalLight(0xfff2df, 1.6);
  sun.position.set(300, 400, 200);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fb6ff, 0.5);
  rim.position.set(-400, -200, -300);
  scene.add(rim);
  scene.add(createStarfield());

  const world: World = createWorld();
  const loop: Loop = createLoop();
  const input: InputSys = createInput();
  defineActions(input);
  input.attach();

  const { api, state } = createGameState();
  const ctx: SimCtx = {
    world, loop, input, api, state,
    scene, camera,
    meshes: new Map(),
    look: { yaw: 0, pitch: 0 },
  };

  // player
  state.playerShipId = spawnPlayerShip(ctx);
  state.hull = api.getMaxHull();

  // world content
  createAsteroidField(ctx, 64);
  createStationEntity(ctx);

  // systems
  createFlightSystem(ctx);
  createPirateSystem(ctx);
  createProjectileSystem(ctx);
  const mineState = createAsteroidSystem(ctx);

  state.hooks.spawnPirateWave = (n: number) => spawnPirateWave(ctx, n);
  spawnPirateWave(ctx, 3);

  // ---- pointer-lock steering (deltas clamped per event) ----
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
    hideHint();
  });
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    // CLAMP per-event deltas to ±0.25 rad: never feed a raw post-lock
    // mousemove spike into the camera.
    ctx.look.yaw -= clampLookDelta(e.movementX * 0.0022);
    ctx.look.pitch -= clampLookDelta(e.movementY * 0.0022);
  });

  // minimal "click to fly" hint (title screen arrives via the meta patch)
  const hint = document.createElement('div');
  hint.id = 'kc-fly-hint';
  hint.style.cssText =
    'position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);' +
    'color:#dfe6f2;font:16px/1.6 system-ui,sans-serif;text-align:center;' +
    'background:rgba(8,10,16,0.55);padding:18px 28px;border-radius:10px;' +
    'border:1px solid rgba(160,180,210,0.25);pointer-events:none;';
  hint.innerHTML =
    '<b>STARFALL: DRIFT ARENA</b><br>click to fly<br>' +
    '<span style="opacity:0.75">W/S thrust · A/D strafe · mouse steer · click fire · E mine · F dock</span>';
  ui.appendChild(hint);
  function hideHint(): void {
    hint.style.display = 'none';
  }

  loop.on('preupdate', () => input.update());
  loop.on('postupdate', (c) => {
    syncMeshes(ctx);
    syncMiningBeam(ctx, mineState);
    updateChaseCamera(ctx, c.dt);
  });
  loop.on('render', () => renderer.render(scene, camera));

  window.__keel = { world, loop, input, renderer, playerId: state.playerShipId, game: api };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  loop.start();
}

void boot();
