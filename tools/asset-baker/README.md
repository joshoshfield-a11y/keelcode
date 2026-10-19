# asset-baker (v1)

Shared asset pipeline CLI — `assets/src/` → `assets/dist/` +
`asset-manifest.json`. See `framework/SPEC.md` §5 and
`docs/ADRs/0013-asset-baker-format.md`.

## Usage

    node tools/asset-baker/bake.mjs <asset-dir> [--out <dir>] [--strict] [--budget <budgets.json>]

- `<asset-dir>` — source asset tree (SPEC's `assets/src/`).
- `--out` — dist output dir, default `<asset-dir>/../dist`.
- `--strict` — budget overruns fail (exit 1) instead of warning.
- `--budget <file>` — JSON like `{"asset_kb_warn": 512}`; sums all
  entries' `budget_cost` and warns/fails when exceeded.

v1 handles `.png/.jpg/.jpeg/.webp` only; everything else is skipped
with a printed warning. If `cwebp` is on PATH a WebP variant is emitted
alongside each copy and recorded as an extra `lod_tiers` entry; without
converters the baker copies through and says so.

Every manifest entry carries `{id, type, source_hash, dist_hash,
lod_tiers, budget_cost}` per `framework/schema/asset-manifest.schema.json`.
After writing, the baker re-reads the manifest, hand-validates every
entry (required fields, id pattern, type enum, 64-char hex hashes), and
re-hashes every dist file from disk. A missing or hash-mismatched asset
fails the run (exit 1) before any backend boots.

## Tests

    node --test tools/asset-baker/test.mjs

## Samples

`sample-assets/chars/scout/` holds two generated 1×1 PNGs
(`jacket-blue.png`, `jacket-red.png`, ~70 bytes each) so the gates can
run without fetching images from the web.
