/**
 * Parity vector recorder (Wave 2a, workstream D).
 *
 * Records reference outcome vectors from the TS arena demo so the Rust
 * headless sim can prove behavioral parity. Vectors land in
 * backends/rs-core/parity/vectors/{move,combat}.json, driven by the scripts
 * in backends/rs-core/parity/scripts/*.json (the SAME files the Rust CLI
 * consumes via --input).
 *
 * Technique:
 *  1. gotoApp + waitForKeel, then immediately `window.__keel.loop.stop()` —
 *     the rAF loop dies before the game starts, so ZERO live ticks run and
 *     only manual `loop.step()` calls advance the sim. No races.
 *  2. Click start-button (real user gesture), wait 400 ms so the UI-click
 *     input suppression (player.suppressUntil = now+300) expires.
 *  3. Click the canvas — the Player's canvas `click` listener requests
 *     pointer lock; firing is gated on `document.pointerLockElement` (or
 *     touch), so the spec records whether lock engaged. If it did NOT, the
 *     script's `fire` events are skipped and the vector is flagged
 *     `pointerLocked: false` (movement-only vector; projectile-vs-enemy
 *     parity is then covered by unit tests, see the report note).
 *  4. Per tick: apply the script's due events (trusted key events drive the
 *     real input system — KeyW/KeyS/KeyA/KeyD/Space/ShiftLeft map to the
 *     demo's action bindings; fire drives mouse.down/up), then
 *     `window.__keel.loop.step()`, then every 10th tick snapshot via the
 *     `__keel.world` debug surface (player Transform/Health, enemies
 *     Transform/Health/AI, pickup taken flags).
 *  5. Derive the event log by diffing snapshots (kill = enemy hp>0->0,
 *     pickup = taken false->true, damage = player hp drop, death =
 *     player hp>0->0). Respawn takes 360 ticks so 10-tick snapshots cannot
 *     miss kills.
 *  6. Each script is recorded TWICE (fresh page each). The vectors must be
 *     JSON-identical or the spec fails — that diff IS the determinism proof.
 *
 * Additive only: this spec never modifies game/engine sources.
 */
import fs from "node:fs";
import path from "node:path";
import { gotoApp, test, expect } from "./fixtures";
import { waitForKeel } from "./helpers";

// Specs run with cwd = backends/ts-three (see playwright.config.ts).
const SCRIPTS_DIR = path.join(process.cwd(), "../rs-core/parity/scripts");
const VECTORS_DIR = path.join(process.cwd(), "../rs-core/parity/vectors");

const MASTER_SEED = 1337;
const SNAP_EVERY = 10;

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
  moveFwd: "KeyW",
  moveBack: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  jump: "Space",
  sprint: "ShiftLeft",
  pause: "Escape",
};

interface SnapEnemy {
  x: number;
  z: number;
  hp: number;
  state: string;
}
interface SnapPickup {
  x: number;
  z: number;
  taken: boolean;
}
interface Snapshot {
  tick: number;
  player: { hp: number; x: number; y: number; z: number };
  enemies: SnapEnemy[];
  pickups: SnapPickup[];
}

interface VecEvent {
  tick: number;
  kind: string;
  detail: Record<string, unknown>;
}

async function readSnapshot(
  page: Parameters<typeof gotoApp>[0],
  tick: number,
): Promise<Snapshot> {
  return page.evaluate((t: number) => {
    const k = (window as any).__keel;
    const pt = k.world.get(k.playerId, "Transform");
    const ph = k.world.get(k.playerId, "Health");
    const enemies: SnapEnemy[] = [];
    for (const id of k.world.query("Enemy", "Transform", "Health", "AI")) {
      const tr = k.world.get(id, "Transform");
      const h = k.world.get(id, "Health");
      const ai = k.world.get(id, "AI");
      enemies.push({
        x: tr.position.x,
        z: tr.position.z,
        hp: h.current ?? h.hp,
        state: ai.state,
      });
    }
    const pickups: SnapPickup[] = [];
    for (const id of k.world.query("Pickup", "Transform")) {
      const tr = k.world.get(id, "Transform");
      const p = k.world.get(id, "Pickup");
      pickups.push({ x: tr.position.x, z: tr.position.z, taken: !!p.taken });
    }
    return {
      tick: t,
      player: {
        hp: ph.current ?? ph.hp,
        x: pt.position.x,
        y: pt.position.y,
        z: pt.position.z,
      },
      enemies,
      pickups,
    } as Snapshot;
  }, tick);
}

