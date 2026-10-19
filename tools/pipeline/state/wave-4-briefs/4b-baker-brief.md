# Builder brief — wave 4 (Convergence), task: 4b asset-baker CLI

Scope: build `tools/asset-baker/` — the shared asset pipeline CLI. Done =
`node tools/asset-baker/bake.mjs <asset-dir/>` emits `asset-manifest.json`
that conforms EXACTLY to `framework/schema/asset-manifest.schema.json`,
with content hashes, a validation pass, and budget hooks; ADR 0013 records
every format decision; model/audio conventions are documented, not built.
This is a CONSTRUCTION task — the schema file and SPEC.md §5 are the spec.

Directory ownership: you own `tools/asset-baker/` and
`docs/ADRs/0013-asset-baker-format.md` ONLY. Do not touch any other file.
Frozen (never touch): `framework/schema/` (read the schema, never edit it),
`backends/`, `tools/keel-cli/`, everything else.

Reference files (read these, nothing else):
- `framework/schema/asset-manifest.schema.json` (the law — every emitted
  manifest must satisfy it: required fields id/type/source_hash/dist_hash/
  lod_tiers/budget_cost; id pattern `^[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+$`;
  type enum mesh|texture|audio|atlas)
- `framework/SPEC.md` §5 (asset pipeline conventions — source in
  `assets/src/`, dist in `assets/dist/`, versioning by content hash)
- `tools/keel-cli/bin/keel.mjs` (style reference: zero-dep node stdlib,
  hand-rolled arg parsing)

Exact values (use verbatim — do not "improve"):
- CLI: `node tools/asset-baker/bake.mjs <asset-dir> [--out <dir>] [--strict] [--budget <budgets.json>]`
- `--out` default: `<asset-dir>/../dist` (SPEC's assets/src → assets/dist layout).
- v1 handles `.png/.jpg/.jpeg/.webp` ONLY. Unknown extensions are skipped
  with a printed warning (not a failure).
- id mapping: relative path under `<asset-dir>`, minus extension, with `/`
  separators, e.g. `assets/src/chars/scout/jacket-blue.png` →
  id `chars/scout/jacket-blue`. Segments MUST match the schema's id pattern
  (lowercase alnum + dashes); anything else → error exit 1.
- `type`: `texture` for every v1 asset.
- `source_hash`: sha256 hex of the source file. `dist_hash`: sha256 hex of
  the dist file. Use node:crypto, no deps.
- `lod_tiers`: `["src"]` in v1 (real LOD tiers arrive with the converter
  seam — document this in the ADR, do not invent tiers).
- `budget_cost`: file size of the DIST file in KB, rounded to 1 decimal
  (the v1 convention — ADR it; the perf harness's budget semantics come
  in a later wave).
- Converter seam: at runtime probe for `magick` and `cwebp` on PATH. If
  `cwebp` exists, also emit a `.webp` variant next to the copied file and
  record it in `lod_tiers` as `["src","webp"]`. If absent: copy-through,
  `lod_tiers ["src"]`, print one line noting converters are absent. NEVER
  fail for missing converters. Do NOT add npm dependencies.
- Validation: after writing the manifest, re-read it and hand-validate
  every entry against the schema (required fields, id regex, type enum,
  hashes are 64-char hex). A missing or hash-mismatched asset fails the
  run (exit 1) BEFORE any backend boots — per SPEC §5's test clause.
- Budget hooks: `--budget <file>` reads `{"asset_kb_warn": N}`; if the sum
  of budget_cost exceeds N, print a WARNING (exit 0) — with `--strict`,
  exit 1 instead.
- Sample assets: commit 2 tiny PNGs under
  `tools/asset-baker/sample-assets/chars/scout/` (generate 1x1 PNGs via a
  node one-liner, ~70 bytes each — do not fetch images from the web).
- ADR `docs/ADRs/0013-asset-baker-format.md`: record the id-mapping rule,
  the v1 budget_cost convention, the converter seam, why PNG/WebP now vs
  SPEC §5's KTX2/Basis/Draco/OGG later (no GPU-dependent toolchain on build
  machines; the SPEC targets stay the documented destination), and the
  reserved model/audio conventions (mesh → glTF/Draco, audio → WAV/OGG —
  DOCUMENTED, NOT BUILT).
- Tests: `tools/asset-baker/test.mjs` using `node --test` (stdlib only):
  happy path (bake sample-assets → manifest exists, every entry validates,
  dist files exist with matching hashes) + one failure mode (nonexistent
  asset dir → exit 1). Tests use a /tmp scratch dir for `--out`.

Forbidden: spawning subagents; self-spawned reviewers; touching the schema
or SPEC; npm/cargo dependencies; real KTX2/Basis/Draco/OGG transcoding in v1.

Gates before you commit (in this order — stop at the first failure):
1. `node --check tools/asset-baker/bake.mjs && node --check tools/asset-baker/test.mjs`
2. `node --test tools/asset-baker/test.mjs`
3. `node tools/asset-baker/bake.mjs tools/asset-baker/sample-assets --out /tmp/baker-out --strict` and eyeball the manifest

Worktree: `~/keelcode-work-wave-4b`, branch `wave-4b`, created from master
commit eaa80d2. NEVER `git worktree prune`.

Commit: branch `wave-4b`, message `wave 4b: asset-baker CLI v1 (images, hashes, budgets)`.
Then write your full report to
`~/workspace/keelcode/tools/pipeline/state/wave-4-briefs/4b-baker-REPORT.md`
(contract below) and return ONLY: status line + one-line test summary +
concerns (max 5 lines).

Report contract (in the report FILE, not in your reply):
- Files changed (paths), gate commands + exact output tail (last 10 lines),
  deviations from this brief (list; "none" if none), open questions (max 3).
