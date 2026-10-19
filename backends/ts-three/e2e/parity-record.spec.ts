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

  // Suppress ALL mousemove delivery to the game for the recording. Rationale:
  // when pointer lock engages, Chromium dispatches a mousemove whose
  // movementX/Y is the warp delta from the pre-lock cursor position to the
  // lock origin (observed: [-639,-335] — the start-button position negated).
  // The game's document-level mousemove handler feeds that straight into
  // addLook(), swinging the camera yaw ~90 degrees before tick 0. That warp
  // is a browser quirk, not user input; the headless Rust sim has no mouse at
  // all, so for parity the recording must be keyboard/mouse-button only with
  // yaw pinned at its reset value (PI). (The underlying game behavior — the
  // camera swinging on lock acquisition — is a real bug, flagged in the Wave
  // 2 report; the harness works around it rather than touching frozen Wave 1
  // game sources.) mousedown/mouseup (fire) are unaffected.
  await page.evaluate(() => {
    window.addEventListener(
      "mousemove",
      (e) => {
        e.stopImmediatePropagation();
      },
      true,
    );
  });

  await page.getByTestId("start-button").click();
  // Let the UI-click input suppression (suppressUntil = now+300ms) expire.
  await page.waitForTimeout(400);

  // Pointer lock gates firing (player.ts canFire). Request it WITHOUT moving
  // the mouse: page.mouse.click would generate mousemove events that, if
  // processed after lock engages, swing the camera yaw via movementX/Y and
  // make runs diverge. The synthetic click rides the transient activation
  // from the real start-button click above, and the canvas 'click' listener
  // requests the lock. No mousemove is ever generated after this point.
  await page.evaluate(() => {
    (document.querySelector("canvas") as HTMLElement).click();
  });
  await page.waitForTimeout(250);
  const pointerLocked = await page.evaluate(
    () => !!document.pointerLockElement,
  );

  const snaps: Snapshot[] = [];
  for (let tick = 0; tick < totalTicks; tick++) {
    // Apply this tick's input events and advance the sim inside ONE evaluate
    // so event delivery is synchronous with the step: no CDP input-pipeline
    // race can shift a key/mouse event by a tick between runs. (The old
    // page.keyboard/page.mouse path was async and produced ~1-tick slips.)
    type DueEvent =
      | { kind: "mouse"; down: boolean }
      | { kind: "key"; code: string; down: boolean };
    const due: DueEvent[] = [];
    for (const e of byTick.get(tick) ?? []) {
      if (e.action === "fire") {
        if (!pointerLocked) continue; // movement-only fallback vector
        due.push({ kind: "mouse", down: e.down });
      } else {
        const code = KEY_FOR[e.action];
        if (!code) throw new Error(`no key mapping for action ${e.action}`);
        due.push({ kind: "key", code, down: e.down });
      }
    }
    await page.evaluate((dueEvents: DueEvent[]) => {
      for (const e of dueEvents) {
        if (e.kind === "mouse") {
          window.dispatchEvent(
            new MouseEvent(e.down ? "mousedown" : "mouseup", { button: 0 }),
          );
        } else {
          window.dispatchEvent(
            new KeyboardEvent(e.down ? "keydown" : "keyup", { code: e.code }),
          );
        }
      }
      (window as any).__keel.loop.step();
    }, due);
    if ((tick + 1) % SNAP_EVERY === 0)
      snaps.push(await readSnapshot(page, tick + 1));
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
        // The sim deals damage in fixed 12-hp hits (ENEMY_TUNING.damage); a
        // 10-tick snapshot window can contain several hits, which the naive
        // diff would coalesce into one event with an inflated dmg. Split the
        // observed drop into individual 12-hp hit events so the log matches
        // the Rust sim's per-hit event stream. The final hit may overkill
        // (drop < 12 when hp clamps at 0); ceil() counts it as a hit.
        const drop = prev.player.hp - s.player.hp;
        const hits = Math.max(1, Math.ceil(drop / 12));
        for (let i = 0; i < hits; i++) {
          events.push({
            tick: s.tick,
            kind: "damage",
            detail: {
              dmg: 12,
              hp: Math.max(0, prev.player.hp - 12 * (i + 1)),
            },
          });
        }
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
    test.slow(); // 900 ticks x evaluate round-trips needs the 3x budget
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
