#!/usr/bin/env node
/**
 * Perf harness for the KeelCode ts-babylon backend (Wave 3, child C).
 *
 * Measures the production preview (http://localhost:4174) in headless
 * Chromium and writes tools/perf-harness/measured.json.
 *
 * Method (documented; see PERF.md):
 *  - draw calls: the engine's `_drawCalls` PerfCounter — the exact counter
 *    `BABYLON.SceneInstrumentation.drawCallsCounter` exposes — with a manual
 *    `fetchNewFrame()` before each `scene.render()` (manual renders don't
 *    go through the rAF endFrame that normally resets the counter);
 *    median over 120 frames.
 *  - triangles: per-frame drawn estimate = sum over enabled+visible meshes
 *    in scene.meshes of getTotalIndices()/3, counting each InstancedMesh
 *    entry once (each instance is one draw of its source geometry).
 *  - DPR: 1 / engine.getHardwareScalingLevel() (budgets cap it, not target it).
 *  - frame time: wall time of loop.step() + scene.render() over 120 frames;
 *    p95. HEADLESS-ONLY (SwiftShader software GL): not comparable to real
 *    hardware; recorded for regression tracking between runs, not budgets.
 *  - bundle size: sum of all files under dist/ (JS + Havok WASM + assets).
 *
 * Usage: start `npm run preview -- --port 4174` first, then `node tools/perf-harness/measure.mjs`.
 * Fails (exit 1) on any console error or pageerror.
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, '../..');
const URL = 'http://localhost:4174/';
const FRAMES = 120;

function bundleBytes(dir) {
  let total = 0;
  const files = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = bundleBytes(p);
      total += sub.total;
      files.push(...sub.files);
    } else {
      const s = fs.statSync(p).size;
      total += s;
      files.push({ file: path.relative(dir, p), bytes: s });
    }
  }
  return { total, files };
}

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => typeof window.__keel !== 'undefined', undefined, { timeout: 60000 });
await page.waitForTimeout(1200);

// Freeze the rAF loop, enter the game, let UI suppression expire.
await page.evaluate(() => window.__keel.loop.stop());
await page.getByTestId('start-button').click();
await page.waitForTimeout(400);

const measured = await page.evaluate((frames) => {
  const k = window.__keel;
  const engine = k.renderer;
  const scene = engine.scenes[0];

  // warm up: shaders/particles settle before timing
  for (let i = 0; i < 10; i++) {
    k.loop.step();
    scene.render();
  }

  // Draw calls: engine._drawCalls is a PerfCounter cumulative across manual
  // scene.render() calls (no rAF endFrame to reset it), so fetchNewFrame()
  // before each render to get the per-frame count. This is the same counter
  // BABYLON.SceneInstrumentation.drawCallsCounter exposes.
  const drawCalls = [];
  const frameTimes = [];
  for (let i = 0; i < frames; i++) {
    engine._drawCalls.fetchNewFrame();
    const t0 = performance.now();
    k.loop.step();
    scene.render();
    frameTimes.push(performance.now() - t0);
    drawCalls.push(engine._drawCalls.current);
  }
  frameTimes.sort((a, b) => a - b);
  drawCalls.sort((a, b) => a - b);

  // per-frame drawn triangles: sum over the ACTIVE meshes (post frustum-cull,
  // what the renderer actually draws) of getTotalIndices()/3. Each
  // InstancedMesh entry counts once (one draw of its source geometry).
  let tris = 0;
  const activeMeshes = scene.getActiveMeshes();
  const meshCount = scene.meshes.length;
  for (let i = 0; i < activeMeshes.length; i++) {
    const m = activeMeshes.data[i];
    if (!m.isEnabled() || !m.isVisible) continue;
    const idx = typeof m.getTotalIndices === 'function' ? m.getTotalIndices() : 0;
    tris += idx / 3;
  }

  return {
    drawCallsMedian: drawCalls[Math.floor(drawCalls.length / 2)],
    drawCallsMax: drawCalls[drawCalls.length - 1],
    drawCallsMin: drawCalls[0],
    trianglesDrawn: Math.round(tris),
    meshCount,
    dpr: 1 / engine.getHardwareScalingLevel(),
    devicePixelRatio: window.devicePixelRatio,
    frameTimeMs: {
      p50: frameTimes[Math.floor(frameTimes.length * 0.5)],
      p95: frameTimes[Math.floor(frameTimes.length * 0.95)],
      max: frameTimes[frameTimes.length - 1],
    },
    headless: true,
    renderer: engine.getGlInfo ? engine.getGlInfo().renderer : 'unknown',
  };
}, FRAMES);

await browser.close();

const dist = path.join(BACKEND, 'dist');
const bundle = bundleBytes(dist);

const out = {
  measuredAt: new Date().toISOString(),
  backend: 'ts-babylon',
  budgets: JSON.parse(fs.readFileSync(path.join(__dirname, 'budgets.json'), 'utf-8')),
  ...measured,
  bundle: {
    bytes: bundle.total,
    mb: +(bundle.total / 1048576).toFixed(2),
    files: bundle.files.sort((a, b) => b.bytes - a.bytes),
  },
  consoleErrors: errors,
};

fs.writeFileSync(path.join(__dirname, 'measured.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ ...out, bundle: { ...out.bundle, files: `[${out.bundle.files.length} files]` } }, null, 2));

if (errors.length > 0) {
  console.error('CONSOLE ERRORS:', errors);
  process.exit(1);
}
