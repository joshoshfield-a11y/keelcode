// keel CLI tests (node --test, stdlib only).
//
// Every new Wave 4 subcommand gets a happy path + one failure mode.
// No full builds, no e2e: subcommands run as child processes of
// bin/keel.mjs with cwd inside the repo worktree, so findRepoRoot
// resolves to the worktree.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

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

// Like runKeel, but with an explicit cwd (and optional env overrides) —
// project commands (dev/build/test) resolve the project from cwd.
function runKeelIn(cwd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [keel, ...args], {
      cwd,
      env: { ...process.env, ...env },
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

// cargo lives in ~/.cargo/bin, which is not on the default PATH here.
const CARGO_ENV = { PATH: join(homedir(), '.cargo', 'bin') + ':' + process.env.PATH };

// Write a zero-dependency cargo fixture project shaped like an rs-core
// scaffold: a headless bin + a keel-desktop bin + a lib with one test.
// `bad` flips it: the bin exits 3 and the lib test fails.
function writeCargoFixture(dir, { bad = false } = {}) {
  mkdirSync(join(dir, 'src', 'bin'), { recursive: true });
  writeFileSync(join(dir, 'Cargo.toml'), `[package]
name = "keel-fixture"
version = "0.1.0"
edition = "2021"

[lib]
name = "keel_fixture"
path = "src/lib.rs"

[[bin]]
name = "keel-fixture"
path = "src/main.rs"

[[bin]]
name = "keel-desktop"
path = "src/bin/keel-desktop.rs"
`);
  writeFileSync(join(dir, 'src', 'lib.rs'), `pub fn answer() -> i32 { 42 }

#[cfg(test)]
mod tests {
    #[test]
    fn answer_is_42() {
        assert_eq!(super::answer(), ${bad ? '0' : '42'});
    }
}
`);
  writeFileSync(join(dir, 'src', 'main.rs'), bad
    ? 'fn main() { std::process::exit(3); }\n'
    : 'fn main() { println!("keel-fixture headless online"); }\n');
  writeFileSync(join(dir, 'src', 'bin', 'keel-desktop.rs'),
    'fn main() { println!("keel-fixture DESKTOP bin — keel dev must not run this"); }\n');
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

describe('keel dev/build/test in a cargo project (Wave 5)', () => {
  const CARGO_TIMEOUT = { timeout: 240000 };

  it('build routes to cargo build and exits 0', CARGO_TIMEOUT, async () => {
    const dir = scratchDir('keel-cargo-build');
    writeCargoFixture(dir);
    try {
      const r = await runKeelIn(dir, ['build'], CARGO_ENV);
      assert.equal(r.code, 0, r.stderr);
      assert.ok(existsSync(join(dir, 'target', 'debug', 'keel-fixture')), 'cargo produced the bin');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('test routes to cargo test and exits 0', CARGO_TIMEOUT, async () => {
    const dir = scratchDir('keel-cargo-test');
    writeCargoFixture(dir);
    try {
      const r = await runKeelIn(dir, ['test'], CARGO_ENV);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout + r.stderr, /answer_is_42/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dev runs the headless bin, not keel-desktop, and prints the desktop note', CARGO_TIMEOUT, async () => {
    const dir = scratchDir('keel-cargo-dev');
    writeCargoFixture(dir);
    try {
      const r = await runKeelIn(dir, ['dev'], CARGO_ENV);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /keel-fixture headless online/);
      assert.doesNotMatch(r.stdout, /DESKTOP bin/);
      assert.match(r.stdout, /desktop renderer is a separate binary/);
      assert.match(r.stdout, /cargo run --bin keel-desktop/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('dev propagates the bin exit code verbatim (3, not collapsed to 1)', CARGO_TIMEOUT, async () => {
    const dir = scratchDir('keel-cargo-dev-bad');
    writeCargoFixture(dir, { bad: true });
    try {
      const r = await runKeelIn(dir, ['dev'], CARGO_ENV);
      assert.equal(r.code, 3, `expected 3, got ${r.code}: ${r.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('test propagates cargo test failure code verbatim (101)', CARGO_TIMEOUT, async () => {
    const dir = scratchDir('keel-cargo-test-bad');
    writeCargoFixture(dir, { bad: true });
    try {
      const r = await runKeelIn(dir, ['test'], CARGO_ENV);
      assert.equal(r.code, 101, `expected 101, got ${r.code}: ${r.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
