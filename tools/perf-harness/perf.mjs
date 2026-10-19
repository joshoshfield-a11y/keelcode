#!/usr/bin/env node
/**
 * KeelCode perf harness (Wave 1, ts-three reference backend).
 *
 * Boots the production build via `vite preview` (spawning it if needed),
 * runs a scripted play sequence, and measures the binding perf budgets from
 * framework/SPEC.md section 4: draw calls, triangles, DPR cap, frame-time p95.
 *
 * Frame times measured under SwiftShader (headless software GL) are NOT
 * representative of real GPUs, so the frame-time gate is reported as SKIP
 * there and enforced only on real hardware. Draw calls, triangles, and DPR
 * are scene-graph properties and are gated everywhere.
 *
 * Usage:
 *   node tools/perf-harness/perf.mjs [--tier desktop|mobile] [--url http://localhost:4173]
 *   KEEL_URL env overrides --url. KEEL_CHROMIUM_EXECUTABLE optionally points
 *   at a system Chromium (used when Playwright's bundled browser is absent).
 *   KEEL_E2E_URL (e.g. https://keelcode.local/) switches the harness to
 *   sandbox file-server mode: dist/ is served via request interception and
 *   no preview server is spawned (for sandboxes where the browser cannot
 *   reach localhost).
 * Exits 0 when every gate passes (or skips), 1 on any breach, 2 on harness errors.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tsThree = path.join(root, 'backends', 'ts-three');
// Resolve playwright from the backend's node_modules no matter where this
// script is invoked from (ESM imports resolve from the file, not cwd).
const tsThreeRequire = createRequire(path.join(tsThree, 'package.json'));
const { chromium } = tsThreeRequire('playwright');

const budgets = JSON.parse(readFileSync(path.join(here, 'budgets.json'), 'utf8'));

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const tier = arg('--tier', 'desktop');
if (tier !== 'desktop' && tier !== 'mobile') {
  console.error(`perf: unknown --tier "${tier}" (want desktop|mobile)`);
  process.exit(2);
}
const FRAMES = 300;

async function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function writeReport(results) {
  const L = [];
  L.push('# KeelCode perf report — ts-three reference backend');
  L.push('');
  L.push(`- Date: ${new Date().toISOString()}`);
  L.push(`- Tier: ${results.tier} · URL: ${results.url} · frames sampled: ${results.frames}`);
  L.push(`- Renderer: ${results.measured.renderer}`);
  L.push(`- Budgets: tools/perf-harness/budgets.json`);
  L.push('');
  L.push('| Check | Measured | Budget | Verdict |');
  L.push('|---|---|---|---|');
  for (const c of results.checks) {
    L.push(`| ${c.name} | ${c.measured} | ${c.budget} | ${c.verdict}${c.note ? ` — ${c.note}` : ''} |`);
  }
  L.push('');
  L.push('## Frame-time distribution (ms)');
  const f = results.measured.frameMs;
  L.push(`- mean ${f.mean}, p50 ${f.p50}, p95 ${f.p95}, p99 ${f.p99}`);
  L.push(`- triangles/frame: mean ${results.measured.trianglesMean}, max ${results.measured.trianglesMax}`);
  L.push(`- console errors during run: ${results.measured.consoleErrors}`);
  if (results.errors.length > 0) {
    L.push('');
    L.push('## Console errors');
    for (const e of results.errors.slice(0, 20)) L.push(`- ${e}`);
  }
  L.push('');
  L.push(
    'Binding rule (framework/SPEC.md §4): any FAIL above blocks the wave unless the regression is measured, disclosed, and explicitly waived by the user.',
  );
  writeFileSync(path.join(here, 'PERF.md'), L.join('\n') + '\n');
}

function printSummary(results) {
  console.log('\n===== keel perf summary =====');
  for (const c of results.checks) {
    console.log(`${c.verdict.padEnd(5)} ${c.name}: measured=${c.measured} budget=${c.budget}`);
  }
  if (results.errors.length > 0) {
    console.log(`\n${results.errors.length} console error(s) during run (see PERF.md)`);
  }
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

/** Serve dist/ from disk for every request to the file-server origin. */
async function installFileServer(page, fileUrl) {
  const dist = path.join(tsThree, 'dist');
  const origin = new URL(fileUrl).origin;
  await page.route(`${origin}/**/*`, (route) => {
    const u = new URL(route.request().url());
    const rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, '');
    const p = path.join(dist, rel);
    try {
      if (existsSync(p) && statSync(p).isFile()) {
        const ext = path.extname(p);
        void route.fulfill({
          contentType: MIME[ext] || 'application/octet-stream',
          body: readFileSync(p),
        });
        return;
      }
    } catch {
      /* fall through to abort */
    }
    void route.abort();
  });
}

