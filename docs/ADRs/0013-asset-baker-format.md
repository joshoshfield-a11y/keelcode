# ADR 0013 — Asset-baker format decisions (Wave 4, task 4b)

Date: 2026-10-19. Status: accepted (v1, images only).

`tools/asset-baker/` is the shared asset pipeline CLI required by
`framework/SPEC.md` §5. It reads `assets/src/`, writes `assets/dist/`
plus `asset-manifest.json`, and validates the manifest on every run.
The schema in `framework/schema/asset-manifest.schema.json` is law;
every decision below is downstream of it.

## 1. Id-mapping rule

`id` = the source file's path relative to `<asset-dir>`, minus its
extension, with `/` separators:

    assets/src/chars/scout/jacket-blue.png  →  chars/scout/jacket-blue

Each segment must be lowercase alnum plus dashes, exactly three
segments, matching the schema pattern `^[a-z0-9-]+/[a-z0-9-]+/[a-z0-9-]+$`.
Any path that does not produce such an id fails the run (exit 1) rather
than emitting a manifest some backend would later choke on. This is the
concrete form of SPEC §5's `category/name/variant` naming convention.

## 2. v1 `budget_cost` convention

`budget_cost` = the size of the DIST file in KiB, rounded to 1 decimal.
It is a storage-footprint proxy, not a draw-call or memory prediction.
The perf harness's richer budget semantics (draw-call / memory cost per
backend, recorded budgets per backend per SPEC §4) arrive in a later
wave; until then this single number keeps every manifest entry honest
about the one cost we can measure cheaply at bake time.

## 3. Converter seam

At runtime the baker probes PATH for `magick` and `cwebp`. If `cwebp`
exists and the source is not already WebP, a WebP variant is emitted
next to the copied file and recorded as `lod_tiers: ["src", "webp"]`.
If the converters are absent the run degrades to copy-through with
`lod_tiers: ["src"]` and prints one line saying so. The run NEVER fails
for missing converters — build machines may not have them, and a hard
requirement would break CI. No npm dependencies are introduced for this;
the seam is shell-probe + spawn only.

`lod_tiers` stays `["src"]` in v1: real LOD tiers (mip pyramids,
resolution steps) need a trustworthy resize pipeline and do not exist
yet. We do not invent tier names.

## 4. Why PNG/WebP now vs SPEC §5's KTX2/Basis/Draco/OGG later

SPEC §5 names KTX2/Basis textures, Draco-compressed glTF, and OGG audio
as the dist targets. v1 bakes images only (`.png/.jpg/.jpeg/.webp`)
and copies them through because:

- No GPU-dependent toolchain (`ktx`, `basis`, `draco`, `oggenc`) is
  guaranteed on the build machines; the runtime probe pattern only
  works where the tool exists and we cannot promise it.
- The schema's `type` enum and required hashes are format-agnostic, so
  a PNG-through manifest validates identically to a KTX2 one — the
  format upgrade is a dist-file swap, not a schema or manifest change.
- The SPEC targets remain the documented destination (see §5 below):
  when the toolchain is available the same CLI gains a `cwebp`→KTX2
  upgrade path without breaking consumers of the manifest.

## 5. Reserved model/audio conventions (documented, NOT built)

- `mesh` → source glTF in `assets/src/`, dist target Draco-compressed
  glTF in `assets/dist/`. Id still `category/name/variant`; `type:
  "mesh"`.
- `audio` → source WAV in `assets/src/`, dist target OGG in
  `assets/dist/`. `type: "audio"`.
- `atlas` → texture atlases per material family; `type: "atlas"`,
  `lod_tiers` reserved for atlas sub-lists.

Unknown file extensions today are skipped with a printed warning (not
a failure), so WAVs and glTFs already sitting in a source tree do not
break v1 bakes.

## 6. Versioning

Per SPEC §5, versioning is by content hash, never by filename bump:
`source_hash` and `dist_hash` are sha256 hex of the respective files,
computed with node:crypto. The validation pass re-hashes every dist
file from disk after writing the manifest; a missing or mismatched
asset fails the run before any backend boots.
