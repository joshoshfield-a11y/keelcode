# keel CLI reference

`keel` is the KeelCode CLI — the primary vibe-code interface for the engine:
scaffold, run, build, test, perf-measure, bake assets, and smoke-test
KeelCode games. Zero runtime dependencies (node stdlib only); hand-rolled
arg parsing in `tools/keel-cli/bin/keel.mjs`.

keel finds the repo root by walking up from the current directory until it
sees `framework/SPEC.md`. Project commands (`dev`/`build`/`test`) run in the
nearest directory containing a `package.json` (a scaffolded game).

## Subcommands

### keel new \<name> [--backend ts-three|ts-babylon|rs-core]

Scaffold a game into `./<name>/` from a backend tree. Default: `ts-three`.

The backend dir is copied verbatim minus `node_modules`, `dist`, and
`target`; then the project name is set — `package.json`'s `name` for the TS
backends, the `name =` line under `[package]` in the top-level `Cargo.toml`
for `rs-core`.

Exit 1 on an unknown `--backend` (valid list is printed).

### keel dev / keel build / keel test

Unchanged from before Wave 4: `npx vite` / `npx tsc --noEmit && npx vite
build` / `npx vitest run`, all in the nearest `package.json` directory.
These are TS-project commands — they do NOT know about cargo.

### keel smoke [--backend \<name>] [--json] [--skip-e2e]

Forwards every flag verbatim to `node framework/smoke/smoke.mjs` (the Wave 4a
shared smoke script). No flags = all three backends, cheap-first ordering.
See the smoke script's own header for the full stage list.

Exit codes: 0 when every selected backend passes every stage; 1 on the first
failure; 2 on a bad `--backend` name (the smoke script's code is propagated
verbatim by keel).

### keel perf [--backend \<name>]

Run the perf harness for a backend. Default (no `--backend`): `ts-three`,
then `ts-babylon`.

- `ts-three` → `node tools/perf-harness/perf.mjs --tier desktop` with
  cwd=`backends/ts-three`.
- `ts-babylon` → starts `npx vite preview -- --port 4174 --strictPort`,
  polls `localhost:4174` up to 60 s, runs
  `node backends/ts-babylon/tools/perf-harness/measure.mjs`, then kills the
  server (same orchestration the 4a smoke script uses).
- `rs-core` → prints `keel perf: no runnable perf harness for rs-core on
  headless (no GPU)` and exits 0. Rust runs headless; there is no
  browser/GL context to measure frame throughput against.

A failing harness (non-zero exit) fails the command.

Both TS backends build first (`npm run build`) when `dist/index.html` is
missing — same guard the 4a smoke script uses, so `keel perf` works on a
fresh checkout.

### keel vectors [--backend \<name>]

Record (or list) parity vector files for a backend. Default: `ts-three`,
then `ts-babylon`.

- `ts-three` / `ts-babylon` → `npx playwright test e2e/parity-record.spec.ts`
  with cwd=`backends/<name>` (records the vector files).
- `rs-core` → prints the paths of `backends/rs-core/parity/scripts/*.json`
  and exits 0. rs-core consumes pre-recorded vectors; it does not record.

Exit 1 on an unknown `--backend`.

The TS recording specs run against `vite preview`, so `keel vectors` also
builds first (`npm run build`) when `dist/index.html` is missing — same as
`keel perf`.

### keel bake \<asset-dir> [--out \<dir>] [--strict] [--budget \<file>]

Forwards everything after `bake` verbatim to
`node tools/asset-baker/bake.mjs` (the Wave 4b asset-baker CLI). Emits
`<out>/asset-manifest.json`. See `tools/asset-baker/README.md`.

### keel room \<init|merge|audit|report|status|clean>

Execs `tools/pipeline/room/room.sh <sub>` with cwd at the repo root and
stdio inherited; the subcommand is passed through and room.sh's exit code
is propagated. Unknown subs are rejected by room.sh itself.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0    | ok |
| 1    | failure (unknown backend name, harness failure, wrapped-tool failure, missing name/dir) |
| 2    | bad backend name for `smoke` — this one code is propagated verbatim from `framework/smoke/smoke.mjs` |

## Examples

```sh
# New ts-babylon game
keel new my-game --backend ts-babylon
cd my-game && npm install && keel dev

# New Rust backend scaffold (run it with cargo, not keel dev/build/test)
keel new my-rs-game --backend rs-core
cd my-rs-game && cargo build

# Perf both TS backends (default)
keel perf

# Record parity vectors for ts-three only
keel vectors --backend ts-three

# Bake assets and smoke everything
keel bake assets/ --out dist-assets --strict
keel smoke --skip-e2e
```
