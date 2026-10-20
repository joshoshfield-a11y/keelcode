#!/usr/bin/env node
// bake.mjs — KeelCode asset-baker CLI (v1).
//
//   node tools/asset-baker/bake.mjs <asset-dir> [--out <dir>] [--strict] [--budget <budgets.json>]
//
// Emits <out>/asset-manifest.json conforming to
// framework/schema/asset-manifest.schema.json (see SPEC.md §5 and ADR 0013).
//
// v1 handles .png/.jpg/.jpeg/.webp textures only: each source file is
// copied to the dist tree; if `cwebp` is on PATH a WebP variant is emitted
// alongside and recorded as an extra lod tier. The manifest is hand-
// validated against the schema after writing: a missing or hash-mismatched
// asset fails the run BEFORE any backend boots (SPEC §5 test clause).
//
// Wave 5 (baker 1.1.0, ADR 0015): each entry also records `dist_hashes`,
// a map of EVERY emitted dist file (primary + variants) to its sha256 —
// v1's lone `dist_hash` covered only the primary file, so a changed WebP
// variant went unnoticed. `dist_hash` stays as the primary file's hash.
//
// Zero runtime dependencies; node stdlib only.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync, readdirSync, statSync, mkdirSync,
  copyFileSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const BAKER_VERSION = '1.1.0';

// Verbatim from framework/schema/asset-manifest.schema.json.
const ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/;
const TYPE_ENUM = ['mesh', 'texture', 'audio', 'atlas'];
const HEX64 = /^[0-9a-f]{64}$/;
const REQUIRED_ENTRY_FIELDS = ['id', 'type', 'source_hash', 'dist_hash', 'lod_tiers', 'budget_cost'];

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function sha256Hex(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function kb1(file) {
  return Math.round((statSync(file).size / 1024) * 10) / 10;
}

// Runtime probe for optional converters. Never fails the run.
function hasTool(name) {
  try {
    const r = spawnSync(name, ['-version'], { stdio: 'ignore' });
    return !(r.error && r.error.code === 'ENOENT');
  } catch {
    return false;
  }
}

// Recursively list files under dir, relative paths, sorted.
function listFiles(dir) {
  const out = [];
  function walk(cur) {
    for (const name of readdirSync(cur).sort()) {
      const p = join(cur, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p));
    }
  }
  walk(dir);
  return out;
}

function usage() {
  console.log(`keel asset-baker ${BAKER_VERSION}

Usage:
  node tools/asset-baker/bake.mjs <asset-dir> [--out <dir>] [--strict] [--budget <budgets.json>]

  <asset-dir>  source asset tree (SPEC.md §5: assets/src/)
  --out        dist output dir (default: <asset-dir>/../dist)
  --strict     turn budget warnings into failures
  --budget     JSON file like {"asset_kb_warn": N}`);
}

function parseArgs(argv) {
  const args = { dir: null, out: null, strict: false, budget: null };
  const rest = [...argv];
  while (rest.length) {
    const a = rest.shift();
    if (a === '--out') {
      args.out = rest.shift();
      if (!args.out) throw new Error('--out needs a value');
    } else if (a === '--strict') {
      args.strict = true;
    } else if (a === '--budget') {
      args.budget = rest.shift();
      if (!args.budget) throw new Error('--budget needs a value');
    } else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else if (a.startsWith('-')) {
      throw new Error(`unknown flag: ${a}`);
    } else if (args.dir) {
      throw new Error(`unexpected extra argument: ${a}`);
    } else {
      args.dir = a;
    }
  }
  if (!args.dir) throw new Error('missing <asset-dir>');
  return args;
}

