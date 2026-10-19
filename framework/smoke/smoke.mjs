#!/usr/bin/env node
/**
 * `keel smoke` entry (Wave 1): build -> unit tests -> perf harness.
 *
 * Run from the keelcode repo root:
 *   node framework/smoke/smoke.mjs
 *
 * Stages:
 *   1. `npm run build` in backends/ts-three (tsc --noEmit && vite build)
 *   2. assert dist/index.html exists
 *   3. `npx vitest run` in backends/ts-three
 *   4. perf harness (tools/perf-harness/perf.mjs, desktop tier)
 *
 * Exits 0 only when every stage passes; exits 1 on the first failure,
 * after printing a summary.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tsThree = path.join(root, 'backends', 'ts-three');
const harness = path.join(root, 'tools', 'perf-harness', 'perf.mjs');

const stages = [];

function printSummary() {
  console.log('\n===== keel smoke summary =====');
  for (const s of stages) {
    console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}  (${s.ms} ms)`);
  }
}

function stage(name, fn) {
  console.log(`\n### ${name}`);
  const t0 = Date.now();
  try {
    fn();
    const ms = Date.now() - t0;
    stages.push({ name, ok: true, ms });
    console.log(`ok (${ms} ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    stages.push({ name, ok: false, ms });
    console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    printSummary();
    process.exit(1);
  }
}

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', env: process.env });
}

if (!existsSync(path.join(tsThree, 'package.json'))) {
  console.error(`smoke: backend not found at ${tsThree}`);
  process.exit(1);
}
if (!existsSync(harness)) {
  console.error(`smoke: perf harness not found at ${harness}`);
  process.exit(1);
}

stage('build (tsc --noEmit && vite build)', () => run('npm', ['run', 'build'], tsThree));

stage('assert dist/', () => {
  if (!existsSync(path.join(tsThree, 'dist', 'index.html'))) {
    throw new Error('dist/index.html missing after build');
  }
});

stage('unit tests (npx vitest run)', () => run('npx', ['vitest', 'run'], tsThree));

stage('perf harness (desktop tier)', () => run('node', [harness, '--tier', 'desktop'], tsThree));

printSummary();
console.log('\nkeel smoke: all stages passed');
process.exit(0);
