# Builder brief — wave 4 (Convergence), task: 4c broader keel CLI

Scope: extend `tools/keel-cli/bin/keel.mjs` with the Wave 4 surface —
`new --backend`, `perf`, `vectors`, `bake`, `room`, and backend-aware
`smoke` passthrough — plus `docs/CLI.md` (full reference) and ADR 0014.
Done = every new subcommand works against the REAL 4a smoke script and 4b
baker in this worktree, `keel --help` documents everything, and
`node --test tools/keel-cli/test.mjs` is green.
This is a CONSTRUCTION task — the interface contracts below are the spec.

Directory ownership: you own `tools/keel-cli/` (bin + new test file),
`docs/CLI.md`, and `docs/ADRs/0014-keel-cli-surface.md` ONLY.
Do not touch any other file.
Frozen (never touch): `framework/smoke/smoke.mjs`, `tools/asset-baker/`,
`tools/pipeline/room/` (your commands WRAP these — never edit them),
`backends/`, everything else.

IMPORTANT: your worktree is based on the `wave-4-integration` branch (which
already contains the merged 4a + 4b work), NOT on master. Your branch is
`wave-4c`. Your commits touch only your owned dirs.

Reference files (read these, nothing else):
- `tools/keel-cli/bin/keel.mjs` (current version — keep its style:
  zero-dep, hand-rolled arg parsing, findRepoRoot/findProjectRoot)
- `framework/smoke/smoke.mjs` (4a version — your `keel smoke` forwards
  `--backend/--json/--skip-e2e` to it verbatim)
- `tools/asset-baker/bake.mjs` (4b version — your `keel bake` forwards
  `<asset-dir>` and `--out/--strict/--budget` to it verbatim)
- `tools/pipeline/room/room.sh` (your `keel room` execs it with the
  subcommand passed through; run `room.sh` with a bogus arg to see its
  usage line: `init|merge|audit|report|status|clean`)

Exact values (use verbatim — do not "improve"):
- `keel new <name> --backend <ts-three|ts-babylon|rs-core>` (default
  `ts-three`). CopyTree the backend dir minus `node_modules|dist|target`,
  then set the project name: for TS backends rewrite `package.json`'s
  `name` (existing behavior); for rs-core rewrite the `name =` line under
  `[package]` in the top-level `Cargo.toml`. Unknown backend → exit 1
  printing the valid list.
- `keel perf [--backend <name>]`: ts-three →
  `node <root>/tools/perf-harness/perf.mjs --tier desktop` with
  cwd=`backends/ts-three`; ts-babylon →
  `node backends/ts-babylon/tools/perf-harness/measure.mjs` with
  cwd=`backends/ts-babylon` (requires the preview server: start
  `npx vite preview -- --port 4174 --strictPort` in background, poll
  localhost:4174 max 60s, run, kill — same orchestration the 4a smoke
  script uses; read how it does it and mirror it, do not import it);
  rs-core → print `keel perf: no runnable perf harness for rs-core on
  headless (no GPU)` and exit 0. A failing harness (non-zero exit) fails
  the command. Default (no --backend): run ts-three, then ts-babylon.
- `keel vectors [--backend <name>]`: ts-three → 
  `npx playwright test e2e/parity-record.spec.ts` with cwd=backends/ts-three;
  ts-babylon → same spec path with cwd=backends/ts-babylon;
  rs-core → print the paths of `backends/rs-core/parity/scripts/*.json`
  (rs-core consumes pre-recorded vectors; it does not record) and exit 0.
  Default: ts-three, then ts-babylon.
- `keel bake <asset-dir> [--out <dir>] [--strict] [--budget <file>]`:
  forward everything after `bake` verbatim to
  `node <root>/tools/asset-baker/bake.mjs`.
- `keel room <init|merge|audit|report|status|clean>`: spawn
  `<root>/tools/pipeline/room/room.sh <sub>` with cwd=<root>, stdio inherit.
  Unknown sub → let room.sh print its own usage error; propagate its exit code.
- `keel smoke [--backend <name>] [--json] [--skip-e2e]`: forward the flags
  verbatim to `node <root>/framework/smoke/smoke.mjs`. Keep the existing
  no-flag behavior (runs everything).
- `keel --help`: document every subcommand above with one-line usage +
  flags. Existing commands (`dev/build/test`) keep working unchanged.
- EXPLICIT NON-SCOPE: do NOT rewire `dev`/`build`/`test` for cargo —
  an rs-core scaffold is run by the user via cargo; note the gap in your
  report as a spec issue, do not fix it here.
- ADR `docs/ADRs/0014-keel-cli-surface.md`: the subcommand list, rs-core
  scaffold semantics (whole backend tree as template), the perf/vectors
  per-backend mapping (incl. why rs-core perf/vectors degrade to
  informative no-ops), why the CLI stays zero-dep.
- `docs/CLI.md`: full reference — every subcommand, flags, exit codes
  (0 ok / 1 failure / 2 bad backend name for smoke), 2+ examples.

Tests: `tools/keel-cli/test.mjs` with `node --test` (stdlib only).
Cover EVERY new subcommand with happy path + one failure mode, WITHOUT
running full builds/e2e (too slow for unit tests):
  new: scaffold ts-babylon to /tmp scratch → package.json name rewritten;
       `--backend bogus` → exit 1.
  perf: `--backend bogus` → exit 1 (do NOT run real harnesses in tests).
  vectors: `--backend rs-core` → exit 0, output names parity/scripts.
  bake: bake the 4b sample-assets to /tmp scratch → asset-manifest.json exists.
  room: `keel room status` → exit 0.
  smoke: `keel smoke --backend bogus` → exit 2 (proves flag forwarding;
       the smoke script rejects the name — no stages run).
Run subcommands as child processes of `bin/keel.mjs` with cwd inside the
worktree (so findRepoRoot resolves to the worktree).

Forbidden: spawning subagents; self-spawned reviewers; editing wrapped
tools; adding dependencies; touching `dev/build/test` behavior.

Gates before you commit (in this order — stop at the first failure):
1. `node --check tools/keel-cli/bin/keel.mjs && node --check tools/keel-cli/test.mjs`
2. `node --test tools/keel-cli/test.mjs`
3. Manual: `node tools/keel-cli/bin/keel.mjs new /tmp/cli-manual-demo --backend ts-babylon` → check package.json name; then `rm -rf /tmp/cli-manual-demo`

Worktree: `~/keelcode-work-wave-4c`, branch `wave-4c`, based on
`wave-4-integration` (the coordinator creates this branch and merges 4a+4b
into it BEFORE you start — confirm `git log --oneline -3` shows the 4a and
4b merge commits before writing any code). NEVER `git worktree prune`.

Commit: branch `wave-4c`, message `wave 4c: broader keel CLI surface (new/perf/vectors/bake/room)`.
Then write your full report to
`~/workspace/keelcode/tools/pipeline/state/wave-4-briefs/4c-cli-REPORT.md`
(contract below) and return ONLY: status line + one-line test summary +
concerns (max 5 lines).

Report contract (in the report FILE, not in your reply):
- Files changed (paths), gate commands + exact output tail (last 10 lines),
  deviations from this brief (list; "none" if none), open questions (max 3),
  spec issues found (list; "none" if none — e.g. the dev/build/test cargo gap).
