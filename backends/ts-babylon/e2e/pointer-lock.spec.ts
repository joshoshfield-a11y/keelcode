import { collectConsoleErrors, playerPosition, waitForKeel } from './helpers';
import { expect, gotoApp, test } from './fixtures';

// Babylon + Havok boot on software GL is slow; give it room.
test.setTimeout(120000);

/**
 * Pointer-lock acquisition burst repro (ADR-0016; bug from ADR-0007,
 * carried by ADR-0009 until Wave 6).
 *
 * When pointer lock engages, Chromium dispatches a mousemove whose
 * movementX/Y are the negated pre-lock cursor position (observed in
 * Wave 2: [-639,-335], the start-button position). The game's
 * document-level mousemove handler feeds it into addLook(), swinging
 * yaw ~+95 deg and pitch from -0.18 to the +0.45 clamp before tick 0.
 * The fix discards the first mousemove after each lock acquisition.
 *
 * Method: freeze the loop, suppress ALL real mousemove delivery
 * (parity-recorder pattern) so the game's first post-lock mousemove is
 * exactly the synthetic burst injected here, then assert:
 *  - pitch: the active camera's normalized height offset still matches
 *    pitch -0.18 (dir.y = -sin(pitch) ~= +0.179; the burst flips it to
 *    -sin(+0.45) ~= -0.435),
 *  - yaw: holding W for 45 stepped ticks displaces the player along the
 *    spawn heading (+Z for yaw PI), not the burst-swung heading (~+X).
 * Pre-fix this spec FAILS on both asserts; post-fix it passes.
 */
test('pointer-lock acquisition burst does not swing yaw/pitch', async ({ page }) => {
  const errors = collectConsoleErrors(page);

  await gotoApp(page);
  await waitForKeel(page);

  // Freeze the sim; all stepping below is manual and synchronous.
  await page.evaluate(() => (window as any).__keel.loop.stop());

  // Suppress real mousemove delivery for the whole lock sequence: any
  // browser-generated acquisition burst must not reach the game before
  // the synthetic one, or the measurement is racy.
  await page.evaluate(() => {
    const suppress = (e: Event) => e.stopImmediatePropagation();
    (window as any).__keelSuppressMove = suppress;
    window.addEventListener('mousemove', suppress, true);
  });

  await page.getByTestId('start-button').click();
  // Let the UI-click input suppression (suppressUntil = now+300ms) expire.
  await page.waitForTimeout(450);

  // Engage pointer lock without moving the mouse (recorder pattern: the
  // synthetic canvas click rides the start click's transient activation).
  await page.evaluate(() => {
    (document.querySelector('canvas') as HTMLElement).click();
  });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => !!document.pointerLockElement)).toBe(true);

  // Inject the acquisition burst — the exact vector observed in Wave 2.
  await page.evaluate(() => {
    window.removeEventListener(
      'mousemove',
      (window as any).__keelSuppressMove,
      true,
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', {
        movementX: -639,
        movementY: -335,
        bubbles: true,
      } as MouseEventInit),
    );
  });

  // Pitch assert: settle the follow camera (postupdate lerp), then read
  // its direction from the player target via the exposed Babylon engine.
  // Sim->render space negates z only, so y is directly comparable.
  const camDirY = await page.evaluate(() => {
    const keel = (window as any).__keel;
    for (let i = 0; i < 40; i++) keel.loop.step();
    const engine = keel.renderer as any;
    const cam = engine.scenes[0].activeCamera;
    const t = keel.world.get(keel.playerId, 'Transform');
    const dx = cam.position.x - t.x;
    const dy = cam.position.y - (t.y + 1.7); // CAM_HEIGHT in game/player.ts
    const dz = cam.position.z - -t.z;
    return dy / Math.hypot(dx, dy, dz);
  });
  expect(camDirY).toBeGreaterThan(0.08);
  expect(camDirY).toBeLessThan(0.28);

  // Yaw assert: W for 45 ticks from spawn must head +Z (yaw PI).
  const p0 = await playerPosition(page);
  await page.evaluate(() => {
    const keel = (window as any).__keel;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    for (let i = 0; i < 45; i++) keel.loop.step();
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
  });
  const p1 = await playerPosition(page);
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  expect(dz).toBeGreaterThan(1.2);
  expect(Math.abs(dx)).toBeLessThan(0.35 * dz);

  expect(errors).toEqual([]);
});