async function main() {
  const distIndex = path.join(tsThree, 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    console.error(
      `perf: no production build at ${distIndex} — run 'npm run build' in backends/ts-three first`,
    );
    process.exit(2);
  }

  const fileUrl = process.env.KEEL_E2E_URL;
  const url = fileUrl || process.env.KEEL_URL || arg('--url', 'http://localhost:4173');
  let server = null;
  if (!fileUrl) {
    if (!(await waitForUrl(url, 3000))) {
      console.log(`perf: starting vite preview for ${url}`);
      server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
        cwd: tsThree,
        stdio: 'ignore',
      });
      if (!(await waitForUrl(url))) {
        console.error('perf: vite preview did not come up');
        server.kill();
        process.exit(2);
      }
    } else {
      console.log(`perf: reusing server at ${url}`);
    }
  } else {
    console.log(`perf: file-server mode, serving dist/ for ${url}`);
  }

  const results = { tier, url, frames: FRAMES, checks: [], errors: [] };
  let exitCode = 0;
  const launchOpts = { args: ['--no-sandbox'] };
  if (process.env.KEEL_CHROMIUM_EXECUTABLE) {
    launchOpts.executablePath = process.env.KEEL_CHROMIUM_EXECUTABLE;
  }
  const browser = await chromium.launch(launchOpts);
  try {
    const page = await browser.newPage({
      viewport: tier === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    });
    page.on('pageerror', (e) => results.errors.push(`pageerror: ${String(e)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') results.errors.push(`console: ${m.text()}`);
    });
    if (fileUrl) await installFileServer(page, fileUrl);

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(
      () => typeof window.__keel !== 'undefined' && !!window.__keel.renderer,
      null,
      { timeout: 20000 },
    );

    // Scripted play: start the game, move around, then settle before measuring.
    const startBtn = page.getByTestId('start-button');
    if ((await startBtn.count()) > 0) {
      await startBtn.first().click({ timeout: 5000 }).catch(() => {});
    }
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyW');
    await page.keyboard.down('KeyA');
    await page.waitForTimeout(500);
    await page.keyboard.up('KeyA');
    await page.waitForTimeout(500);

    const samples = await page.evaluate(
      (n) =>
        new Promise((resolve) => {
          const r = window.__keel.renderer;
          const times = [];
          const calls = [];
          const tris = [];
          let rendererName = 'unknown';
          try {
            const gl = r.getContext();
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            if (ext) rendererName = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'unknown';
          } catch {
            /* ignore */
          }
          function fr(t) {
            times.push(t);
            calls.push(r.info.render.calls);
            tris.push(r.info.render.triangles);
            if (times.length < n) requestAnimationFrame(fr);
            else resolve({ times, calls, tris, rendererName, dpr: r.getPixelRatio() });
          }
          requestAnimationFrame(fr);
        }),
      FRAMES,
    );

    const deltas = [];
    for (let i = 1; i < samples.times.length; i++) deltas.push(samples.times[i] - samples.times[i - 1]);
    const sorted = [...deltas].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    const maxCalls = Math.max(...samples.calls);
    const maxTris = Math.max(...samples.tris);
    const meanTris = samples.tris.reduce((a, b) => a + b, 0) / samples.tris.length;
    const p95 = pct(95);
    const swift = /swiftshader/i.test(samples.rendererName);

    const check = (name, measured, budget, pass, note) => {
      results.checks.push({ name, measured, budget, verdict: pass ? 'PASS' : 'FAIL', note });
      if (!pass) exitCode = 1;
    };
    const skip = (name, measured, budget, note) => {
      results.checks.push({ name, measured, budget, verdict: 'SKIP', note });
    };

    check('draw calls (max over run)', maxCalls, budgets.maxDrawCalls, maxCalls <= budgets.maxDrawCalls);
    check(
      'triangles (max over run)',
      Math.round(maxTris),
      budgets.maxTriangles,
      maxTris <= budgets.maxTriangles,
    );
    check(
      `device pixel ratio (${tier} cap)`,
      samples.dpr,
      budgets.dpr[tier],
      samples.dpr <= budgets.dpr[tier] + 1e-9,
    );
    if (swift) {
      skip(
        'frame time p95',
        `${p95.toFixed(2)} ms`,
        `${budgets.frameTimeP95Ms} ms`,
        `software GL (${samples.rendererName}): frame times are not representative of real GPUs; enforce on hardware`,
      );
    } else {
      check(
        'frame time p95',
        `${p95.toFixed(2)} ms`,
        `${budgets.frameTimeP95Ms} ms`,
        p95 <= budgets.frameTimeP95Ms,
      );
    }

    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    results.measured = {
      renderer: samples.rendererName,
      dpr: samples.dpr,
      trianglesMean: Math.round(meanTris),
      trianglesMax: Math.round(maxTris),
      frameMs: {
        mean: +mean.toFixed(2),
        p50: +pct(50).toFixed(2),
        p95: +p95.toFixed(2),
        p99: +pct(99).toFixed(2),
      },
      consoleErrors: results.errors.length,
    };
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  writeReport(results);
  printSummary(results);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`perf: harness error: ${err && err.stack ? err.stack : err}`);
  process.exit(2);
});
