# ADR 0014 — keel CLI surface (Wave 4)

Date: 2026-10-19
Status: accepted

## Context

The keel CLI is the engine's primary interface. Wave 4 (convergence) added
three shared facilities — the Wave 4a smoke script across all three
backends, the Wave 4b asset-baker, and the pipeline safe room — but they
were only reachable as separate entry points. Task 4c exposes them through
keel without touching their implementations.

## Subcommand list

| Subcommand | Wrap / forward | Contract |
| ---------- | -------------- | -------- |
| `new <name> --backend ts-three\|ts-babylon\|rs-core` | — | CopyTree the backend dir minus `node_modules\|dist\|target`; rewrite project name (`package.json` for TS, `[package] name =` in top-level `Cargo.toml` for rs-core) |
| `perf [--backend]` | `tools/perf-harness/perf.mjs` / ts-babylon `measure.mjs` | per-backend mapping below; default ts-three then ts-babylon; rs-core informative no-op |
| `vectors [--backend]` | playwright `e2e/parity-record.spec.ts` | records for TS backends; rs-core lists `backends/rs-core/parity/scripts/*.json` |
| `bake <asset-dir> ...` | `tools/asset-baker/bake.mjs` | forwards everything after `bake` verbatim |
| `room <init\|merge\|audit\|report\|status\|clean>` | `tools/pipeline/room/room.sh` | execs it, cwd=repo root, stdio inherit; exit code propagated |
| `smoke [--backend] [--json] [--skip-e2e]` | `framework/smoke/smoke.mjs` | forwards flags verbatim; keeps no-flag (run everything) behavior |

`dev` / `build` / `test` are unchanged (npm/vite/vitest, TS-project only).

## rs-core scaffold semantics

A `keel new --backend rs-core` scaffold copies the whole
`backends/rs-core` tree as the template — same semantics as the TS
scaffolds (whole backend tree as template), not a "new crate" generator.
The `[package]` name in the top-level `Cargo.toml` is rewritten to the
project name; nothing else is cargo-aware.

## Why rs-core perf/vectors degrade to informative no-ops

- **perf:** the TS perf harnesses measure browser frame throughput
  (ts-three) or measure against a `vite preview` page (ts-babylon). rs-core
  is a headless sim with no GPU and no GL context on this box — there is
  nothing meaningful to measure frame-time against. Rather than fake a
  number, keel prints `keel perf: no runnable perf harness for rs-core on
  headless (no GPU)` and exits 0.
- **vectors:** vector *recording* is a browser Playwright spec. rs-core
  consumes the pre-recorded vectors under `backends/rs-core/parity/scripts/`
  in its parity replay — it cannot record. So keel lists the vector paths
  it has and exits 0.

## Why the CLI stays zero-dep

keel is the first thing a vibe-coding user touches, in a fresh scaffold
directory that may have no `node_modules` yet. Every dependency would be
another failure mode at the moment of first use. The Wave 4 surface is
pure orchestration — arg parsing, spawn, and one preview-server poll —
so node stdlib is all it needs.

## Exit-code note

keel now propagates wrapped tools' exit codes verbatim instead of
collapsing everything to 1: smoke's documented exit 2 (bad `--backend`
name) reaches the caller, as does room.sh's own exit code. (Failure mode
found during testing: the original `run()` helper wrapped every non-zero
exit in a generic error and the top-level handler always exited 1.)
