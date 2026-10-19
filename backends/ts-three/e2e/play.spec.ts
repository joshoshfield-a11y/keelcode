import { collectConsoleErrors, playerPosition, waitForKeel } from './helpers';
import { expect, gotoApp, test } from './fixtures';

// Software GL boots slowly (bundle parse + shader compile); give it room.
test.setTimeout(90000);

/**
 * Core play loop: title screen -> click start -> HUD -> hold W and the player
 * entity moves -> Escape pauses (overlay + frozen tick) -> resume.
 *
 * Contract assumptions (see tests/api-contract.md): data-testid attributes
 * `title-screen`, `start-button`, `hud`, `pause-menu` (+ optional
 * `resume-button`); Escape toggles pause; W drives the player forward.
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

  // Hold W for 2 s: the player Transform must actually move.
  const before = await playerPosition(page);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
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
  await page.waitForTimeout(400);
  const t4 = await page.evaluate(() => window.__keel.loop.tick);
  expect(t4).toBeGreaterThan(t3);

  expect(errors).toEqual([]);
});
