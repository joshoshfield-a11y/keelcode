#!/usr/bin/env node
// test.mjs — asset-baker CLI tests. node stdlib only.
//
//   node --test tools/asset-baker/test.mjs
//
// Uses a /tmp scratch dir for every --out. Covers:
//   - happy path: bake sample-assets -> manifest exists, every entry
//     hand-validates against the schema, dist files exist, dist hashes match
//   - failure mode: nonexistent asset dir -> exit 1
//   - unknown extensions skipped with a printed warning (not a failure)
//   - budget hook: warning exits 0 by default, exit 1 with --strict
//   - ids violating the schema pattern fail the run with exit 1

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const BAKE = join(HERE, 'bake.mjs');
const SAMPLES = join(HERE, 'sample-assets');

const ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/;
const HEX64 = /^[0-9a-f]{64}$/;

function scratch(name) {
  const dir = join('/tmp', 'asset-baker-test', name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runBake(srcDir, outDir, extra = []) {
  return spawnSync(process.execPath, [BAKE, srcDir, '--out', outDir, ...extra], {
    encoding: 'utf8',
  });
}

function validateEntry(e) {
  for (const f of ['id', 'type', 'source_hash', 'dist_hash', 'lod_tiers', 'budget_cost']) {
    assert.ok(f in e, `missing field ${f}`);
  }
  assert.ok(typeof e.id === 'string' && ID_PATTERN.test(e.id), `bad id: ${e.id}`);
  assert.ok(['mesh', 'texture', 'audio', 'atlas'].includes(e.type), `bad type: ${e.type}`);
  assert.ok(HEX64.test(e.source_hash), `bad source_hash: ${e.source_hash}`);
  assert.ok(HEX64.test(e.dist_hash), `bad dist_hash: ${e.dist_hash}`);
  assert.ok(Array.isArray(e.lod_tiers) && e.lod_tiers.length >= 1, 'bad lod_tiers');
  assert.ok(typeof e.budget_cost === 'number' && Number.isFinite(e.budget_cost), 'bad budget_cost');
}

test('happy path: bake sample-assets, manifest validates, dist hashes match', () => {
  const out = scratch('happy');
  const r = runBake(SAMPLES, out, ['--strict']);
  assert.equal(r.status, 0, `bake failed: ${r.stderr}\n${r.stdout}`);

  const manifestPath = join(out, 'asset-manifest.json');
  assert.ok(existsSync(manifestPath), 'manifest written');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.ok(Array.isArray(manifest.assets));
  assert.equal(manifest.assets.length, 2, 'two sample assets baked');

  const ids = manifest.assets.map((e) => e.id).sort();
  assert.deepEqual(ids, ['chars/scout/jacket-blue', 'chars/scout/jacket-red']);

  for (const e of manifest.assets) {
    validateEntry(e);
    assert.equal(e.type, 'texture');
    // dist file exists on disk and re-hashes to the recorded dist_hash
    const distPath = join(out, e.id + '.png');
    assert.ok(existsSync(distPath), `dist file exists for ${e.id}`);
    const reHash = spawnSync(process.execPath, ['-e',
      `console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(${JSON.stringify(distPath)})).digest("hex"))`,
    ], { encoding: 'utf8' });
    assert.equal(reHash.stdout.trim(), e.dist_hash, `dist hash matches for ${e.id}`);
    // budget_cost = dist file size in KB, 1 decimal
    const expected = Math.round((statSync(distPath).size / 1024) * 10) / 10;
    assert.equal(e.budget_cost, expected, `budget_cost matches for ${e.id}`);
  }
  // no converters on the bake machine -> copy-through lod tier
  for (const e of manifest.assets) {
    assert.deepEqual(e.lod_tiers, ['src']);
  }
  assert.match(r.stdout, /validation passed/);
});

test('failure mode: nonexistent asset dir exits 1', () => {
  const out = scratch('missing');
  const r = runBake(join(out, 'does-not-exist'), out);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}`);
  assert.match(r.stderr, /asset dir not found/);
});

test('unknown extensions are skipped with a warning, not a failure', () => {
  const src = scratch('unknown-src');
  const tree = join(src, 'chars', 'scout');
  mkdirSync(tree, { recursive: true });
  const png = join(SAMPLES, 'chars', 'scout', 'jacket-blue.png');

  copyFileSync(png, join(tree, 'jacket-blue.png'));
  writeFileSync(join(tree, 'notes.txt'), 'not an asset');
  const out = scratch('unknown-out');
  const r = runBake(src, out);
  assert.equal(r.status, 0, `bake failed: ${r.stderr}`);
  assert.match(r.stderr + r.stdout, /skipping unsupported extension/);
  const manifest = JSON.parse(readFileSync(join(out, 'asset-manifest.json'), 'utf8'));
  assert.equal(manifest.assets.length, 1);
  assert.equal(manifest.assets[0].id, 'chars/scout/jacket-blue');
});

test('budget hook: warning by default, failure with --strict', () => {
  const out = scratch('budget');
  const budgets = join(out, 'budgets.json');
  writeFileSync(budgets, JSON.stringify({ asset_kb_warn: 0.01 })); // absurdly low -> always exceeds
  const rWarn = runBake(SAMPLES, join(out, 'w'), ['--budget', budgets]);
  assert.equal(rWarn.status, 0, `warning should exit 0: ${rWarn.stderr}`);
  assert.match(rWarn.stderr + rWarn.stdout, /BUDGET WARNING/);
  const rStrict = runBake(SAMPLES, join(out, 's'), ['--budget', budgets, '--strict']);
  assert.equal(rStrict.status, 1, `strict over-budget should exit 1: ${rStrict.stderr}`);
  assert.match(rStrict.stderr, /BUDGET WARNING/);
});

test('id violating the schema pattern fails the run with exit 1', () => {
  const src = scratch('badid-src');
  const tree = join(src, 'chars', 'SCOUT'); // uppercase -> violates [a-z0-9-]
  mkdirSync(tree, { recursive: true });

  copyFileSync(join(SAMPLES, 'chars', 'scout', 'jacket-blue.png'), join(tree, 'jacket-blue.png'));
  const r = runBake(src, scratch('badid-out'));
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}`);
  assert.match(r.stderr, /fails schema pattern/);
});

test('default --out lands at <asset-dir>/../dist', () => {
  const base = scratch('default-out');
  const src = join(base, 'assets', 'src', 'chars', 'scout');
  mkdirSync(src, { recursive: true });

  copyFileSync(join(SAMPLES, 'chars', 'scout', 'jacket-blue.png'), join(src, 'jacket-blue.png'));
  const assetDir = join(base, 'assets', 'src');
  const r = spawnSync(process.execPath, [BAKE, assetDir], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bake failed: ${r.stderr}`);
  const expected = join(base, 'assets', 'dist', 'asset-manifest.json');
  assert.ok(existsSync(expected), `manifest at default location: ${expected}`);
});

console.log('asset-baker tests done');
