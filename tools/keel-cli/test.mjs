// keel CLI tests (node --test, stdlib only).
//
// Every new Wave 4 subcommand gets a happy path + one failure mode.
// No full builds, no e2e: subcommands run as child processes of
// bin/keel.mjs with cwd inside the repo worktree, so findRepoRoot
// resolves to the worktree.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const keel = new URL('./bin/keel.mjs', import.meta.url).pathname;
const repoRoot = new URL('../..', import.meta.url).pathname; // worktree root (cwd when spawning)

function runKeel(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [keel, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
  });
}

function scratchDir(prefix) {
  return join(tmpdir(), prefix + '-' + process.pid + '-' + Date.now());
}

describe('keel new', () => {
  it('scaffolds ts-babylon and rewrites package.json name', async () => {
    const dir = scratchDir('keel-new-test');
    const name = dir.split('/').pop();
    try {
      const r = await runKeel(['new', dir, '--backend', 'ts-babylon']);
      assert.equal(r.code, 0, r.stderr);
      const pkgPath = join(dir, 'package.json');
      assert.ok(existsSync(pkgPath), 'package.json exists in scaffold');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      assert.equal(pkg.name, name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--backend bogus exits 1', async () => {
    const r = await runKeel(['new', scratchDir('keel-new-bogus'), '--backend', 'bogus']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown backend/);
  });

  it('defaults to ts-three without --backend', async () => {
    const dir = scratchDir('keel-new-def');
    const name = dir.split('/').pop();
    try {
      const r = await runKeel(['new', dir]);
      assert.equal(r.code, 0, r.stderr);
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      assert.equal(pkg.name, name);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('keel perf', () => {
  it('--backend bogus exits 1 without running any harness', async () => {
    const r = await runKeel(['perf', '--backend', 'bogus']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown backend/);
  });
});

describe('keel vectors', () => {
  it('--backend rs-core exits 0 and names parity/scripts', async () => {
    const r = await runKeel(['vectors', '--backend', 'rs-core']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /parity\/scripts/);
  });

  it('--backend bogus exits 1', async () => {
    const r = await runKeel(['vectors', '--backend', 'bogus']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /unknown backend/);
  });
});

describe('keel bake', () => {
  it('bakes the 4b sample-assets to a scratch dir', async () => {
    const out = scratchDir('keel-bake-test');
    try {
      const r = await runKeel([
        'bake',
        join(repoRoot, 'tools', 'asset-baker', 'sample-assets'),
        '--out', out,
      ]);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(existsSync(join(out, 'asset-manifest.json')), 'asset-manifest.json emitted');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('keel room', () => {
  it('status exits 0 (room.sh runs; exit code propagated)', async () => {
    const r = await runKeel(['room', 'status']);
    assert.equal(r.code, 0, r.stderr);
  });
});

describe('keel smoke', () => {
  it('--backend bogus exits 2 (proves flag forwarding; smoke rejects the name)', async () => {
    const r = await runKeel(['smoke', '--backend', 'bogus']);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /unknown --backend/);
  });
});

describe('keel --help', () => {
  it('documents every new subcommand', async () => {
    const r = await runKeel(['--help']);
    assert.equal(r.code, 0, r.stderr);
    for (const word of ['new', 'perf', 'vectors', 'bake', 'room', 'smoke', 'dev', 'build', 'test']) {
      assert.match(r.stdout, new RegExp(`\\b${word}\\b`), `help mentions ${word}`);
    }
  });
});
