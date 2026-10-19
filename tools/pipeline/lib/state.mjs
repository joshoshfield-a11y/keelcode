#!/usr/bin/env node
// Shared state helpers for the KeelCode pipeline.
// Zero dependencies. All state lives under tools/pipeline/state/ (on disk
// under ~, so it survives compaction and VM replacement).
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PIPELINE_ROOT = join(here, '..');
export const REPO_ROOT = join(here, '..', '..', '..');
export const STATE_DIR = join(PIPELINE_ROOT, 'state');

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Atomic write: temp file + rename, so a crashed tick never leaves half JSON.
export function writeJsonAtomic(path, obj) {
  const tmp = path + '.tmp.' + process.pid;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, path);
}

export function readConfig() {
  return readJson(join(PIPELINE_ROOT, 'config.json'));
}

export function readWaves() {
  return readJson(join(STATE_DIR, 'waves.json'));
}

export function writeWaves(doc) {
  writeJsonAtomic(join(STATE_DIR, 'waves.json'), doc);
}

export function gateResultPath(n) {
  return join(STATE_DIR, `wave-${n}-gates.json`);
}

export function readGateResult(n) {
  const p = gateResultPath(n);
  return existsSync(p) ? readJson(p) : null;
}

export function writeGateResult(n, obj) {
  writeJsonAtomic(gateResultPath(n), obj);
}

// A wave is launchable when: status queued, brief file exists, every
// earlier wave is green, and no other wave is in progress.
export function nextLaunchableWave(doc) {
  const waves = doc.waves;
  if (waves.some((w) => w.status === 'in_progress')) return { wave: null, reason: 'another wave in_progress' };
  for (const w of waves) {
    if (w.status === 'in_progress_external') continue; // not ours to touch
    if (w.status !== 'queued') continue;
    const predecessors = waves.filter((x) => x.n < w.n && x.status !== 'in_progress_external');
    if (!predecessors.every((x) => x.status === 'green')) {
      return { wave: null, reason: `wave ${w.n} blocked: predecessor not green` };
    }
    if (!w.brief) return { wave: null, reason: `wave ${w.n} awaiting brief (none assigned)` };
    // brief paths are home-relative ("workspace/game-kb/WAVE2-BRIEF.md")
    const home = process.env.HOME || '/home/hatch';
    if (!existsSync(join(home, w.brief))) {
      return { wave: null, reason: `wave ${w.n} awaiting brief (${w.brief} not found)` };
    }
    return { wave: w, reason: 'ok' };
  }
  return { wave: null, reason: 'no queued wave with brief and green predecessors' };
}

export function ensureStateDir() {
  mkdirSync(STATE_DIR, { recursive: true });
}
