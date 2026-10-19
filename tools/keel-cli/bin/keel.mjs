#!/usr/bin/env node
// keel — the KeelCode CLI. The primary vibe-code interface for the engine:
// scaffold, run, build, test, and smoke-test KeelCode games.
// Zero runtime dependencies; hand-rolled arg parsing on purpose.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const VERSION = '0.1.0';

function help() {
  console.log(`keel ${VERSION} — KeelCode's CLI

Usage:
  keel new <name>   Scaffold a game from the ts-three template into ./<name>/
  keel dev          Start the Vite dev server in the current project
  keel build        Type-check (tsc --noEmit) and build the project
  keel test         Run the vitest suite
  keel smoke        Run the framework smoke script (framework/smoke/smoke.mjs)
  keel --help       Show this help

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

// Copy a directory tree, skipping node_modules and dist.
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) {
      copyTree(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

function cmdNew(name) {
  if (!name) {
    console.error('keel new needs a name: keel new my-game');
    process.exit(1);
  }
  const root = findRepoRoot();
  const template = join(root, 'backends', 'ts-three');
  if (!existsSync(join(template, 'package.json'))) {
    console.error('Template not found: ' + template + ' — has Wave 1 built it yet?');
    process.exit(1);
  }
  const dest = resolve(process.cwd(), name);
  if (existsSync(dest)) {
    console.error('Already exists: ' + dest);
    process.exit(1);
  }
  copyTree(template, dest);
  const pkgPath = join(dest, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.name = dest.split('/').pop();
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('Created ' + dest);
  console.log('Next: cd ' + name + ' && npm install && keel dev');
}

function run(cmd, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} exited ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  const [, , sub, ...rest] = process.argv;
  try {
    switch (sub) {
      case 'new':
        cmdNew(rest[0]);
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
        await run(process.execPath, [smoke], root);
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
    process.exit(1);
  }
}

main();
