import { collectConsoleErrors, playerPosition, waitForKeel } from './helpers';
import { expect, gotoApp, test } from './fixtures';

// Software GL boots slowly (bundle parse + Havok WASM + shader compile); give it room.
test.setTimeout(120000);

/**
 * Core play loop: title screen -> click start -> HUD -> hold W and the player
 * entity moves -> Escape pauses (overlay + frozen tick) -> resume.
 *
 * Contract assumptions (see screens.ts/hud.ts data-testids): `title-screen`,
 * `start-button`, `hud`, `pause-menu` (+ optional `resume-button`); Escape
 * toggles pause; W drives the player forward.
 */
test('title -> play -> move -> pause -> resume', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await gotoApp(page);
  await waitForKeel(page);

  // Title screen is up on boot; clicking start enters the game.
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('title-screen')).toBeHidden();
  await expect(page.getByTestId('hud')).toBeVisible();

  // Hold W until ~2 sim-seconds elapse: the player Transform must actually move.
  // (Software GL sheds wall time via the loop's catch-up cap, so we wait on
  // sim ticks, not wall time.)
  const before = await playerPosition(page);
  const tick0 = await page.evaluate(() => window.__keel.loop.tick);
  await page.keyboard.down('KeyW');
  await page.waitForFunction((t0: number) => window.__keel.loop.tick >= t0 + 120, tick0, {
    timeout: 120000,
  });
  await page.keyboard.up('KeyW');
  const after = await playerPosition(page);
  const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
  expect(moved).toBeGreaterThan(0.5);

  // Escape pauses: overlay shows, sim tick freezes.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  expect(await page.evaluate(() => window.__keel.loop.paused)).toBe(true);
  const t1 = await page.evaluate(() => window.__keel.loop.tick);
  await page.waitForTimeout(600);
  const t2 = await page.evaluate(() => window.__keel.loop.tick);
  expect(t2).toBe(t1);

  // Resume: Escape toggles back; fall back to the resume button if not.
  await page.keyboard.press('Escape');
  if (await page.evaluate(() => window.__keel.loop.paused)) {
    await page.getByTestId('resume-button').click();
  }
  await expect(page.getByTestId('pause-menu')).toBeHidden();
  expect(await page.evaluate(() => window.__keel.loop.paused)).toBe(false);

  // The sim runs again after resume.
  const t3 = await page.evaluate(() => window.__keel.loop.tick);
  await page.waitForFunction((t: number) => window.__keel.loop.tick > t, t3, {
    timeout: 60000,
  });

  expect(errors).toEqual([]);
});