// Hand-validate one manifest entry against the schema's assetEntry.
// Returns an array of problem strings (empty = valid).
function validateEntry(e) {
  const problems = [];
  for (const f of REQUIRED_ENTRY_FIELDS) {
    if (!(f in e)) problems.push(`missing required field "${f}"`);
  }
  if (typeof e.id !== 'string' || !ID_PATTERN.test(e.id)) {
    problems.push(`id fails schema pattern: ${JSON.stringify(e.id)}`);
  }
  if (!TYPE_ENUM.includes(e.type)) problems.push(`type not in enum: ${JSON.stringify(e.type)}`);
  for (const f of ['source_hash', 'dist_hash']) {
    if (typeof e[f] !== 'string' || !HEX64.test(e[f])) {
      problems.push(`${f} is not 64-char hex: ${JSON.stringify(e[f])}`);
    }
  }
  if (!Array.isArray(e.lod_tiers) || e.lod_tiers.length < 1 || !e.lod_tiers.every((t) => typeof t === 'string')) {
    problems.push(`lod_tiers must be a non-empty string array: ${JSON.stringify(e.lod_tiers)}`);
  }
  if (typeof e.budget_cost !== 'number' || !Number.isFinite(e.budget_cost)) {
    problems.push(`budget_cost must be a number: ${JSON.stringify(e.budget_cost)}`);
  }
  // dist_hashes is optional in the schema (additive, ADR 0015) so old
  // manifests stay valid — but when present it must be a non-empty
  // name -> sha256 map that includes the primary file's dist_hash.
  if ('dist_hashes' in e) {
    const dh = e.dist_hashes;
    if (typeof dh !== 'object' || dh === null || Array.isArray(dh)) {
      problems.push(`dist_hashes must be an object mapping dist file name to sha256: ${JSON.stringify(dh)}`);
    } else {
      const names = Object.keys(dh);
      if (names.length < 1) problems.push('dist_hashes must not be empty');
      for (const n of names) {
        if (typeof dh[n] !== 'string' || !HEX64.test(dh[n])) {
          problems.push(`dist_hashes["${n}"] is not 64-char hex: ${JSON.stringify(dh[n])}`);
        }
      }
      if (!names.some((n) => dh[n] === e.dist_hash)) {
        problems.push('dist_hashes must include the primary file hash (the dist_hash value)');
      }
    }
  }
  return problems;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error('asset-baker: ' + err.message);
    usage();
    process.exit(1);
  }

  const srcDir = resolve(args.dir);
  if (!existsSync(srcDir) || !statSync(srcDir).isDirectory()) {
    console.error(`asset-baker: asset dir not found: ${srcDir}`);
    process.exit(1);
  }

  const outDir = resolve(args.out || join(srcDir, '..', 'dist'));
  mkdirSync(outDir, { recursive: true });

  const cwebp = hasTool('cwebp');
  if (!cwebp && !hasTool('magick')) {
    console.log('asset-baker: no converters on PATH (magick, cwebp absent) — copy-through mode');
  } else if (!cwebp) {
    console.log('asset-baker: cwebp absent — copy-through mode');
  }

  const assets = [];
  const idToDistPath = new Map();
  const idToDistFiles = new Map(); // id -> Map(dist file name -> path), primary + variants

  for (const rel of listFiles(srcDir)) {
    const srcPath = join(srcDir, rel);
    const dot = rel.lastIndexOf('.');
    const ext = dot >= 0 ? rel.slice(dot).toLowerCase() : '';
    if (!IMAGE_EXTS.has(ext)) {
      console.warn(`asset-baker: warning: skipping unsupported extension: ${rel}`);
      continue;
    }

    // id = relative path minus extension, with / separators.
    const id = rel.slice(0, dot).split(sep).join('/');
    if (!ID_PATTERN.test(id)) {
      console.error(`asset-baker: id fails schema pattern (segments must be lowercase alnum + dashes, exactly 3): ${id}`);
      process.exit(1);
    }

    const distPath = join(outDir, id + ext); // dist tree mirrors source layout
    mkdirSync(dirname(distPath), { recursive: true });
    copyFileSync(srcPath, distPath);

    const base = id.slice(id.lastIndexOf('/') + 1);
    const distFiles = new Map([[base + ext, distPath]]);
    const lodTiers = ['src'];
    if (cwebp && ext !== '.webp') {
      const webpPath = join(outDir, id + '.webp');
      const r = spawnSync('cwebp', ['-q', '80', srcPath, '-o', webpPath], { stdio: 'ignore' });
      if (r.status === 0) {
        lodTiers.push('webp');
        distFiles.set(base + '.webp', webpPath);
      } else console.warn(`asset-baker: warning: cwebp failed for ${rel}, keeping copy-through`);
    }

    // Hash EVERY emitted dist file (ADR 0015); dist_hash remains the
    // primary file's hash for backward compatibility.
    const dist_hashes = {};
    for (const [name, p] of distFiles) dist_hashes[name] = sha256Hex(p);

    assets.push({
      id,
      type: 'texture',
      source_hash: sha256Hex(srcPath),
      dist_hash: dist_hashes[base + ext],
      dist_hashes,
      lod_tiers: lodTiers,
      budget_cost: kb1(distPath),
    });
    idToDistPath.set(id, distPath);
    idToDistFiles.set(id, distFiles);
    console.log(`asset-baker: baked ${id} -> ${id + ext} [${lodTiers.join(',')}]`);
  }

  assets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const manifest = { baker_version: BAKER_VERSION, assets };
  const manifestPath = join(outDir, 'asset-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`asset-baker: wrote ${manifestPath} (${assets.length} assets)`);

  // Validation pass: re-read and hand-validate against the schema.
  const readBack = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(readBack.assets)) {
    console.error('asset-baker: validation failed: manifest has no assets array');
    process.exit(1);
  }
  for (const e of readBack.assets) {
    const problems = validateEntry(e);
    if (problems.length) {
      console.error(`asset-baker: validation failed for asset: ${problems.join('; ')}`);
      process.exit(1);
    }
  }
  // Existence + hash re-check: a missing or hash-mismatched asset fails the
  // run BEFORE any backend boots (SPEC §5 test clause).
  for (const e of readBack.assets) {
    const distPath = idToDistPath.get(e.id);
    if (!distPath || !existsSync(distPath)) {
      console.error(`asset-baker: validation failed: dist file missing for ${e.id}`);
      process.exit(1);
    }
    if (sha256Hex(distPath) !== e.dist_hash) {
      console.error(`asset-baker: validation failed: dist hash mismatch for ${e.id}`);
      process.exit(1);
    }
    // Every file recorded in dist_hashes (variants included) must exist
    // on disk and re-hash to its recorded value.
    const files = idToDistFiles.get(e.id);
    for (const [name, hash] of Object.entries(e.dist_hashes ?? {})) {
      const p = files?.get(name);
      if (!p || !existsSync(p)) {
        console.error(`asset-baker: validation failed: dist file missing for ${e.id} (${name})`);
        process.exit(1);
      }
      if (sha256Hex(p) !== hash) {
        console.error(`asset-baker: validation failed: dist_hashes mismatch for ${e.id} (${name})`);
        process.exit(1);
      }
    }
  }
  console.log(`asset-baker: validation passed (${readBack.assets.length} entries)`);

  // Budget hook.
  if (args.budget) {
    const budgets = JSON.parse(readFileSync(resolve(args.budget), 'utf8'));
    const warn = Number(budgets.asset_kb_warn);
    const total = Math.round(readBack.assets.reduce((s, e) => s + e.budget_cost, 0) * 10) / 10;
    if (Number.isFinite(warn) && total > warn) {
      const msg = `asset-baker: BUDGET WARNING: total asset budget_cost ${total} KB exceeds asset_kb_warn ${warn} KB`;
      if (args.strict) {
        console.error(msg);
        process.exit(1);
      }
      console.warn(msg);
    } else {
      console.log(`asset-baker: budget ok (${total} KB)`);
    }
  }
}

main();
