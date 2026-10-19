/** KeelCode Wave 3 — playable arena slice (TS/Babylon.js backend).
 *
 *  Composition root over the engine in src/engine/: creates engine systems,
 *  defines input actions, builds the demo, wires loop phases:
 *    preupdate -> input.update()
 *    update    -> player, enemy AI, projectiles, pickups, physics.step(1/60)
 *    postupdate-> pause key, camera, HUD, juice
 *    render    -> screenshake offset, scene.render()
 *
 *  Debug hook for e2e: window.__keel = { world, loop, input, playerId, renderer }.
 *  Havok physics boots async; world content builds once physics.ready resolves.
 *
 *  Babylon port of the ts-three reference main.ts: identical boot order,
 *  input bindings, screens flow, save/load envelope, and loop phase wiring.
 *  The fixed-60Hz accumulator (engine/loop.ts) owns the timestep — Babylon's
 *  engine never does; loop.ts keeps its own rAF and the render phase calls
 *  scene.render(). loop.stop() freezes everything; loop.step() advances one
 *  tick (preupdate + update + postupdate, no render — same as ts-three).
 */

import * as BABYLON from '@babylonjs/core';
import { createWorld, C, type World } from './engine/ecs';
import { createLoop, type FrameCtx, type Loop } from './engine/loop';
import { createInput, type InputSys, type Binding } from './engine/input';
import { createPhysics, type PhysicsSys } from './engine/physics';
import { createAudio, type AudioSys } from './engine/audio';
import { createSave, type SaveSys, type SaveData } from './engine/save';
import { createMaterials } from './gfx/materials';
import { buildArena, MASTER_SEED, type ArenaData } from './game/arena';
import { scatterDressing } from './game/dressing';
import { Player, isTouchDevice, requestPointerLock } from './game/player';
import { Enemies } from './game/enemy';
import { Projectiles } from './game/projectiles';
import { Pickups, type PickupState } from './game/pickups';
import { Juice } from './game/juice';
import { HUD } from './game/hud';
import { Screens } from './game/screens';
import { setHp, getHp, type TransformFull, type HealthFull } from './game/sim';

type Mode = 'title' | 'playing' | 'paused' | 'over';

declare global {
  interface Window {
    __keel: { world: World; loop: Loop; input: InputSys; playerId: number; renderer: BABYLON.Engine };
  }
}

const STEP = 1 / 60;
const SAVE_SLOT = 'slot0';

interface DemoSave extends SaveData {
  score: number;
}

const _shake = new BABYLON.Vector3();

