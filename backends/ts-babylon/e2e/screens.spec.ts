import { collectConsoleErrors, waitForKeel } from './helpers';
import { expect, gotoApp, test } from './fixtures';

// Software GL is slow to settle; the title button's stability check needs room.
test.setTimeout(120000);

/**
 * Game-over flow: forcing the player Health to 0 through the debug surface
 * must surface the game-over screen.
 *
 * Contract assumption: the demo evaluates death on sim ticks and shows
 * `[data-testid="game-over-screen"]` reactively when the player is dead
 * (main.ts postupdate checks player.alive; makeHealth keeps hp and current
 * in sync, so zeroing both covers every read path).
 */
test('zero player health shows the game-over screen', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await gotoApp(page);
  await waitForKeel(page);

  await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('start-button').click({ timeout: 20000 });
  await expect(page.getByTestId('hud')).toBeVisible({ timeout: 15000 });

  await page.evaluate(() => {
    const k = window.__keel;
    k.world.set(k.playerId, 'Health', { hp: 0, maxHp: 100, current: 0, max: 100 });
  });

  await expect(page.getByTestId('game-over-screen')).toBeVisible({ timeout: 8000 });

  expect(errors).toEqual([]);
});
