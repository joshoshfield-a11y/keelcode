#!/usr/bin/env node
// smoke.test.mjs — contract tests for `framework/smoke/smoke.mjs --json`
// (Wave 5). Run: node --test framework/smoke/smoke.test.mjs
//
// These run the REAL smoke script (backend stages execute for real; the
// warm cargo target dir and existing dist/ keep repeat runs fast) and
// assert the JSON summary's shape — in particular that every stage entry
// carries an explicit boolean "skipped", and that stages which did not
// run report skipped: true:
//   - ts-babylon e2e + vector replay under --skip-e2e
//   - the rs-core perf no-op (no GPU on headless), always
// Human (non-JSON) output is not asserted here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const SMOKE = join(HERE, 'smoke.mjs');
const ROOT = join(HERE, '..', '..');

const LONG = { timeout: 45 * 60 * 1000 };

function runSmoke(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [SMOKE, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

// The --json summary is printed as a single JSON line after the human log.
function parseSummary(stdout) {
  const lines = stdout.split('\n').filter((l) => l.startsWith('{'));
  assert.ok(lines.length >= 1, 'smoke --json printed a JSON summary line');
  return JSON.parse(lines[lines.length - 1]);
}

function assertShape(summary, backends) {
  assert.equal(typeof summary.ok, 'boolean');
  assert.equal(summary.ok, true, 'smoke run passed');
  assert.deepEqual(Object.keys(summary.backends).sort(), [...backends].sort());
  for (const b of backends) {
    const rec = summary.backends[b];
    assert.equal(rec.ok, true, `${b} passed`);
    assert.ok(Array.isArray(rec.stages) && rec.stages.length >= 1, `${b} has stages`);
    for (const s of rec.stages) {
      assert.equal(typeof s.name, 'string', `${b} stage has a name`);
      assert.equal(s.ok, true, `${b} stage "${s.name}" passed`);
      assert.equal(typeof s.ms, 'number', `${b} stage "${s.name}" has ms`);
      assert.equal(typeof s.skipped, 'boolean', `${b} stage "${s.name}" has boolean skipped`);
    }
  }
}

function stage(summary, backend, namePart) {
  const s = summary.backends[backend].stages.find((st) => st.name.includes(namePart));
  assert.ok(s, `${backend} has a stage matching "${namePart}"`);
  return s;
}

describe('smoke --json contract', () => {
  it('rs-core: perf stage is skipped:true, all real stages skipped:false', LONG, async () => {
    const r = await runSmoke(['--backend', 'rs-core', '--json']);
    assert.equal(r.code, 0, r.stderr.slice(-2000));
    const summary = parseSummary(r.stdout);
    assertShape(summary, ['rs-core']);
    assert.equal(stage(summary, 'rs-core', 'perf').skipped, true);
    for (const s of summary.backends['rs-core'].stages) {
      if (!s.name.includes('perf')) assert.equal(s.skipped, false, `"${s.name}" not skipped`);
    }
  });

  it('ts-babylon --skip-e2e: e2e and vector replay are skipped:true', LONG, async () => {
    const r = await runSmoke(['--backend', 'ts-babylon', '--skip-e2e', '--json']);
    assert.equal(r.code, 0, r.stderr.slice(-2000));
    const summary = parseSummary(r.stdout);
    assertShape(summary, ['ts-babylon']);
    assert.equal(stage(summary, 'ts-babylon', 'e2e').skipped, true);
    assert.equal(stage(summary, 'ts-babylon', 'vector replay').skipped, true);
    assert.equal(stage(summary, 'ts-babylon', 'perf').skipped, false);
    assert.equal(stage(summary, 'ts-babylon', 'vitest').skipped, false);
  });

  it('all backends --skip-e2e --json: shape holds for every backend', LONG, async () => {
    const r = await runSmoke(['--skip-e2e', '--json']);
    assert.equal(r.code, 0, r.stderr.slice(-2000));
    const summary = parseSummary(r.stdout);
    assertShape(summary, ['ts-three', 'rs-core', 'ts-babylon']);
    // ts-three has no skippable stages.
    for (const s of summary.backends['ts-three'].stages) {
      assert.equal(s.skipped, false, `ts-three "${s.name}" not skipped`);
    }
    assert.equal(stage(summary, 'rs-core', 'perf').skipped, true);
    assert.equal(stage(summary, 'ts-babylon', 'e2e').skipped, true);
    assert.equal(stage(summary, 'ts-babylon', 'vector replay').skipped, true);
  });
});