const K = (code: string): Binding => ({ type: 'key', code });
const T = (id: string): Binding => ({ type: 'touch', id });
const M = (button: number): Binding => ({ type: 'mouse', button });

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const ui = document.getElementById('ui')!;
  const isMobile = isTouchDevice();

  // ---- renderer ----
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
  app.appendChild(canvas);
  const engine = new BABYLON.Engine(canvas, !isMobile || window.devicePixelRatio > 1.5, {
    stencil: false,
    powerPreference: 'high-performance',
  });
  // DPR caps from tools/perf-harness/budgets.json (desktop 2.0, mobile 1.5)
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2.0));

  const scene = new BABYLON.Scene(engine);
  // match the Wave 1 ACES tone-mapped look
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  const camera = new BABYLON.UniversalCamera('cam', new BABYLON.Vector3(0, 2, 0), scene);
  camera.minZ = 0.1;
  camera.maxZ = 220;
  camera.fov = 60 * Math.PI / 180;
  // NOTE: no attachControl — the game drives the camera manually (player.ts).

  // ---- engine systems ----
  const world: World = createWorld();
  const loop: Loop = createLoop();
  const input: InputSys = createInput();
  const physics: PhysicsSys = createPhysics();
  const audio: AudioSys = createAudio();
  const saveSys: SaveSys = createSave('keelcode');

  // ---- input actions ----
  input.defineAction('moveFwd', [K('KeyW'), K('ArrowUp'), T('joy-up')]);
  input.defineAction('moveBack', [K('KeyS'), K('ArrowDown'), T('joy-down')]);
  input.defineAction('moveLeft', [K('KeyA'), K('ArrowLeft'), T('joy-left')]);
  input.defineAction('moveRight', [K('KeyD'), K('ArrowRight'), T('joy-right')]);
  input.defineAxis('moveX', 'moveLeft', 'moveRight');
  input.defineAxis('moveY', 'moveBack', 'moveFwd');
  input.defineAction('jump', [K('Space'), T('jump')]);
  input.defineAction('sprint', [K('ShiftLeft'), K('ShiftRight')]);
  input.defineAction('fire', [M(0), T('fire')]);
  input.defineAction('pause', [K('Escape'), K('KeyP')]);
  input.attach();

  let mode: Mode = 'title';
  let score = 0;
  let pauseLatch = false;
  // Set when pauseGame() exits pointer lock itself; the async pointerlockchange
  // for our own exit must not trigger the unexpected-loss auto-pause.
  let suppressLockExitPause = false;

  // filled after physics.ready
  let player!: Player;
  let enemies!: Enemies;
  let projectiles!: Projectiles;
  let pickups!: Pickups;
  let juice!: Juice;
  let hud!: HUD;
  let arena!: ArenaData;
  let touchDiv: HTMLElement | null = null;

  const noteUiClick = (): void => {
    if (player) player.suppressUntil = performance.now() + 300;
  };

  // ---- HUD + screens (before physics so the title shows instantly) ----
  hud = new HUD(ui, audio, () => doSave(), noteUiClick, MASTER_SEED);
  const screens = new Screens(ui, {
    onStart: () => startGame(),
    onResume: () => resumeGame(),
    onRestart: () => restartGame(),
    onSave: () => doSave(),
    noteUiClick,
  });
  screens.showTitle();

  // ---- touch controls ----
  if (isMobile) {
    touchDiv = document.createElement('div');
    touchDiv.style.cssText = 'position:absolute;inset:0;z-index:15;pointer-events:auto;display:none;';
    ui.appendChild(touchDiv);
    input.enableTouchControls(touchDiv);
  }

  function startGame(): void {
    audio.resume();
    audio.play('ui');
    screens.hideTitle();
    mode = 'playing';
    noteUiClick();
    if (touchDiv) touchDiv.style.display = 'block';
  }

  function pauseGame(): void {
    if (mode !== 'playing') return;
    mode = 'paused';
    loop.setPaused(true);
    screens.showPause();
    // The exitPointerLock() below fires a pointerlockchange asynchronously;
    // if the user resumes before it arrives, the handler must not mistake
    // our own exit for an unexpected lock loss (it would re-pause the game).
    if (document.pointerLockElement) {
      suppressLockExitPause = true;
      document.exitPointerLock();
    }
    if (touchDiv) touchDiv.style.display = 'none';
  }

  function resumeGame(): void {
    if (mode !== 'paused') return;
    audio.play('ui');
    mode = 'playing';
    loop.setPaused(false);
    screens.hidePause();
    if (!isMobile) requestPointerLock(canvas);
    if (touchDiv) touchDiv.style.display = 'block';
  }

  function restartGame(): void {
    audio.play('ui');
    enemies.clear();
    enemies.spawnInitial();
    pickups.clear();
    pickups.spawn(6, -4);
    pickups.spawn(-7, 5);
    pickups.spawn(3, 11);
    projectiles.clear();
    player.reset(0, 8);
    player.snapCamera();
    score = 0;
    hud.setScore(0);
    hud.setHealth(100, 100);
    hud.setEnemies(enemies.aliveCount());
    screens.hidePause();
    screens.hideGameOver();
    screens.hideTitle();
    loop.setPaused(false);
    mode = 'playing';
    if (touchDiv) touchDiv.style.display = 'block';
  }

  function doSave(): void {
    const components: Record<number, Record<string, unknown>> = {};
    const put = (id: number, names: string[]): void => {
      const rec: Record<string, unknown> = {};
      for (const n of names) {
        const c = world.get(id, n);
        if (c !== undefined) rec[n] = c;
      }
      components[id] = rec;
    };
    put(player.id, [C.Transform, C.Health, C.Velocity]);
    for (const id of world.query(C.Enemy)) put(id, [C.Transform, C.Health, C.AI, C.Enemy]);
    for (const id of world.query(C.Pickup)) put(id, [C.Transform, C.Pickup]);
    const data: DemoSave = {
      engine: 'keelcode',
      format_version: 1,
      seed: MASTER_SEED,
      tick: loop.tick,
      components,
      score,
    };
    try {
      saveSys.save(SAVE_SLOT, data);
    } catch {
      /* quota/private-mode: saveSys already fails safe */
    }
  }

  function doLoad(): boolean {
    const d = saveSys.load(SAVE_SLOT) as DemoSave | null;
    if (!d) return false;
    score = typeof d.score === 'number' ? d.score : 0;
    const comps = d.components;
    // player
    const p = comps[player.id]?.[C.Transform] as TransformFull | undefined;
    const ph = comps[player.id]?.[C.Health] as HealthFull | undefined;
    if (p && ph) {
      player.reset(p.x, p.z);
      const h = world.get<HealthFull>(player.id, C.Health);
      if (h) setHp(h, getHp(ph));
    }
    // enemies
    const estates: Array<{ x: number; z: number; hp: number; state: 'idle' | 'patrol' | 'chase' | 'windup' | 'strike' | 'recover'; wp: number }> = [];
    // pickups
    const pstates: PickupState[] = [];
    for (const key of Object.keys(comps)) {
      const rec = comps[Number(key)];
      if (C.Enemy in rec) {
        const t = rec[C.Transform] as TransformFull;
        const h = rec[C.Health] as HealthFull;
        const ai = rec[C.AI] as { state: 'idle' | 'patrol' | 'chase' | 'windup' | 'strike' | 'recover' };
        if (t && h) estates.push({ x: t.x, z: t.z, hp: getHp(h), state: ai?.state ?? 'patrol', wp: 0 });
      } else if (C.Pickup in rec) {
        const t = rec[C.Transform] as TransformFull;
        const pk = rec[C.Pickup] as { amount: number; taken: boolean };
        if (t && pk) pstates.push({ x: t.x, z: t.z, amount: pk.amount, taken: pk.taken });
      }
    }
    enemies.restore(estates);
    pickups.restore(pstates);
    player.snapCamera();
    hud.setScore(score);
    hud.setHealth(player.hp, 100);
    hud.setEnemies(enemies.aliveCount());
    return true;
  }

  // ---- world content (needs Havok ready for addBody) ----
  await physics.ready;

  const mats = createMaterials(scene);
  arena = buildArena(scene, physics, mats, isMobile);
  scatterDressing(scene, mats, arena.pillarSpots, arena.shadow); // single owner, called once
  juice = new Juice(scene);
  await juice.ready;

  player = new Player(world, input, physics, audio, scene, mats, camera, arena, canvas);
  player.snapCamera();

  enemies = new Enemies(world, physics, scene, mats, audio, {
    onPlayerDamage: (dmg) => {
      player.damage(dmg);
      hud.flashDamage();
      juice.shake(0.5);
    },
    onKill: (x, y, z) => {
      score += 100;
      hud.setScore(score);
      juice.burst(x, y, z, 18, 6, 0.8);
      juice.shake(0.45);
      loop.hitStop(75);
      audio.play('die');
    },
    onDrop: (x, z) => pickups.spawn(x, z),
  }, { shadow: arena.shadow, statics: arena.statics });
  enemies.spawnInitial();

  projectiles = new Projectiles(scene, world, arena, {
    onHitEnemy: (id, dmg, x, y, z) => {
      const et = world.get<TransformFull>(id, C.Transform);
      const pt = world.get<TransformFull>(player.id, C.Transform);
      let kx = 0, kz = 0;
      if (et && pt) {
        const d = Math.hypot(et.x - pt.x, et.z - pt.z) || 1;
        kx = (et.x - pt.x) / d; kz = (et.z - pt.z) / d;
      }
      enemies.damage(id, dmg, kx, kz);
      juice.burst(x, y, z, 6, 3.5, 0.45);
      juice.shake(0.12);
    },
    onHitWorld: (x, y, z) => juice.burst(x, y, z, 5, 2.5, 0.35),
  });

  pickups = new Pickups(scene, world, mats);
  pickups.spawn(6, -4);
  pickups.spawn(-7, 5);
  pickups.spawn(3, 11);

  player.onFire = (fx, fy, fz, dx, dy, dz) => {
    projectiles.fire(fx, fy, fz, dx, dy, dz, 26, 25);
    juice.shake(0.06);
  };
  player.onLand = () => juice.shake(0.08);
  player.onHurt = (hp) => {
    hud.setHealth(hp, 100);
    hud.flashDamage();
    juice.shake(0.35);
  };
  player.onDie = () => {
    if (mode !== 'playing') return; // idempotent: damage() and the reactive check below
    mode = 'over';
    loop.setPaused(true);
    juice.shake(1.0);
    if (document.pointerLockElement) document.exitPointerLock();
    if (touchDiv) touchDiv.style.display = 'none';
    screens.showGameOver(score);
  };

  // touch look: right-side drag (engine handles left stick + buttons)
  if (isMobile && touchDiv) {
    const el = touchDiv;
    let lookId = -1, lx = 0, ly = 0;
    el.addEventListener('touchstart', (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        const tgt = document.elementFromPoint(t.clientX, t.clientY);
        if (tgt && (tgt as HTMLElement).closest('[data-kc-btn]')) continue;
        if (t.clientX < window.innerWidth * 0.45 || lookId !== -1) continue;
        lookId = t.identifier; lx = t.clientX; ly = t.clientY;
      }
    }, { passive: true });
    el.addEventListener('touchmove', (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== lookId) continue;
        player.addLook((t.clientX - lx) * 2.4, (t.clientY - ly) * 2.4);
        lx = t.clientX; ly = t.clientY;
        e.preventDefault();
      }
    }, { passive: false });
    const endLook = (e: TouchEvent): void => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === lookId) lookId = -1;
      }
    };
    el.addEventListener('touchend', endLook);
    el.addEventListener('touchcancel', endLook);
  }

  // ---- loop wiring ----
  loop.on('preupdate', () => {
    input.update();
  });

  loop.on('update', (ctx: FrameCtx) => {
    if (mode !== 'playing') return;
    player.update(ctx.dt);
    const pt = world.get<TransformFull>(player.id, C.Transform);
    if (pt) {
      enemies.update(ctx.dt, pt.x, pt.z, player.alive);
      projectiles.update(ctx.dt);
      pickups.update(ctx.dt, pt.x, pt.z, (amount, x, z) => {
        player.heal(amount);
        hud.setHealth(player.hp, 100);
        audio.play('pickup');
        juice.burst(x, 1, z, 8, 2.5, 0.5);
      });
    }
    physics.step(STEP);
  });

  loop.on('postupdate', (ctx: FrameCtx) => {
    const p = input.pressed('pause');
    if (p && !pauseLatch && (mode === 'playing' || mode === 'paused')) {
      pauseLatch = true;
      if (mode === 'playing') pauseGame(); else resumeGame();
    } else if (!p) {
      pauseLatch = false;
    }
    if (mode === 'title') return;
    // reactive death: Health may be zeroed through the debug surface (e2e)
    if (mode === 'playing' && !player.alive) player.onDie();
    player.updateCamera(ctx.dt);
    hud.setHealth(player.hp, 100);
    hud.setEnemies(enemies.aliveCount());
    hud.update(ctx.dt);
    juice.update(ctx.dt);
  });

  loop.on('render', () => {
    juice.shakeOffset(_shake);
    camera.position.addInPlace(_shake);
    scene.render();
    camera.position.subtractInPlace(_shake);
  });

  // pointer-lock exit pauses (desktop) — but not for our own exitPointerLock()
  // from pauseGame(), which arrives asynchronously and may land after a resume.
  document.addEventListener('pointerlockchange', () => {
    if (suppressLockExitPause) {
      suppressLockExitPause = false;
      return;
    }
    if (!document.pointerLockElement && mode === 'playing' && !isMobile) pauseGame();
  });

  // ---- resize ----
  window.addEventListener('resize', () => {
    engine.resize();
  });

  // ---- context loss ----
  engine.onContextLostObservable.add(() => {
    loop.stop();
    const msg = document.createElement('div');
    msg.className = 'kscreen';
    msg.innerHTML = '<div class="kcard"><h1 style="font-size:24px">Graphics context lost</h1>' +
      '<p class="sub">click anywhere to reload</p></div>';
    msg.addEventListener('click', () => window.location.reload());
    ui.appendChild(msg);
  });
  engine.onContextRestoredObservable.add(() => window.location.reload());

  // ---- debug hook for e2e ----
  window.__keel = { world, loop, input, playerId: player.id, renderer: engine };

  // offer Continue when a save exists
  if (saveSys.list().includes(SAVE_SLOT)) {
    screens.addContinueButton(() => {
      noteUiClick();
      if (doLoad()) {
        audio.resume();
        audio.play('ui');
        screens.hideTitle();
        mode = 'playing';
        if (touchDiv) touchDiv.style.display = 'block';
      }
    });
  }

  loop.start();
}

void boot();
