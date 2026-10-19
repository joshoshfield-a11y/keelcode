/** STARFALL: Drift Arena — scripted playthrough vector (deterministic).
 *
 * launch → mine ore → fight pirates → dock → trade → upgrade → save →
 * reload → assert restored state. Recorded, replayable, asserted.
 * Also captures the 5 user-requested screenshots into ./screenshots/.
 *
 * Strategy: the loop is PAUSED and driven via loop.step() (one evaluate per
 * batch — deterministic regardless of wall clock); the script teleports
 * entities via the window.__keel debug surface, then drives REAL input
 * (keyboard/mouse) so the actual systems (mining beam, projectiles, dock
 * proximity, economy, save) are what get exercised. Live rendering is only
 * used for screenshots.
 */
import { test, expect, type Page } from '@playwright/test';
import { waitForKeel, collectConsoleErrors } from './helpers';

test.setTimeout(180000);

interface Snap {
  credits: number;
  ore: number;
  hull: number;
  upgrades: { guns: number; engine: number; shield: number };
  quests: Array<{ kind: string; progress: number; done: boolean }>;
  docked: boolean;
}

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const g = (window as unknown as { __keel: any }).__keel.game;
    return {
      credits: g.getCredits() as number,
      ore: g.getOre() as number,
      hull: g.getHull() as number,
      upgrades: g.getUpgrades() as Snap['upgrades'],
      quests: (g.getQuests() as Array<any>).map((q) => ({
        kind: q.kind as string,
        progress: q.progress as number,
        done: q.done as boolean,
      })),
      docked: g.isDocked() as boolean,
    };
  });
}

/** Drive the sim manually: N fixed steps in one round-trip (loop halted —
 *  deterministic regardless of wall clock). The loop MUST be halted first:
 *  a running rAF consumes pressed-edges between our round-trips. */
async function step(page: Page, n: number): Promise<void> {
  await page.evaluate((count: number) => {
    const loop = (window as unknown as { __keel: any }).__keel.loop;
    for (let i = 0; i < count; i++) loop.step();
  }, n);
}

/** Halt the rAF loop entirely (no rendering, no edge-eating between steps). */
async function halt(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __keel: any }).__keel.loop.stop();
  });
}

/** Resume the rAF loop (keeps the game's own paused flag as-is). */
async function resume(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __keel: any }).__keel.loop.start();
  });
}

/** Teleport the player ship to (x,y,z), stopped, facing (fx,fz). */
async function placePlayer(
  page: Page, x: number, y: number, z: number, fx: number, fz: number,
): Promise<void> {
  await page.evaluate(
    ([px, py, pz, tx, tz]: number[]) => {
      const keel = (window as unknown as { __keel: any }).__keel;
      const t = keel.world.get(keel.playerId, 'Transform');
      t.x = px; t.y = py; t.z = pz;
      t.ry = Math.atan2(-(tx - px), -(tz - pz));
      t.rx = 0;
      const v = keel.world.get(keel.playerId, 'Velocity');
      if (v) { v.x = 0; v.y = 0; v.z = 0; }
    },
    [x, y, z, fx, fz],
  );
}

/** First asteroid-like entity: has Transform, is not player/station/enemy/projectile/pickup. */
async function findRock(page: Page): Promise<{ x: number; y: number; z: number }> {
  return page.evaluate(() => {
    const keel = (window as unknown as { __keel: any }).__keel;
    const ids = keel.world.query('Transform') as number[];
    for (const id of ids) {
      if (id === keel.playerId) continue;
      if (id === keel.game.stationId) continue;
      if (keel.world.get(id, 'Enemy')) continue;
      if (keel.world.get(id, 'Projectile')) continue;
      if (keel.world.get(id, 'Pickup')) continue;
      const t = keel.world.get(id, 'Transform');
      return { x: t.x as number, y: t.y as number, z: t.z as number };
    }
    throw new Error('no rock entity found');
  });
}

/** Weaken one pirate to 1 hp and park it dead ahead of the player. */
async function stagePirateAhead(page: Page, dist: number): Promise<void> {
  await page.evaluate((d: number) => {
    const keel = (window as unknown as { __keel: any }).__keel;
    const ids = keel.world.query('Enemy') as number[];
    if (!ids.length) throw new Error('no pirates to stage');
    const pt = keel.world.get(keel.playerId, 'Transform');
    const cp = Math.cos(pt.rx);
    const fx = -cp * Math.sin(pt.ry);
    const fy = Math.sin(pt.rx);
    const fz = -cp * Math.cos(pt.ry);
    const id = ids[0];
    const t = keel.world.get(id, 'Transform');
    t.x = pt.x + fx * d; t.y = pt.y + fy * d; t.z = pt.z + fz * d;
    const h = keel.world.get(id, 'Health');
    h.hp = 1;
    const v = keel.world.get(id, 'Velocity');
    if (v) { v.x = 0; v.y = 0; v.z = 0; }
  }, dist);
}

