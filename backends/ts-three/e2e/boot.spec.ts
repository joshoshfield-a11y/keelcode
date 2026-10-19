import { collectConsoleErrors, pngStats, waitForKeel } from './helpers';
import { expect, gotoApp, test } from './fixtures';

/**
 * Boot gate: the production preview loads, exposes the window.__keel debug
 * surface (world/loop/input/playerId/renderer), renders a non-blank canvas,
 * and logs zero console errors. Per the QA gates: tsc clean, vitest green,
 * e2e green, zero console errors.
 */
test('production preview boots with zero console errors and a non-blank canvas', async ({
  page,
}) => {
  const errors = collectConsoleErrors(page);

  await gotoApp(page);
  await waitForKeel(page);

  // A WebGL canvas is present and visible.
  await expect(page.locator('canvas').first()).toBeVisible();

  // The debug surface the play specs and perf harness rely on.
  const shape = await page.evaluate(() => {
    const k = (window as any).__keel;
    return {
      hasWorld: typeof k?.world?.get === 'function',
      hasLoop: typeof k?.loop?.tick === 'number',
      hasInput: typeof k?.input !== 'undefined',
      hasPlayerId: typeof k?.playerId === 'number',
      hasRenderer: typeof k?.renderer?.info?.render?.calls === 'number',
    };
  });
  expect(shape).toEqual({
    hasWorld: true,
    hasLoop: true,
    hasInput: true,
    hasPlayerId: true,
    hasRenderer: true,
  });

  // The canvas actually renders: the screenshot has real pixel variation.
  // (A broken/black/cleared canvas decodes to ~zero stddev.)
  const shot = await page.screenshot();
  const stats = pngStats(shot as unknown as Uint8Array);
  expect(stats.width).toBeGreaterThan(0);
  expect(stats.stddev).toBeGreaterThan(3);

  expect(errors).toEqual([]);
});
