/**
 * Parity vector recorder core for the ts-babylon backend (Wave 3, child C).
 *
 * Records backend-local outcome vectors from the Babylon arena demo into
 * backends/ts-babylon/vectors/{move,combat}.json, driven by the
 * backend-agnostic scripts in backends/rs-core/parity/scripts/*.json
 * (the SAME files the Rust CLI consumes via --input).
 *
 * Technique (ported from the ts-three recorder):
 *  1. gotoApp + waitForKeel, then immediately `window.__keel.loop.stop()` —
 *     the rAF loop dies before the game starts, so ZERO live ticks run and
 *     only manual `loop.step()` calls advance the sim. No races.
 *  2. Click start-button (real user gesture), wait 400 ms so the UI-click
 *     input suppression (player.suppressUntil = now+300) expires.
 *  3. Click the canvas — the Player's canvas `click` listener requests
 *     pointer lock; firing is gated on `document.pointerLockElement`, so the
 *     recorder reads whether lock engaged. If it did NOT, the script's `fire`
 *     events are skipped and the vector is flagged `pointer_locked: false`
 *     (movement-only vector).
 *  4. Per 10-tick block, ONE page.evaluate applies the block's due input
 *     events (trusted synthetic key events drive the real input system —
 *     KeyW/KeyS/KeyA/KeyD/Space/ShiftLeft map to the demo's action bindings;
 *     fire drives mousedown/up on window), steps the sim tick-by-tick via
 *     `window.__keel.loop.step()`, then snapshots via the `__keel.world`
 *     debug surface (player Transform/Health, enemies Transform/Health/AI,
 *     pickup taken flags). Batching keeps CDP round-trips at ~1 per 10 ticks
 *     so the 900-tick combat script finishes comfortably in headless CI.
 *     Event delivery stays synchronous with the steps inside the evaluate:
 *     no CDP input-pipeline race can shift a key/mouse event by a tick
 *     between runs.
 *  5. Derive the event log by diffing snapshots (kill = enemy hp>0->0,
 *     pickup = taken false->true, damage = player hp drop, death =
 *     player hp>0->0). Respawn takes 360 ticks so 10-tick snapshots cannot
 *     miss kills.
 *  6. Determinism is proven by running each script TWICE (fresh page each):
 *     the vectors must be JSON-identical (parity-record.spec.ts).
 *
 * Babylon-specific notes:
 *  - `window.__keel.renderer` is the BABYLON.Engine (not a three renderer).
 *  - Debug-surface values are in SIM space (right-handed); the render layer
 *    converts (x,y,z)->(x,y,-z), so snapshot code is backend-agnostic.
 *  - The pointer-lock acquisition mousemove quirk (ADR-0009) is suppressed
 *    with a capture-phase `stopImmediatePropagation()` listener, exactly
 *    like the ts-three harness; mousedown/mouseup (fire) are unaffected.
 *
 * Additive only: this module never modifies game/engine sources.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { gotoApp } from './fixtures';
import { waitForKeel } from './helpers';

// Specs run with cwd = backends/ts-babylon (see playwright.config.ts).
export const SCRIPTS_DIR = path.join(process.cwd(), '../rs-core/parity/scripts');
export const VECTORS_DIR = path.join(process.cwd(), 'vectors');

export const MASTER_SEED = 1337;
export const SNAP_EVERY = 10;
/** Fixed per-hit player damage (ENEMY_TUNING.damage in src/game/enemy.ts). */
export const HIT_DMG = 12;

interface ScriptEvent {
  tick: number;
  action: string;
  down: boolean;
}
interface Script {
  name: string;
  ticks: number;
  events: ScriptEvent[];
}

/** Script action -> Playwright key name (demo bindings in src/main.ts). */
const KEY_FOR: Record<string, string> = {
  moveFwd: 'KeyW',
  moveBack: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  pause: 'Escape',
};

export interface SnapEnemy {
  x: number;
  z: number;
  hp: number;
  state: string;
}
export interface SnapPickup {
  x: number;
  z: number;
  taken: boolean;
}
export interface Snapshot {
  tick: number;
  player: { hp: number; x: number; y: number; z: number };
  enemies: SnapEnemy[];
  pickups: SnapPickup[];
}

export interface VecEvent {
  tick: number;
  kind: string;
  detail: Record<string, unknown>;
}

