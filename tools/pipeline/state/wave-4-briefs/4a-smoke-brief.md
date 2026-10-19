# Builder brief — wave 4 (Convergence), task: 4a shared smoke CI

Scope: extend `framework/smoke/smoke.mjs` (currently ts-three only) into the
shared smoke suite for ALL THREE backends, and prepare an INACTIVE GitHub
workflow. Done = `node framework/smoke/smoke.mjs` runs every backend green,
`--backend <name>` runs exactly one, `--json` emits a machine-readable
summary alongside the human one, and `.github/workflows/smoke.yml` exists
but cannot run anywhere until the repo goes public.
This is a CONSTRUCTION task — no reference exists; the contracts below are
the spec.

Directory ownership: you own `framework/smoke/smoke.mjs` and
`.github/workflows/smoke.yml` ONLY. Do not touch any other file.
Frozen (never touch): `backends/` (the smoke script RUNS backend commands
but never EDITS backend files), `tools/keel-cli/`, everything else.

Reference files (read these, nothing else):
- `framework/smoke/smoke.mjs` (current ts-three-only version — keep its
  stage-helper style and the existing ts-three stages verbatim)
- `backends/ts-babylon/e2e/parity-record.spec.ts` (the vector double-run
  check already exists as a spec — reuse it, do not reimplement)
- `backends/ts-babylon/tools/perf-harness/measure.mjs` (needs
  `vite preview` on port 4174 running first — your script orchestrates it)
- `tools/perf-harness/perf.mjs` (repo-root harness; existing smoke calls it
  as `node <harness> --tier desktop` with cwd=backends/ts-three — keep that
  invocation verbatim)

Exact values (use verbatim — do not "improve"):
- CLI: `node framework/smoke/smoke.mjs [--backend <ts-three|ts-babylon|rs-core>] [--json] [--skip-e2e]`
- Default (no flags): all three backends, cheap → expensive ordering.
- Unknown `--backend` value → exit 2, printing the valid list. Not 1.
- `--json`: after the human summary, print a single JSON object to stdout:
  `{"ok":bool,"backends":{"ts-three":{"ok":bool,"stages":[{name,ok,ms}]},...}}`
- Backend stages:
  - ts-three: keep the 4 existing stages EXACTLY (build / dist assert /
    vitest / perf harness desktop tier).
  - ts-babylon: (1) `npx tsc --noEmit`, (2) `npx vitest run`,
    (3) Playwright e2e `npx playwright test` (skipped with `--skip-e2e`),
    (4) vector replay check = `npx playwright test e2e/parity-record.spec.ts`
    (the spec itself asserts double-run JSON-identical; a pass IS the check),
    (5) perf: `npm run build` if not already built, then start
    `npx vite preview -- --port 4174 --strictPort` in the background, poll
    until http://localhost:4174/ responds (max 60s), run
    `node tools/perf-harness/measure.mjs` with cwd=backends/ts-babylon,
    then kill the preview server. Fail if any console error/pageerror
    (measure.mjs already exits 1 on those).
  - rs-core: (1) `cargo test`, (2) `cargo clippy --all-targets -- -D warnings`,
    (3) `cargo fmt --check`, (4) `KEEL_PARITY_STRICT=1 cargo test --test parity`.
    Every cargo invocation MUST export PATH="$HOME/.cargo/bin:$PATH"
    (cargo is NOT on the default PATH). Set CARGO_TARGET_DIR to a shared
    cache dir (e.g. ~/keelcode-target) so worktrees don't rebuild rapier/wgpu
    from scratch. No perf stage for rs-core: print
    `skip: no runnable perf harness on headless (no GPU)` — a skip, never a failure.
- `.github/workflows/smoke.yml`: jobs run the same commands the script runs
  (node 22 + rust stable on ubuntu-latest, playwright browsers installed).
  INACTIVE: the triggers block stays COMMENTED OUT with a header comment
  "INACTIVE — repo is local-only, LICENSE pending; uncomment on first
  public push". Never `on: [push]` while local-only.
- Each stage gets a 20-minute timeout: kill the child and fail the stage on
  expiry. The script must never hang forever.

Forbidden: spawning subagents; self-spawned reviewers; editing anything
outside the two owned paths; adding npm/cargo dependencies; "improving" the
existing ts-three stages.

Gates before you commit (in this order — stop at the first failure):
1. `node --check framework/smoke/smoke.mjs`
2. `node framework/smoke/smoke.mjs --backend ts-three` (fast path)
3. `node framework/smoke/smoke.mjs` (FULL — all three backends; expect
   15+ min, run it in the background and wait)

Worktree: `~/keelcode-work-wave-4a`, branch `wave-4a`, created from master
commit eaa80d2. Symlink node_modules into the worktree — do NOT npm install
fresh:
  ln -s ~/workspace/keelcode/backends/ts-three/node_modules ~/keelcode-work-wave-4a/backends/ts-three/node_modules
  ln -s ~/workspace/keelcode/backends/ts-babylon/node_modules ~/keelcode-work-wave-4a/backends/ts-babylon/node_modules
Playwright browsers are cached at ~/.cache/ms-playwright (shared, nothing to do).
NEVER `git worktree prune`.

Commit: branch `wave-4a`, message `wave 4a: shared smoke CI across all three backends`.
Then write your full report to
`~/workspace/keelcode/tools/pipeline/state/wave-4-briefs/4a-smoke-REPORT.md`
(contract below) and return ONLY: status line + one-line test summary +
concerns (max 5 lines).

Report contract (in the report FILE, not in your reply):
- Files changed (paths), gate commands + exact output tail (last 10 lines),
  deviations from this brief (list; "none" if none), open questions (max 3).
