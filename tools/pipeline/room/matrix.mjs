#!/usr/bin/env node
/**
 * Compatibility matrix — cross-backend contract conformance.
 *
 * Reads tools/pipeline/room/out/<backend>.json (written by
 * check-contracts.mjs) and emits a markdown matrix:
 * rows = framework contracts, columns = backends, cells = PASS/FAIL/SKIP.
 *
 * This is CONTRACT conformance (each backend honors the spec), NOT
 * bit-parity or behavioral parity across backends — determinism was
 * dropped as a requirement (2026-10-18), and Havok vs Rapier vs
 * native-Rapier can never be bit-identical (ADR-0007).
 *
 * Usage: node matrix.mjs [--out <dir>]  (reads <dir>/*.json, default room/out)
 * Writes matrix.md next to the inputs. Exit 0 always (it reports, not gates).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const outDir = resolve(opt('--out') || join(here, 'out'));

const ROWS = [
  { key: 'gates', label: 'Gates (tsc/vitest or cargo test)', get: (r) => gateCell(r) },
  { key: 'keelSurface', label: 'Debug surface (__keel / keel-rs CLI)', get: (r) => cell(r.static.keelSurface) },
  { key: 'components', label: 'Component schemas (11 canonical)', get: (r) => cell(r.static.components) },
  { key: 'physicsBoundary', label: 'Physics driver boundary', get: (r) => cell(r.static.physicsBoundary) },
  { key: 'perf', label: 'Perf budgets (no FAIL)', get: (r) => cell(r.static.perf) },
];

function cell(v) {
  if (!v) return '—';
  if (v.skip) return 'SKIP';
  return v.pass ? 'PASS' : 'FAIL';
}
function gateCell(r) {
  if (!r.gates.length) return '—';
  const failed = r.gates.filter((g) => !g.pass);
  return failed.length ? `FAIL (${failed.map((g) => g.name).join(', ')})` : `PASS (${r.gates.length})`;
}

const files = existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith('.json')) : [];
const results = files.map((f) => JSON.parse(readFileSync(join(outDir, f), 'utf8')));
const backends = results.map((r) => r.backend);

let md = `# Cross-backend compatibility matrix\n\n`;
md += `Generated: ${new Date().toISOString()} — contract conformance per backend, NOT cross-backend parity.\n\n`;
md += `| Contract | ${backends.join(' | ')} |\n`;
md += `|---|${backends.map(() => '---').join('|')}|\n`;
for (const row of ROWS) {
  md += `| ${row.label} | ${results.map((r) => row.get(r)).join(' | ')} |\n`;
}
md += `\n## Notes\n\n`;
for (const r of results) {
  for (const [k, v] of Object.entries(r.static || {})) {
    if (v && !v.pass && !v.skip) md += `- ${r.backend} / ${k}: ${v.detail}\n`;
    if (v && v.gaps && v.gaps.length) md += `- ${r.backend} / ${k}: unreferenced components (triage, not a fail): ${v.gaps.join(', ')}\n`;
  }
  if (r.failedAt) md += `- ${r.backend}: first failure at ${r.failedAt}\n`;
}
if (!results.length) md += '- No check results found. Run check-contracts.mjs first.\n';

const outPath = join(outDir, 'matrix.md');
writeFileSync(outPath, md);
console.log(`matrix: ${backends.join(', ') || '(no backends)'}`);
console.log(`wrote ${outPath}`);
