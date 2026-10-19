/** STARFALL: Drift Arena — integrated game boot (sim + meta).
 *
 * Composition root over the engine in src/engine/:
 * - sim core (4d-sim): arcade 6DOF-ish flight, pirate FSM, projectiles,
 *   asteroid mining, station entity. Bootstrapped via
 *   `keel new games/starfall-drift-arena --backend ts-three`.
 * - meta layer (4d-meta): economy, quests, save/load, HUD, screens, station
 *   UI + mesh. Integrated per games/starfall-drift-arena/INTEGRATION.md.
 *
 * The sim's GameAPI object keeps its identity (sim systems call ctx.api);
 * the meta modules replace its economy/quest interiors in place.
 * Debug hook for e2e: window.__keel = { world, loop, input, renderer,
 * playerId, game }.
 */

import * as THREE from 'three';
import { createWorld, type World, C, type TransformC } from './engine/ecs';
import { createLoop, type Loop } from './engine/loop';
import { createInput, type InputSys } from './engine/input';
import { createSave, type SaveSys } from './engine/save';
import {
  createGameState, type GameAPI, type SimCtx,
} from './game/api';
import { createFlightSystem, spawnPlayerShip, clampLookDelta } from './game/flight';
import { createPirateSystem, spawnPirateWave } from './game/pirates';
import { createProjectileSystem } from './game/projectiles';
import {
  createAsteroidField, createAsteroidSystem, createStationEntity, syncMiningBeam,
} from './game/asteroids';
import { createEconomy, type Economy } from './game/economy';
import { generateQuests, createQuestState, type QuestState } from './game/quests';
import { saveGame, loadGame, SAVE_NAMESPACE, SAVE_SLOT, type DriftArenaSave } from './game/savegame';
import { createHUD, type HUD } from './game/hud';
import { createScreens, type Screens } from './game/screens';
import { createStationUI, type StationUI } from './game/station';
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

