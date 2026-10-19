import { collectConsoleErrors, waitForKeel } from './helpers';
import { expect, gotoApp, test } from './fixtures';

/**
 * Game-over flow: forcing the player Health to 0 through the debug surface
 * must surface the game-over screen.
 *
 * Contract assumption (see tests/api-contract.md): the demo evaluates death
 * on sim ticks and shows `[data-testid="game-over-screen"]` reactively when
 * `Health.hp <= 0` (engine field name).
 */
test('zero player health shows the game-over screen', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await gotoApp(page);
  await waitForKeel(page);

  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('hud')).toBeVisible();

  // The game polls player.alive every frame (main.ts); makeHealth keeps both
  // field names in sync, so set both hp and current to 0.
  await page.evaluate(() => {
    const k = window.__keel;
    k.world.set(k.playerId, 'Health', { hp: 0, maxHp: 100, current: 0, max: 100 });
  });

  await expect(page.getByTestId('game-over-screen')).toBeVisible({ timeout: 8000 });

  expect(errors).toEqual([]);
});
