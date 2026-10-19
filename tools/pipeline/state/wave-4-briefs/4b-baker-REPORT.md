# Wave 4 task 4b — asset-baker CLI v1 — builder report

Builder: subagent session f006e5cc-e8c2-4cff-9da8-515191e2ed4e.
Worktree: `~/keelcode-work-wave-4b`, branch `wave-4b`.
Commit: `334ded9` — "wave 4b: asset-baker CLI v1 (images, hashes, budgets)",
parented on master `eaa80d2`. Worktree not pruned.

## What was built

`tools/asset-baker/` — shared asset pipeline CLI, v1, images only
(`.png/.jpg/.jpeg/.webp`), zero dependencies (node stdlib only):

- `bake.mjs` — `node tools/asset-baker/bake.mjs <asset-dir> [--out <dir>]
  [--strict] [--budget <budgets.json>]`. Copies sources to the dist tree,
  emits `asset-manifest.json`, probes PATH for `cwebp`/`magick` at
  runtime (WebP variant + `lod_tiers ["src","webp"]` when `cwebp`
  exists; copy-through + one printed line when converters absent — never
  a failure), hand-validates every manifest entry against the schema
  (required fields, id pattern, type enum, 64-char hex hashes) and
  re-hashes every dist file from disk (missing/mismatched → exit 1).
  Budget hook: `--budget {"asset_kb_warn": N}` warns on overage, exits 1
  with `--strict`. Unknown extensions skipped with a printed warning.
- `test.mjs` — 6 tests via `node --test`: happy path (manifest exists,
  all entries hand-validate, dist files exist, hashes + budget_cost
  match), nonexistent dir → exit 1, unknown extension skipped with
  warning, budget warn-vs-strict, bad id pattern → exit 1, default
  `--out` = `<asset-dir>/../dist`. Scratch in `/tmp/asset-baker-test`.
- `sample-assets/chars/scout/` — two generated 1×1 PNGs (70 bytes each),
  `jacket-blue.png` / `jacket-red.png`, produced by a node one-liner
  (zlib + computed CRC32; verified with `file` as valid PNGs).
- `README.md` — usage, flags, validation semantics.
- `docs/ADRs/0013-asset-baker-format.md` — ADR 0013: id-mapping rule,
  v1 `budget_cost` convention (dist file KiB, 1 decimal), converter seam,
  why PNG/WebP now vs SPEC §5's KTX2/Basis/Draco/OGG later (no
  GPU-dependent toolchain guaranteed on build machines; SPEC targets
  remain the documented destination), reserved model/audio conventions
  (mesh → glTF/Draco, audio → WAV/OGG — documented, NOT built).

## Files changed (all on branch wave-4b, owned dirs only)

- `tools/asset-baker/bake.mjs` (new)
- `tools/asset-baker/test.mjs` (new)
- `tools/asset-baker/README.md` (new)
- `tools/asset-baker/sample-assets/chars/scout/jacket-blue.png` (new)
- `tools/asset-baker/sample-assets/chars/scout/jacket-red.png` (new)
- `docs/ADRs/0013-asset-baker-format.md` (new)

Frozen dirs untouched: `framework/schema/` (read only), `backends/`,
`tools/keel-cli/`, everything else.

## Gates (in order)

1. `node --check tools/asset-baker/bake.mjs && node --check tools/asset-baker/test.mjs`
   → passed (`CHECK-OK`).
2. `node --test tools/asset-baker/test.mjs` → passed. Tail of output:
   ```
   ✔ happy path: bake sample-assets, manifest validates, dist hashes match (718.826334ms)
   ✔ failure mode: nonexistent asset dir exits 1 (254.577131ms)
   ✔ unknown extensions are skipped with a warning, not a failure (219.464094ms)
   ✔ budget hook: warning by default, failure with --strict (606.947131ms)
   ✔ id violating the schema pattern fails the run with exit 1 (274.913859ms)
   ✔ default --out lands at <asset-dir>/../dist (375.244629ms)
   ℹ tests 6
   ℹ suites 0
   ℹ pass 6
   ℹ fail 0
   ℹ cancelled 0
   ℹ skipped 0
   ℹ todo 0
   ℹ duration_ms 3257.174176
   ```
3. `node tools/asset-baker/bake.mjs tools/asset-baker/sample-assets --out /tmp/baker-out --strict`
   → exit 0. Console:
   ```
   asset-baker: no converters on PATH (magick, cwebp absent) — copy-through mode
   asset-baker: baked chars/scout/jacket-blue -> chars/scout/jacket-blue.png [src]
   asset-baker: baked chars/scout/jacket-red -> chars/scout/jacket-red.png [src]
   asset-baker: wrote /tmp/baker-out/asset-manifest.json (2 assets)
   asset-baker: validation passed (2 entries)
   ```
   Manifest eyeballed: two entries, ids `chars/scout/jacket-blue` /
   `chars/scout/jacket-red`, `type` `texture`, 64-char hex `source_hash` /
   `dist_hash` (equal, copy-through), `lod_tiers ["src"]`,
   `budget_cost` 0.1 each, `baker_version "1.0.0"`. Dist tree mirrors
   source layout. All schema-conformant.

## Deviations from the brief

None.

## Open questions (max 3)

1. `dist_hash` covers the primary copied dist file only; the optional
   WebP variant is not hashed in the manifest — acceptable for v1, or
   should the schema eventually gain a per-tier hash map?
2. `budget_cost` in KiB rounds 70-byte samples to 0.1 KB — coarse for
   tiny assets but faithful to the brief's 1-decimal convention; fine
   to keep, or should v1 switch to bytes for small-file fidelity?
3. Test suite only verifies the copy-through path (no `cwebp`/`magick`
   on the bake machine) — the WebP branch is code-reviewed, not
   exercised. Should a later wave add a stub-`cwebp` fixture test?
