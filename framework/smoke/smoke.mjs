#!/usr/bin/env node
/**
 * `keel smoke` entry (Wave 4): shared smoke suite for ALL THREE backends.
 *
 * Run from the keelcode repo root:
 *   node framework/smoke/smoke.mjs [--backend <ts-three|ts-babylon|rs-core>] [--json] [--skip-e2e]
 *
 * Default (no flags): all three backends, cheap -> expensive ordering
 *   (ts-three, rs-core, ts-babylon).
 *
 * Each stage gets a 20-minute timeout: the child is killed and the stage
 * fails on expiry. The script never hangs forever.
 *
 * Exits 0 only when every selected backend passes every stage; exits 1 on
 * the first failure, after printing a summary. Unknown --backend value ->
 * exit 2 with the valid list.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tsThree = path.join(root, 'backends', 'ts-three');
const tsBabylon = path.join(root, 'backends', 'ts-babylon');
const rsCore = path.join(root, 'backends', 'rs-core');
const harness = path.join(root, 'tools', 'perf-harness', 'perf.mjs');

const STAGE_TIMEOUT_MS = 20 * 60 * 1000;
const VALID_BACKENDS = ['ts-three', 'ts-babylon', 'rs-core'];

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);
let onlyBackend = null;
let jsonOut = false;
let skipE2E = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--backend') {
    onlyBackend = argv[++i];
    if (!VALID_BACKENDS.includes(onlyBackend)) {
      console.error(`smoke: unknown --backend "${onlyBackend}". Valid: ${VALID_BACKENDS.join(', ')}`);
      process.exit(2);
    }
  } else if (a === '--json') {
    jsonOut = true;
  } else if (a === '--skip-e2e') {
    skipE2E = true;
  } else {
    console.error(`smoke: unknown arg "${a}"`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------- runner

const results = {};

function printSummary() {
  console.log('\n===== keel smoke summary =====');
  for (const b of Object.keys(results)) {
    console.log(`-- ${b}: ${results[b].ok ? 'PASS' : 'FAIL'}`);
    for (const s of results[b].stages) {
      console.log(`   ${s.ok ? 'PASS' : 'FAIL'}  ${s.name}  (${s.ms} ms)`);
    }
  }
}

function run(cmd, args, cwd, env = process.env) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env, timeout: STAGE_TIMEOUT_MS });
}

function checkBackendDir(name, dir) {
  if (!existsSync(path.join(dir, 'package.json')) && !existsSync(path.join(dir, 'Cargo.toml'))) {
    console.error(`smoke: backend not found at ${dir}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- ts-three (stages verbatim)

function tsThreeStages() {
  return [
    ['build (tsc --noEmit && vite build)', () => run('npm', ['run', 'build'], tsThree)],
    ['assert dist/', () => {
      if (!existsSync(path.join(tsThree, 'dist', 'index.html'))) {
        throw new Error('dist/index.html missing after build');
      }
    }],
    ['unit tests (npx vitest run)', () => run('npx', ['vitest', 'run'], tsThree)],
    ['perf harness (desktop tier)', () => run('node', [harness, '--tier', 'desktop'], tsThree)],
  ];
}

// ---------------------------------------------------------------- ts-babylon

function pollPreview(port, maxMs) {
  const t0 = Date.now();
  return (async () => {
    for (;;) {
      try {
        const res = await fetch(`http://localhost:${port}/`);
        await res.text().catch(() => {});
        if (res.ok || res.status < 500) return;
      } catch { /* not up yet */ }
      if (Date.now() - t0 > maxMs) throw new Error(`vite preview on :${port} did not respond within ${maxMs} ms`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  })();
}