/** Pinned run seed — quest flavor text only; pinned numbers unaffected. */
const SEED = 20261019;

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

  // ---- wave-4d-meta: meta state. economy/questState become the single
  // source of truth; state.hull / state.docked stay the sim's (shared). ----
  const saveSys: SaveSys = createSave(SAVE_NAMESPACE);
  let economy: Economy = createEconomy();
  let questState: QuestState = createQuestState(generateQuests(SEED));
  let dead = false;
  let currentTick = 0;
  let started = false;

  // Forward declarations: assigned below; closures run after assignment.
  let hud!: HUD;
  let stationUI!: StationUI;
  let screens!: Screens;

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

  // ---- wave-4d-meta: rewire the GameAPI interiors in place ----
  // Same object identity — the sim's systems keep calling ctx.api.
  function claimCompleted(completed: string[]): void {
    for (const id of completed) economy.addCredits(questState.claimReward(id));
  }
  api.getCredits = () => economy.credits;
  api.addCredits = (n) => economy.addCredits(n);
  api.getOre = () => economy.ore;
  // NOTE (resolves sim Q2 + meta Q2): no quest coupling in addOre. The sim
  // calls addQuestProgress('mine', 1) explicitly at the mining site;
  // coupling here would double-count, and ore pickups salvaged from pirate
  // wrecks are not mining and must not advance the mine quest.
  api.addOre = (n) => economy.addOre(n);
  api.spendOre = (n) => economy.spendOre(n);
  api.getHull = () => state.hull;
  api.getMaxHull = () => economy.maxHull();
  api.damagePlayer = (n) => {
    if (dead) return;
    state.hull = Math.max(0, state.hull - n);
    hud.flashDamage();
    if (state.hull <= 0) onPlayerDeath();
  };
  api.getUpgrades = () => ({ ...economy.upgrades });
  api.buyUpgrade = (kind) => {
    const ok = economy.buyUpgrade(kind);
    // A shield upgrade also repairs the +25 max-hull it adds.
    if (ok && kind === 'shield') state.hull = Math.min(state.hull + 25, economy.maxHull());
    return ok;
  };
  api.sellOre = () => economy.sellOre();
  api.addQuestProgress = (kind, n) => claimCompleted(questState.addProgress(kind, n));
  api.getQuests = () => questState.toViews();
  state.hull = api.getMaxHull();

  // ---- wave-4d-meta: UI layers (game exists by now) ----
  hud = createHUD(ui, api);
  stationUI = createStationUI(ui, api);

  // Dock: the sim's hook does the proximity gate; on success pause + panel.
  const simRequestDock = state.hooks.requestDock;
  state.hooks.requestDock = () => {
    simRequestDock?.();
    if (state.docked && !dead) {
      loop.setPaused(true);
      stationUI.setDocked(true);
    }
  };
  stationUI.onUndock = () => {
    state.docked = false;
    stationUI.setDocked(false);
    loop.setPaused(false);
  };

  function quickSave(): void {
    saveGame(saveSys, SAVE_SLOT, {
      version: 1,
      credits: economy.credits,
      ore: economy.ore,
      upgrades: { ...economy.upgrades },
      questProgress: questState.progress,
      questDone: questState.done,
      playerHull: state.hull,
      tick: currentTick,
    });
    screens.setHasSave(true);
  }

  function restoreSave(s: DriftArenaSave): void {
    economy = createEconomy({ credits: s.credits, ore: s.ore, upgrades: s.upgrades });
    questState = createQuestState(generateQuests(SEED), {
      progress: s.questProgress,
      done: s.questDone,
    });
    state.hull = Math.min(s.playerHull, economy.maxHull());
    // NOTE: entity positions / pirates / asteroids are NOT restored — the
    // save covers the meta state (credits/ore/upgrades/quests/hull), which
    // is what the playthrough asserts. Full world-state save is a Wave 5
    // candidate (SPEC issue).
  }

  function onPlayerDeath(): void {
    if (dead) return;
    dead = true;
    loop.setPaused(true);
    screens.showGameOver(economy.credits);
  }

  function beginPlay(): void {
    if (started) return;
    started = true;
    dead = false;
    screens.hideTitle();
    loop.start();
    (renderer.domElement as HTMLCanvasElement).requestPointerLock?.();
  }

  screens = createScreens(ui, {
    onLaunch: () => beginPlay(),
    onContinue: () => {
      const s = loadGame(saveSys, SAVE_SLOT);
      if (s) restoreSave(s);
      beginPlay();
    },
    onResume: () => { screens.hidePause(); loop.setPaused(false); },
    // Restarting from a dead run reloads: the save survives in
    // localStorage, so Continue still works after the reload.
    onRestart: () => window.location.reload(),
    onSave: () => quickSave(),
    noteUiClick: () => undefined,
  });

  // ---- pointer-lock steering (deltas clamped per event) ----
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  });
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return;
    // CLAMP per-event deltas to ±0.25 rad: never feed a raw post-lock
    // mousemove spike into the camera.
    ctx.look.yaw -= clampLookDelta(e.movementX * 0.0022);
    ctx.look.pitch -= clampLookDelta(e.movementY * 0.0022);
  });

  // Pause toggle + quick-save (not while docked or on the title screen).
  window.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.code === 'Escape' || ev.code === 'KeyP') {
      if (state.docked || screens.titleVisible || dead) return;
      const paused = !loop.paused;
      loop.setPaused(paused);
      if (paused) screens.showPause(); else screens.hidePause();
    }
    if (ev.code === 'F5') {
      ev.preventDefault();
      if (!screens.titleVisible && !dead) quickSave();
    }
  });

  // Station ring rotation + blinking dock lights.
  const stationMesh = ctx.meshes.get(state.stationId);
  const stationAnim = stationMesh?.userData.update as
    ((dt: number, t: number) => void) | undefined;

  loop.on('preupdate', () => input.update());
  loop.on('postupdate', (c) => {
    currentTick = c.tick;
    syncMeshes(ctx);
    syncMiningBeam(ctx, mineState);
    updateChaseCamera(ctx, c.dt);
    stationAnim?.(c.dt, c.tick / 60);
    hud.update(c.dt);
  });
  loop.on('render', () => renderer.render(scene, camera));

  window.__keel = { world, loop, input, renderer, playerId: state.playerShipId, game: api };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Title first — Launch/Continue start the sim.
  screens.showTitle();
  screens.setHasSave(saveSys.list().includes(SAVE_SLOT));
}

void boot();
