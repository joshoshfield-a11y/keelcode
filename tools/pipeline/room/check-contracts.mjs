#!/usr/bin/env node
/**
 * Room contract checker — automated gates + static SPEC conformance per backend.
 *
 * READ-ONLY: never modifies any backend. Cheap checks run first and
 * short-circuit each backend (gate-first discipline, see
 * docs/PIPELINE/SWARM-COST-RESEARCH.md M3).
 *
 * Usage:
 *   node check-contracts.mjs [--backend <name>] [--with-e2e] [--with-clippy]
 *                            [--component <relpath>] [--out <dir>]
 *
 * --component scopes the STATIC checks to one file (targeted re-audit);
 * gates still run whole-backend (they are the cheap safety net).
 *
 * Exit: 0 when every checked backend passes, 1 otherwise.
 * Writes out/<backend>.json per backend (machine-readable).
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '..', '..', '..');
const BACKENDS = join(REPO, 'backends');

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const flag = (k) => args.includes(k);
const onlyBackend = opt('--backend');
const outDir = resolve(opt('--out') || join(here, 'out'));
const componentScope = opt('--component');
mkdirSync(outDir, { recursive: true });

function run(cmd, cwd, env) {
  try {
    const out = execFileSync('sh', ['-c', cmd], {
      cwd, encoding: 'utf8', timeout: 600000,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, tail: out.trim().split('\n').slice(-10).join('\n') };
  } catch (e) {
    const tail = ((e.stdout || '') + '\n' + (e.stderr || '')).trim().split('\n').slice(-15).join('\n');
    return { ok: false, tail };
  }
}

function listFiles(dir, exts, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (f === 'node_modules' || f === 'target' || f === 'dist') continue;
      listFiles(p, exts, acc);
    } else if (exts.some((e) => f.endsWith(e))) acc.push(p);
  }
  return acc;
}

function componentNames() {
  const schema = JSON.parse(readFileSync(join(REPO, 'framework', 'schema', 'component.schema.json'), 'utf8'));
  return schema.$defs.componentName.enum; // canonical list — the schema is the source of truth
}

// ---- static checks -------------------------------------------------------

function checkKeelSurface(backendDir, backendName, files) {
  // rs-core is headless: its debug surface is the keel-rs CLI + demo module,
  // not window.__keel (a browser-backend contract).
  if (backendName === 'rs-core') {
    const cargo = readFileSync(join(backendDir, 'Cargo.toml'), 'utf8');
    const hasBin = /keel-rs/.test(cargo) || existsSync(join(backendDir, 'src', 'demo.rs'));
    return hasBin
      ? { pass: true, detail: 'headless debug surface: keel-rs CLI + demo module (no window.__keel by design)' }
      : { pass: false, detail: 'no keel-rs binary or demo module found' };
  }
  const keys = ['world', 'loop', 'input', 'playerId', 'renderer'];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const i = src.indexOf('__keel');
    if (i < 0) continue;
    const window_ = src.slice(Math.max(0, i - 200), i + 1200);
    const missing = keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(window_));
    return { pass: missing.length === 0, detail: missing.length ? `missing keys: ${missing.join(', ')} in ${f}` : `__keel exposes all 5 keys (${f})` };
  }
  return { pass: false, detail: 'no __keel surface found in backend sources' };
}

function checkComponents(backendDir, files, names) {
  const hay = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const missing = names.filter((n) => !new RegExp(`\\b${n}\\b`).test(hay));
  // Coverage is a SIGNAL, not a gate: the schema defines field shapes for
  // components a backend uses; a demo that needs no Script component is not
  // in violation. Unreferenced components go to `gaps` for the audit agent
  // to triage (see audit-agent-brief.md §5), not to the fail column.
  return {
    pass: true,
    detail: `${names.length - missing.length}/${names.length} schema components referenced`,
    gaps: missing,
  };
}

function checkPhysicsBoundary(backendDir, files) {
  const hay = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  // camelCase (TS backends) or snake_case (Rust) — same driver boundary.
  const pairs = [['setVelocity', 'set_velocity'], ['setKinematicPosition', 'set_kinematic_position']];
  const missing = pairs.filter(([a, b]) => !hay.includes(a) && !hay.includes(b)).map(([a]) => a);
  return {
    pass: missing.length === 0,
    detail: missing.length ? `driver boundary missing: ${missing.join(', ')}` : 'driver boundary (setVelocity, setKinematicPosition) present',
  };
}

function checkPerf(backendDir, backendName) {
  // Prefer backend-local perf report, fall back to repo-root (Wave 1 layout).
  const candidates = [
    join(backendDir, 'tools', 'perf-harness', 'PERF.md'),
    join(backendDir, 'PERF.md'),
    join(REPO, 'tools', 'perf-harness', 'PERF.md'),
  ];
  const perfFile = candidates.find(existsSync);
  if (!perfFile) return { pass: true, detail: 'no PERF.md found — unmeasured (not a fail)', skip: true };
  const md = readFileSync(perfFile, 'utf8');
  // FAIL verdicts live in markdown table cells ("| FAIL |"); the prose
  // binding-rule sentence also contains the word FAIL — don't match that.
  const failRows = md.split('\n').filter((l) => /^\s*\|.*\|\s*FAIL\s*\|/.test(l));
  if (failRows.length) {
    return { pass: false, detail: `perf FAIL in ${perfFile}: ${failRows.slice(0, 3).join(' | ').trim()}` };
  }
  return { pass: true, detail: `no FAIL in ${perfFile}` };
}

// ---- gates (cheap -> expensive) ------------------------------------------

function gateTsc(backendDir) {
  const r = run('npx tsc --noEmit', backendDir);
  return { name: 'tsc --noEmit', ...r };
}
function gateVitest(backendDir) {
  const r = run('npx vitest run', backendDir);
  return { name: 'vitest run', ...r };
}
function gateE2e(backendDir) {
  const r = run('npx playwright test', backendDir);
  return { name: 'playwright e2e', ...r };
}
function gateCargoTest(backendDir) {
  const cargo = join(process.env.HOME || '/home/hatch', '.cargo', 'bin');
  const r = run('cargo test', backendDir, { PATH: `${cargo}:${process.env.PATH}` });
  return { name: 'cargo test', ...r };
}
function gateClippy(backendDir) {
  const cargo = join(process.env.HOME || '/home/hatch', '.cargo', 'bin');
  const r = run('cargo clippy --all-targets', backendDir, { PATH: `${cargo}:${process.env.PATH}` });
  return { name: 'cargo clippy', ...r };
}

// ---- per-backend ----------------------------------------------------------

function checkBackend(name) {
  const dir = join(BACKENDS, name);
  const result = { backend: name, gates: [], static: {}, pass: true };
  const fail = (why) => { result.pass = false; result.failedAt = why; };

  const isTs = existsSync(join(dir, 'package.json'));
  const isRs = existsSync(join(dir, 'Cargo.toml'));

  // Gates first (short-circuit).
  if (isTs) {
    const g1 = gateTsc(dir); result.gates.push({ name: g1.name, pass: g1.ok, tail: g1.tail });
    if (!g1.ok) { fail('tsc'); return result; }
    const g2 = gateVitest(dir); result.gates.push({ name: g2.name, pass: g2.ok, tail: g2.tail });
    if (!g2.ok) { fail('vitest'); return result; }
    if (flag('--with-e2e')) {
      const g3 = gateE2e(dir); result.gates.push({ name: g3.name, pass: g3.ok, tail: g3.tail });
      if (!g3.ok) { fail('e2e'); return result; }
    }
  }
  if (isRs) {
    const g1 = gateCargoTest(dir); result.gates.push({ name: g1.name, pass: g1.ok, tail: g1.tail });
    if (!g1.ok) { fail('cargo test'); return result; }
    if (flag('--with-clippy')) {
      const g2 = gateClippy(dir); result.gates.push({ name: g2.name, pass: g2.ok, tail: g2.tail });
      if (!g2.ok) { fail('clippy'); return result; }
    }
  }
  if (!isTs && !isRs) {
    result.gates.push({ name: 'detect', pass: false, tail: 'no package.json or Cargo.toml' });
    fail('detect'); return result;
  }

  // Static checks (scoped to --component when given).
  const exts = isTs ? ['.ts'] : ['.rs'];
  let files = listFiles(join(dir, 'src'), exts);
  if (componentScope) {
    const scoped = resolve(dir, componentScope);
    files = files.filter((f) => f === scoped);
    if (!files.length) {
      result.static.scope = { pass: false, detail: `component not found: ${componentScope}` };
      fail('scope'); return result;
    }
  }
  const names = componentNames();
  if (componentScope) {
    // Targeted re-audit: only file-meaningful checks run; backend-wide
    // checks are SKIP (they cannot pass on a single file by construction).
    const scopedNote = 'backend-wide check — SKIP in single-file scope';
    result.static.keelSurface = { pass: true, skip: true, detail: scopedNote };
    result.static.physicsBoundary = { pass: true, skip: true, detail: scopedNote };
    result.static.components = checkComponents(dir, files, names);
    result.static.perf = checkPerf(dir, name);
  } else {
    result.static.keelSurface = checkKeelSurface(dir, name, files);
    result.static.components = checkComponents(dir, files, names);
    result.static.physicsBoundary = checkPhysicsBoundary(dir, files);
    result.static.perf = checkPerf(dir, name);
  }
  for (const [k, v] of Object.entries(result.static)) {
    if (!v.pass && !v.skip) { fail(`static:${k}`); break; }
  }
  return result;
}

// ---- main -----------------------------------------------------------------

const allBackends = readdirSync(BACKENDS).filter((d) => statSync(join(BACKENDS, d)).isDirectory());
const targets = onlyBackend ? [onlyBackend] : allBackends;

let allPass = true;
for (const name of targets) {
  console.log(`\n### ${name}`);
  const r = checkBackend(name);
  for (const g of r.gates) console.log(`  [${g.pass ? 'PASS' : 'FAIL'}] gate: ${g.name}`);
  for (const [k, v] of Object.entries(r.static)) {
    const gapNote = v.gaps && v.gaps.length ? ` — unreferenced: ${v.gaps.join(', ')}` : '';
    console.log(`  [${v.skip ? 'SKIP' : v.pass ? 'PASS' : 'FAIL'}] static: ${k} — ${v.detail}${gapNote}`);
  }
  console.log(`  => ${r.pass ? 'PASS' : 'FAIL'}`);
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(r, null, 2) + '\n');
  if (!r.pass) allPass = false;
}
console.log(`\nResults in ${outDir}/`);
process.exit(allPass ? 0 : 1);
