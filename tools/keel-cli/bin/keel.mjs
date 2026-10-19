#!/usr/bin/env node
// keel — the KeelCode CLI. The primary vibe-code interface for the engine:
// scaffold, run, build, test, and smoke-test KeelCode games.
// Zero runtime dependencies; hand-rolled arg parsing on purpose.
//
// Wave 4 surface: new --backend <ts-three|ts-babylon|rs-core>, perf,
// vectors, bake (asset-baker passthrough), room (safe-room passthrough),
// and backend-aware smoke passthrough. These commands WRAP the 4a smoke
// script, the 4b baker, and the pipeline room — they never edit them.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const VERSION = '0.2.0';

const VALID_BACKENDS = ['ts-three', 'ts-babylon', 'rs-core'];

function help() {
  console.log(`keel ${VERSION} — KeelCode's CLI

Usage:
  keel new <name> [--backend ts-three|ts-babylon|rs-core]
      Scaffold a game into ./<name>/ (default backend: ts-three)
  keel dev                                Start the Vite dev server in the current project
  keel build                              Type-check (tsc --noEmit) and build the project
  keel test                               Run the vitest suite
  keel smoke [--backend <name>] [--json] [--skip-e2e]
      Run the framework smoke script; flags are forwarded verbatim
      (no flags = all three backends)
  keel perf [--backend <name>]
      Run the perf harness for a backend (default: ts-three, then ts-babylon)
  keel vectors [--backend <name>]
      Record (or list) parity vector files for a backend
      (default: ts-three, then ts-babylon)
  keel bake <asset-dir> [--out <dir>] [--strict] [--budget <file>]
      Bake an asset dir into dist + asset-manifest.json (forwards to asset-baker)
  keel room <init|merge|audit|report|status|clean>
      Exec the pipeline safe-room runner
  keel --help                             Show this help

keel finds the KeelCode repo root by walking up from the current directory
until it sees framework/SPEC.md. Project commands run in the nearest
directory that has a package.json (a scaffolded game).`);
}

// Walk up from cwd until we find framework/SPEC.md. Throws if none found.
function findRepoRoot(start = process.cwd()) {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, 'framework', 'SPEC.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Not inside a KeelCode repo: no framework/SPEC.md found walking up from ' + start);
    }
    dir = parent;
  }
}

// Walk up from cwd until we find package.json (the scaffolded game).
function findProjectRoot(start = process.cwd()) {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('Not inside a KeelCode project: no package.json found walking up from ' + start);
    }
    dir = parent;
  }
}