async function runScript(
  page: Parameters<typeof gotoApp>[0],
  name: string,
): Promise<{ vector: Record<string, unknown>; pointerLocked: boolean }> {
  const script: Script = JSON.parse(
    fs.readFileSync(path.join(SCRIPTS_DIR, `${name}.json`), "utf-8"),
  );
  const totalTicks: number = script.ticks;
  const byTick = new Map<number, ScriptEvent[]>();
  for (const e of script.events) {
    const arr = byTick.get(e.tick) ?? [];
    arr.push(e);
    byTick.set(e.tick, arr);
  }

  await gotoApp(page);
  await waitForKeel(page);

  // Freeze the sim before the game even starts: zero live playing ticks.
  await page.evaluate(() => (window as any).__keel.loop.stop());

  await page.getByTestId("start-button").click();
  // Let the UI-click input suppression (suppressUntil = now+300ms) expire.
  await page.waitForTimeout(400);

  // Pointer lock gates firing (player.ts canFire). The canvas click listener
  // requests it; this is the trusted gesture.
  const box = await page.evaluate(() => {
    const c = document.querySelector("canvas")!.getBoundingClientRect();
    return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(250);
  const pointerLocked = await page.evaluate(
    () => !!document.pointerLockElement,
  );

  const snaps: Snapshot[] = [];
  const mouseDown = new Set<string>();
  for (let tick = 0; tick < totalTicks; tick++) {
    for (const e of byTick.get(tick) ?? []) {
      if (e.action === "fire") {
        if (!pointerLocked) continue; // movement-only fallback vector
        if (e.down) {
          await page.mouse.down();
          mouseDown.add("fire");
        } else {
          await page.mouse.up();
          mouseDown.delete("fire");
        }
      } else {
        const key = KEY_FOR[e.action];
        if (!key) throw new Error(`no key mapping for action ${e.action}`);
        if (e.down) await page.keyboard.down(key);
        else await page.keyboard.up(key);
      }
    }
    await page.evaluate(() => (window as any).__keel.loop.step());
    if ((tick + 1) % SNAP_EVERY === 0)
      snaps.push(await readSnapshot(page, tick + 1));
  }
  // Any still-held inputs are dropped by the fresh navigation the next
  // runScript() starts with (gotoApp reloads the page).
  void mouseDown;

  // --- derive the event log by diffing snapshots ---
  const events: VecEvent[] = [];
  let kills = 0;
  let pickupsTaken = 0;
  let prev: Snapshot | null = null;
  for (const s of snaps) {
    if (prev) {
      for (let i = 0; i < s.enemies.length; i++) {
        const a = prev.enemies[i],
          b = s.enemies[i];
        if (a && b && a.hp > 0 && b.hp <= 0) {
          kills++;
          events.push({
            tick: s.tick,
            kind: "kill",
            detail: { enemy: i, x: b.x, z: b.z },
          });
        }
      }
      for (let i = 0; i < s.pickups.length; i++) {
        const a = prev.pickups[i],
          b = s.pickups[i];
        if (a && b && !a.taken && b.taken) {
          pickupsTaken++;
          events.push({
            tick: s.tick,
            kind: "pickup",
            detail: { pickup: i, x: b.x, z: b.z },
          });
        }
      }
      if (s.player.hp < prev.player.hp) {
        events.push({
          tick: s.tick,
          kind: "damage",
          detail: {
            dmg: +(prev.player.hp - s.player.hp).toFixed(6),
            hp: s.player.hp,
          },
        });
        if (prev.player.hp > 0 && s.player.hp <= 0)
          events.push({
            tick: s.tick,
            kind: "death",
            detail: { hp: s.player.hp },
          });
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
  return { vector, pointerLocked };
}

for (const name of ["move", "combat"]) {
  test(`parity-record ${name}: two runs, identical vectors`, async ({
    page,
  }) => {
    const a = await runScript(page, name);
    const b = await runScript(page, name);
    const sa = JSON.stringify(a.vector);
    const sb = JSON.stringify(b.vector);
    expect(sb).toBe(sa); // determinism proof: the double-run diff must be empty
    fs.mkdirSync(VECTORS_DIR, { recursive: true });
    fs.writeFileSync(path.join(VECTORS_DIR, `${name}.json`), sa + "\n");
    // Surface the pointer-lock result in the test output.
    console.log(`[parity-record] ${name}: pointerLocked=${a.pointerLocked}`);
  });
}
