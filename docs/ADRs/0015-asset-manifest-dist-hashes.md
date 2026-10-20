# ADR 0015 — asset manifest gains `dist_hashes` (schema evolution)

Date: 2026-10-20
Status: accepted

## Context

The asset manifest (ADR 0013, `framework/schema/asset-manifest.schema.json`)
recorded exactly one dist hash per asset: `dist_hash`, the sha256 of the
primary baked file. But the baker can emit more than the primary file —
when `cwebp` is present it writes a WebP variant alongside every texture
and records it in `lod_tiers`. The variant's bytes were covered by no
hash at all: a variant could change (different converter, different
quality setting, a corrupted write) and the manifest — whose whole job
is content addressing, "versioning is by content hash, never filename
bump" — would not notice. Issue filed during Wave 4.

## Decision

Each manifest entry gains an optional `dist_hashes` object: a map from
dist file name (e.g. `jacket-blue.png`, `jacket-blue.webp`) to that
file's sha256, covering EVERY file the baker emits for the asset.

- `dist_hash` is unchanged: still required, still the primary file's
  hash, and always present as one of the `dist_hashes` values. Existing
  consumers that read only `dist_hash` see identical behavior.
- The schema change is purely additive: `dist_hashes` is a new optional
  property on `assetEntry` (values constrained to 64-char hex,
  `minProperties: 1`). It is NOT added to `required`, so manifests
  written by baker 1.0.0 remain valid under the evolved schema, and no
  SPEC.md edit was needed.
- The baker (now version 1.1.0) always emits `dist_hashes`, hand-
  validates it (non-empty map, hex values, includes the `dist_hash`
  value), and its post-write validation pass re-hashes every recorded
  file — variants included — so a missing or mismatched variant fails
  the bake before any backend boots, same as the primary always did.

## Why a name-keyed map, not a list

The consumer question is "did THIS file change?" — a map keyed by file
name answers it with one lookup and makes additions/removals of
variants visible as key changes in a manifest diff. A positional list
would couple the meaning to `lod_tiers` ordering and hide renames.

## Alternatives considered

- **Hash a concatenation of all dist files into `dist_hash`.** Rejected:
  silently changes the meaning of an existing required field; every
  pre-existing manifest and consumer breaks, and you can no longer tell
  WHICH file changed.
- **One optional field per variant kind (`webp_hash`, ...).** Rejected:
  a new schema edit for every future variant kind; the map generalizes.