export function readVectorFile(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(VECTORS_DIR, `${name}.json`), 'utf-8'));
}

export function writeVectorFile(name: string, body: string): void {
  fs.mkdirSync(VECTORS_DIR, { recursive: true });
  fs.writeFileSync(path.join(VECTORS_DIR, `${name}.json`), body + '\n');
}

export interface RunResult {
  vector: Record<string, unknown>;
  pointerLocked: boolean;
  snaps: Snapshot[];
}

type DueEvent =
  | { kind: 'mouse'; down: boolean }
  | { kind: 'key'; code: string; down: boolean };

export async function runScript(page: Page, name: string): Promise<RunResult> {
  const script: Script = JSON.parse(
    fs.readFileSync(path.join(SCRIPTS_DIR, `${name}.json`), 'utf-8'),
  );
  const totalTicks: number = script.ticks;
  const dueByTick: Record<number, DueEvent[]> = {};
  // pointerLocked is unknown until after the canvas click; fire events are
  // filtered here optimistically and re-filtered in-page once known.
  for (const e of script.events) {
    let due: DueEvent;
    if (e.action === 'fire') {
      due = { kind: 'mouse', down: e.down };
    } else {
      const code = KEY_FOR[e.action];
      if (!code) throw new Error(`no key mapping for action ${e.action}`);
      due = { kind: 'key', code, down: e.down };
    }
    (dueByTick[e.tick] ??= []).push(due);
  }

  await gotoApp(page);
  await waitForKeel(page);

  // Freeze the sim before the game even starts: zero live playing ticks.
  await page.evaluate(() => window.__keel.loop.stop());

  // Suppress ALL mousemove delivery to the game for the recording. Rationale:
  // when pointer lock engages, Chromium dispatches a mousemove whose
  // movementX/Y is the warp delta from the pre-lock cursor position to the
  // lock origin. The game's document-level mousemove handler feeds that
  // straight into addLook(), swinging the camera yaw before tick 0. That
  // warp is a browser quirk, not user input (ADR-0009 keeps it in the game
  // by design); the recording must be keyboard/mouse-button only with yaw
  // pinned at its reset value (PI). mousedown/mouseup (fire) are unaffected.
  await page.evaluate(() => {
    window.addEventListener(
      'mousemove',
      (e) => {
        e.stopImmediatePropagation();
      },
      true,
    );
  });

  await page.getByTestId('start-button').click();
  // Let the UI-click input suppression (suppressUntil = now+300ms) expire.
  await page.waitForTimeout(400);

  // Pointer lock gates firing (player.ts canFire). Request it WITHOUT moving
  // the mouse: page.mouse.click would generate mousemove events that, if
  // processed after lock engages, swing the camera yaw via movementX/Y and
  // make runs diverge. The synthetic click rides the transient activation
  // from the real start-button click above, and the canvas 'click' listener
  // requests the lock. No mousemove is ever generated after this point.
  await page.evaluate(() => {
    (document.querySelector('canvas') as HTMLElement).click();
  });
  await page.waitForTimeout(250);
  const pointerLocked = await page.evaluate(
    () => !!document.pointerLockElement,
  );

  // --- batched recording: one evaluate per SNAP_EVERY ticks ---
  const snaps: Snapshot[] = [];
  for (let blockStart = 0; blockStart < totalTicks; blockStart += SNAP_EVERY) {
    const blockEnd = Math.min(blockStart + SNAP_EVERY, totalTicks);
    const snap: Snapshot = await page.evaluate(
      ([start, end, due, allowFire]: [number, number, Record<number, DueEvent[]>, boolean]) => {
        const k = window.__keel;
        for (let tick = start; tick < end; tick++) {
          for (const e of due[tick] ?? []) {
            if (e.kind === 'mouse') {
              if (!allowFire) continue; // movement-only fallback vector
              window.dispatchEvent(
                new MouseEvent(e.down ? 'mousedown' : 'mouseup', { button: 0 }),
              );
            } else {
              window.dispatchEvent(
                new KeyboardEvent(e.down ? 'keydown' : 'keyup', { code: e.code }),
              );
            }
          }
          k.loop.step();
        }
        // Snapshot via the debug surface (sim space).
        const pt = k.world.get<{ x: number; y: number; z: number }>(k.playerId, 'Transform');
        const ph = k.world.get<{ hp: number; current: number }>(k.playerId, 'Health');
        if (!pt || !ph) throw new Error('player entity missing Transform/Health');
        const enemies: SnapEnemy[] = [];
        for (const id of k.world.query('Enemy', 'Transform', 'Health', 'AI')) {
          const tr = k.world.get<{ x: number; z: number }>(id, 'Transform');
          const h = k.world.get<{ hp: number; current: number }>(id, 'Health');
          const ai = k.world.get<{ state: string }>(id, 'AI');
          if (!tr || !h || !ai) throw new Error(`enemy ${id} missing components`);
          enemies.push({ x: tr.x, z: tr.z, hp: h.current ?? h.hp, state: ai.state });
        }
        const pickups: SnapPickup[] = [];
        for (const id of k.world.query('Pickup', 'Transform')) {
          const tr = k.world.get<{ x: number; z: number }>(id, 'Transform');
          const p = k.world.get<{ taken: boolean }>(id, 'Pickup');
          if (!tr || !p) throw new Error(`pickup ${id} missing components`);
          pickups.push({ x: tr.x, z: tr.z, taken: !!p.taken });
        }
        return {
          tick: end,
          player: { hp: ph.current ?? ph.hp, x: pt.x, y: pt.y, z: pt.z },
          enemies,
          pickups,
        } as Snapshot;
      },
      [blockStart, blockEnd, dueByTick, pointerLocked] as [number, number, Record<number, DueEvent[]>, boolean],
    );
    snaps.push(snap);
  }
  // Any still-held inputs are dropped by the fresh navigation the next
  // runScript() starts with (gotoApp reloads the page).

  // --- derive the event log by diffing snapshots ---
  const events: VecEvent[] = [];
  let kills = 0;
  let pickupsTaken = 0;
  let prev: Snapshot | null = null;
  for (const s of snaps) {
    if (prev) {
      for (let i = 0; i < s.enemies.length; i++) {
        const a = prev.enemies[i];
        const b = s.enemies[i];
        if (a && b && a.hp > 0 && b.hp <= 0) {
          kills++;
          events.push({
            tick: s.tick,
            kind: 'kill',
            detail: { enemy: i, x: b.x, z: b.z },
          });
        }
      }
      for (let i = 0; i < s.pickups.length; i++) {
        const a = prev.pickups[i];
        const b = s.pickups[i];
        if (a && b && !a.taken && b.taken) {
          pickupsTaken++;
          events.push({
            tick: s.tick,
            kind: 'pickup',
            detail: { pickup: i, x: b.x, z: b.z },
          });
        }
      }
      if (s.player.hp < prev.player.hp) {
        // The sim deals damage in fixed HIT_DMG hits; a 10-tick snapshot
        // window can contain several hits, which the naive diff would
        // coalesce into one event with an inflated dmg. Split the observed
        // drop into individual HIT_DMG hit events. The final hit may overkill
        // (drop < HIT_DMG when hp clamps at 0); ceil() counts it as a hit.
        const drop = prev.player.hp - s.player.hp;
        const hits = Math.max(1, Math.ceil(drop / HIT_DMG));
        for (let i = 0; i < hits; i++) {
          events.push({
            tick: s.tick,
            kind: 'damage',
            detail: {
              dmg: HIT_DMG,
              hp: Math.max(0, prev.player.hp - HIT_DMG * (i + 1)),
            },
          });
        }
        if (prev.player.hp > 0 && s.player.hp <= 0) {
          events.push({
            tick: s.tick,
            kind: 'death',
            detail: { hp: s.player.hp },
          });
        }
      }
    }
    prev = s;
  }

  const last = snaps[snaps.length - 1];
  const vector = {
    seed: MASTER_SEED,
    ticks: totalTicks,
    score: kills * 100, // score is not on the debug surface; the demo adds exactly 100/kill
    player: {
      hp: last.player.hp,
      x: last.player.x,
      y: last.player.y,
      z: last.player.z,
    },
    enemies: last.enemies.map((e) => ({
      x: e.x,
      z: e.z,
      hp: e.hp,
      state: e.state,
    })),
    kills,
    pickups_taken: pickupsTaken,
    projectiles_active: null, // not observable via the debug surface
    pointer_locked: pointerLocked,
    events,
  };
  return { vector, pointerLocked, snaps };
}