function tsBabylonStages() {
  return [
    ['tsc --noEmit', () => run('npx', ['tsc', '--noEmit'], tsBabylon)],
    ['vitest run', () => run('npx', ['vitest', 'run'], tsBabylon)],
    // DEVIATION from brief (reported): the playwright config's webServer
    // serves `vite preview`, which needs dist/. A fresh checkout/worktree
    // has no dist (gitignored), so e2e would time out waiting for the
    // server. Build first when dist is missing.
    ['build (npm run build, if dist missing)', () => {
      if (!existsSync(path.join(tsBabylon, 'dist', 'index.html'))) {
        run('npm', ['run', 'build'], tsBabylon);
      }
    }],
    [skipE2E ? 'e2e (skipped --skip-e2e)' : 'e2e (npx playwright test)', () => {
      if (!skipE2E) run('npx', ['playwright', 'test'], tsBabylon);
    }],
    [skipE2E ? 'vector replay (skipped --skip-e2e)' : 'vector replay (parity-record double-run)', () => {
      if (!skipE2E) run('npx', ['playwright', 'test', 'e2e/parity-record.spec.ts'], tsBabylon);
    }],
    ['perf (vite preview + measure.mjs)', async () => {
      if (!existsSync(path.join(tsBabylon, 'dist', 'index.html'))) {
        run('npm', ['run', 'build'], tsBabylon);
      }
      const server = spawn('npx', ['vite', 'preview', '--', '--port', '4174', '--strictPort'], {
        cwd: tsBabylon,
        stdio: 'pipe',
      });
      try {
        await pollPreview(4174, 60000);
        await new Promise((resolve, reject) => {
          try {
            execFileSync('node', [path.join(tsBabylon, 'tools', 'perf-harness', 'measure.mjs')], {
              cwd: tsBabylon,
              stdio: 'inherit',
              env: process.env,
              timeout: STAGE_TIMEOUT_MS,
            });
            resolve();
          } catch (err) {
            reject(err);
          }
        });
      } finally {
        server.kill('SIGTERM');
      }
    }],
  ];
}

// ---------------------------------------------------------------- rs-core

function rsCoreEnv(extra = {}) {
  return {
    ...process.env,
    PATH: `${path.join(os.homedir(), '.cargo', 'bin')}${path.delimiter}${process.env.PATH}`,
    CARGO_TARGET_DIR: path.join(os.homedir(), 'keelcode-target'),
    ...extra,
  };
}

function rsCoreStages() {
  const env = rsCoreEnv();
  return [
    ['cargo test', () => run('cargo', ['test'], rsCore, env)],
    ['cargo clippy (-D warnings)', () => run('cargo', ['clippy', '--all-targets', '--', '-D', 'warnings'], rsCore, env)],
    ['cargo fmt --check', () => run('cargo', ['fmt', '--check'], rsCore, env)],
    ['KEEL_PARITY_STRICT=1 cargo test --test parity', () =>
      run('cargo', ['test', '--test', 'parity'], rsCore, rsCoreEnv({ KEEL_PARITY_STRICT: '1' }))],
    ['perf (skip: no runnable perf harness on headless (no GPU))', () => {
      console.log('skip: no runnable perf harness on headless (no GPU)');
    }],
  ];
}

// ---------------------------------------------------------------- main

checkBackendDir('ts-three', tsThree);
checkBackendDir('ts-babylon', tsBabylon);
checkBackendDir('rs-core', rsCore);
if (!existsSync(harness)) {
  console.error(`smoke: perf harness not found at ${harness}`);
  process.exit(1);
}

const order = onlyBackend ? [onlyBackend] : ['ts-three', 'rs-core', 'ts-babylon'];
let allOk = true;
for (const b of order) {
  // ts-babylon's perf stage is async (preview server lifecycle); run
  // backends sequentially to keep console output readable.
  const defs = b === 'ts-three' ? tsThreeStages() : b === 'rs-core' ? rsCoreStages() : tsBabylonStages();
  let ok = true;
  const stages = [];
  console.log(`\n########## backend: ${b} ##########`);
  for (const [stageName, fn] of defs) {
    console.log(`\n### ${b}: ${stageName}`);
    const t0 = Date.now();
    try {
      await fn();
      const ms = Date.now() - t0;
      stages.push({ name: stageName, ok: true, ms });
      console.log(`ok (${ms} ms)`);
    } catch (err) {
      const ms = Date.now() - t0;
      stages.push({ name: stageName, ok: false, ms });
      console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
      ok = false;
      break;
    }
  }
  results[b] = { ok, stages };
  if (!ok) allOk = false;
}

printSummary();
if (jsonOut) {
  console.log(JSON.stringify({ ok: allOk, backends: results }));
}
console.log(allOk ? '\nkeel smoke: all stages passed' : '\nkeel smoke: FAILED');
process.exit(allOk ? 0 : 1);