// Copy a directory tree, skipping node_modules, dist, and target.
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'target') continue;
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) {
      copyTree(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

function flagValue(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function checkBackend(name) {
  if (!VALID_BACKENDS.includes(name)) {
    console.error(`keel: unknown backend "${name}". Valid: ${VALID_BACKENDS.join(', ')}`);
    process.exit(1);
  }
}

function cmdNew(name, rest) {
  if (!name) {
    console.error('keel new needs a name: keel new my-game');
    process.exit(1);
  }
  const backend = flagValue(rest, '--backend') || 'ts-three';
  checkBackend(backend);
  const root = findRepoRoot();
  const template = join(root, 'backends', backend);
  if (!existsSync(template)) {
    console.error('Backend not found: ' + template);
    process.exit(1);
  }
  const dest = resolve(process.cwd(), name);
  if (existsSync(dest)) {
    console.error('Already exists: ' + dest);
    process.exit(1);
  }
  copyTree(template, dest);
  const projName = dest.split('/').pop();
  if (backend === 'rs-core') {
    // Rewrite the `name =` line under [package] in the top-level Cargo.toml.
    const cargoPath = join(dest, 'Cargo.toml');
    const lines = readFileSync(cargoPath, 'utf8').split('\n');
    let inPackage = false;
    let renamed = false;
    for (let i = 0; i < lines.length && !renamed; i++) {
      const t = lines[i].trim();
      if (t === '[package]') { inPackage = true; continue; }
      if (inPackage && t.startsWith('[')) break;
      if (inPackage && /^name\s*=/.test(lines[i])) {
        lines[i] = `name = "${projName}"`;
        renamed = true;
      }
    }
    if (!renamed) {
      console.error('keel new: could not find [package] name in ' + cargoPath);
      process.exit(1);
    }
    writeFileSync(cargoPath, lines.join('\n'));
  } else {
    const pkgPath = join(dest, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.name = projName;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
  console.log(`Created ${dest} (backend: ${backend})`);
  if (backend === 'rs-core') {
    console.log(`Next: cd ${name} && cargo build`);
  } else {
    console.log(`Next: cd ${name} && npm install && keel dev`);
  }
}

function run(cmd, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} exited ${code}`))));
    child.on('error', reject);
  });
}

// Like run(), but propagates the child's exit code verbatim instead of
// collapsing it to 1 — so wrapped tools' documented exit codes survive
// (e.g. smoke's 2 on an unknown --backend, room.sh's own usage errors).
function passthrough(cmd, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        const err = new Error(`${cmd} exited ${code}`);
        err.exitCode = code ?? 1;
        reject(err);
      }
    });
    child.on('error', reject);
  });
}

// Wait until http://localhost:port/ answers, or throw after maxMs.
// Mirrors the orchestration in framework/smoke/smoke.mjs (not imported).
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

async function ensureDist(root, backend) {
  // Mirror the 4a smoke script: a fresh checkout has no gitignored dist/,
  // and the perf harness (vite preview) needs a built app.
  const dir = join(root, 'backends', backend);
  if (!existsSync(join(dir, 'dist', 'index.html'))) {
    console.log(`keel perf: dist/ missing for ${backend} — running npm run build first`);
    await run('npm', ['run', 'build'], dir);
  }
}

async function cmdPerf(root, rest) {
  const backend = flagValue(rest, '--backend');
  const backends = backend ? [backend] : ['ts-three', 'ts-babylon'];
  for (const b of backends) checkBackend(b);
  for (const b of backends) {
    if (b === 'ts-three') {
      await ensureDist(root, b);
      await passthrough(process.execPath, [join(root, 'tools', 'perf-harness', 'perf.mjs'), '--tier', 'desktop'],
        join(root, 'backends', 'ts-three'));
    } else if (b === 'ts-babylon') {
      const babylon = join(root, 'backends', 'ts-babylon');
      await ensureDist(root, b);
      const server = spawn('npx', ['vite', 'preview', '--', '--port', '4174', '--strictPort'], {
        cwd: babylon,
        stdio: 'pipe',
      });
      try {
        await pollPreview(4174, 60000);
        await passthrough(process.execPath, [join(babylon, 'tools', 'perf-harness', 'measure.mjs')], babylon);
      } finally {
        server.kill('SIGTERM');
      }
    } else if (b === 'rs-core') {
      console.log('keel perf: no runnable perf harness for rs-core on headless (no GPU)');
    }
  }
}

async function cmdVectors(root, rest) {
  const backend = flagValue(rest, '--backend');
  const backends = backend ? [backend] : ['ts-three', 'ts-babylon'];
  for (const b of backends) checkBackend(b);
  for (const b of backends) {
    if (b === 'rs-core') {
      // rs-core consumes pre-recorded vectors; it does not record them.
      const dir = join(root, 'backends', 'rs-core', 'parity', 'scripts');
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
      for (const f of files) console.log(join(dir, f));
      if (files.length === 0) console.log('keel vectors: no pre-recorded vectors in ' + dir);
    } else {
      await ensureDist(root, b);
      await passthrough('npx', ['playwright', 'test', 'e2e/parity-record.spec.ts'], join(root, 'backends', b));
    }
  }
}

// Exec room.sh with the subcommand passed through, propagating its exit code.
function cmdRoom(root, sub) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(join(root, 'tools', 'pipeline', 'room', 'room.sh'), [sub], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        const err = new Error(`room.sh exited ${code}`);
        err.exitCode = code ?? 1;
        reject(err);
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  const [, , sub, ...rest] = process.argv;
  try {
    switch (sub) {
      case 'new':
        cmdNew(rest[0], rest.slice(1));
        break;
      case 'dev':
        await run('npx', ['vite'], findProjectRoot());
        break;
      case 'build':
        await run('npx', ['tsc', '--noEmit'], findProjectRoot());
        await run('npx', ['vite', 'build'], findProjectRoot());
        break;
      case 'test':
        await run('npx', ['vitest', 'run'], findProjectRoot());
        break;
      case 'smoke': {
        const root = findRepoRoot();
        const smoke = join(root, 'framework', 'smoke', 'smoke.mjs');
        if (!existsSync(smoke)) {
          console.error('Smoke script not written yet: ' + smoke + ' (another agent owns it)');
          process.exit(1);
        }
        await passthrough(process.execPath, [smoke, ...rest], root);
        break;
      }
      case 'perf': {
        const root = findRepoRoot();
        await cmdPerf(root, rest);
        break;
      }
      case 'vectors': {
        const root = findRepoRoot();
        await cmdVectors(root, rest);
        break;
      }
      case 'bake': {
        const root = findRepoRoot();
        const baker = join(root, 'tools', 'asset-baker', 'bake.mjs');
        if (!existsSync(baker)) {
          console.error('Asset baker not found: ' + baker);
          process.exit(1);
        }
        await passthrough(process.execPath, [baker, ...rest], root);
        break;
      }
      case 'room': {
        const root = findRepoRoot();
        await cmdRoom(root, rest[0]);
        break;
      }
      case '--help':
      case '-h':
      case undefined:
        help();
        break;
      default:
        console.error(`Unknown command: ${sub}`);
        help();
        process.exit(1);
    }
  } catch (err) {
    console.error('keel: ' + err.message);
    process.exit(err.exitCode ?? 1);
  }
}

main();
