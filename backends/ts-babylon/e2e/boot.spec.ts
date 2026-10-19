import { collectConsoleErrors, pngStats, waitForKeel } from './helpers';
import { expect, gotoApp, test } from './fixtures';

// Software GL boots slowly (bundle parse + Havok WASM + shader compile);
// the first screenshot can take a while on SwiftShader. Give it room.
test.setTimeout(120000);

/**
 * Boot gate: the production preview loads, exposes the window.__keel debug
 * surface (world/loop/input/playerId/renderer), shows the title screen for
 * this backend ("wave 3 · babylon slice"), renders a non-blank canvas, and
 * logs zero console errors. Per the QA gates: tsc clean, vitest green,
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

  // The debug surface the play specs and perf harness rely on. renderer is
  // the BABYLON.Engine here (not a three.js renderer): it must own at least
  // one scene and expose the public resize API.
  const shape = await page.evaluate(() => {
    const k = window.__keel;
    return {
      hasWorld: typeof k?.world?.get === 'function',
      hasLoop: typeof k?.loop?.tick === 'number',
      hasInput: typeof k?.input !== 'undefined',
      hasPlayerId: typeof k?.playerId === 'number',
      hasRenderer:
        typeof k?.renderer?.resize === 'function' &&
        (k?.renderer?.scenes?.length ?? 0) >= 1,
    };
  });
  expect(shape).toEqual({
    hasWorld: true,
    hasLoop: true,
    hasInput: true,
    hasPlayerId: true,
    hasRenderer: true,
  });

  // Title screen identifies this backend.
  await expect(page.getByTestId('title-screen')).toBeVisible();
  await expect(page.locator('.kcard .sub')).toHaveText('wave 3 · babylon slice');

  // The canvas actually renders: the screenshot has real pixel variation.
  // (A broken/black/cleared canvas decodes to ~zero stddev.)
  const shot = await page.screenshot();
  const stats = pngStats(shot as unknown as Uint8Array);
  expect(stats.width).toBeGreaterThan(0);
  expect(stats.stddev).toBeGreaterThan(3);

  expect(errors).toEqual([]);
});