test('drift arena playthrough: mine, fight, dock, trade, upgrade, save, reload', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForKeel(page);

  // 1. title screen; sim must not be running behind it
  await expect(page.getByTestId('screen-title')).toBeVisible();
  const tick0 = await page.evaluate(
    () => (window as unknown as { __keel: any }).__keel.loop.tick,
  );
  expect(tick0).toBe(0);
  await page.screenshot({ path: 'screenshots/01-title.png' });

  // 2. launch, then take manual control of the loop
  await page.getByTestId('btn-launch').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  let s = await snap(page);
  expect(s.credits).toBe(100);
  expect(s.docked).toBe(false);
  await halt(page);

  // 3. mine: park 20u off a rock, face it, hold E for 320 steps
  //    (5.33 sim-sec → ~10 ore at 1 per 0.5s)
  const rock = await findRock(page);
  await placePlayer(page, rock.x + 20, rock.y, rock.z, rock.x, rock.z);
  await page.keyboard.down('KeyE');
  await step(page, 320);
  await page.keyboard.up('KeyE');
  s = await snap(page);
  expect(s.ore).toBeGreaterThanOrEqual(5);
  expect(s.quests.find((q) => q.kind === 'mine')!.progress).toBeGreaterThanOrEqual(5);
  // mining screenshot with the beam visible (live rendering)
  await resume(page);
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'screenshots/03-mining.png' });
  await page.keyboard.up('KeyE');
  await halt(page);

  // 4. fight: move to clear space (inside the rock ring), crippled pirate
  //    parked point-blank ahead (lasers connect before it can strafe clear);
  //    click-volleys, stepped, until the kill lands
  await placePlayer(page, 0, 0, 100, 0, 0);
  await stagePirateAhead(page, 8);
  for (let volley = 0; volley < 4; volley++) {
    await page.mouse.down();
    await step(page, 4);
    await page.mouse.up();
    await step(page, 26); // lasers travel 8u @170u/s in ~3 ticks; margin
    const q = (await snap(page)).quests.find((qq) => qq.kind === 'kill')!;
    if (q.progress >= 1) break;
  }
  s = await snap(page);
  expect(s.quests.find((q) => q.kind === 'kill')!.progress).toBeGreaterThanOrEqual(1);

  // combat screenshot (live): fresh wave parked close, lasers flying
  await resume(page);
  await page.evaluate(() => {
    const keel = (window as unknown as { __keel: any }).__keel;
    keel.game.spawnPirateWave(3);
    const pt = keel.world.get(keel.playerId, 'Transform');
    const cp = Math.cos(pt.rx);
    const fx = -cp * Math.sin(pt.ry);
    const fz = -cp * Math.cos(pt.ry);
    const ids = (keel.world.query('Enemy') as number[]).slice(0, 2);
    ids.forEach((id: number, i: number) => {
      const t = keel.world.get(id, 'Transform');
      t.x = pt.x + fx * (55 + i * 15);
      t.y = pt.y + 4 * (i + 1);
      t.z = pt.z + fz * (55 + i * 15);
    });
  });
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(640, 360);
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: 'screenshots/02-combat.png' });
  await halt(page);

  // 5. dock: park inside DOCK_RANGE of the station, press F
  await placePlayer(page, 0, 0, -555, 0, -600);
  await page.keyboard.down('KeyF');
  await step(page, 5);
  await page.keyboard.up('KeyF');
  await expect(page.getByTestId('station-panel')).toBeVisible();
  s = await snap(page);
  expect(s.docked).toBe(true);
  await resume(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'screenshots/04-docked.png' });
  await page.getByTestId('station-quests').screenshot({ path: 'screenshots/05-quests.png' });

  // 6. trade: sell ore, buy the guns upgrade
  const oreBefore = s.ore;
  const crBefore = s.credits;
  expect(oreBefore).toBeGreaterThan(0);
  await page.getByTestId('station-sell').click();
  s = await snap(page);
  expect(s.ore).toBe(0);
  expect(s.credits).toBe(crBefore + oreBefore * 10);
  await page.getByTestId('station-up-guns').click();
  s = await snap(page);
  expect(s.upgrades.guns).toBe(1);

  // 7. undock, then save via the pause menu; capture state
  await page.getByTestId('station-undock').click();
  await expect(page.getByTestId('station-panel')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('screen-pause')).toBeVisible();
  await page.getByTestId('btn-save').click();
  const saved = await snap(page);

  // 8. reload → Continue → state must match
  await page.reload();
  await waitForKeel(page);
  await expect(page.getByTestId('btn-continue')).toBeVisible();
  await page.getByTestId('btn-continue').click();
  await expect(page.getByTestId('hud')).toBeVisible();
  const restored = await snap(page);
  expect(restored.credits).toBe(saved.credits);
  expect(restored.ore).toBe(saved.ore);
  expect(restored.upgrades).toEqual(saved.upgrades);
  expect(restored.quests).toEqual(saved.quests);
  expect(restored.hull).toBe(saved.hull);

  expect(errors).toEqual([]);
});
