# Wave 4a report: shared smoke CI across all three backends

Worktree: `~/keelcode-work-wave-4a`, branch `wave-4a`, commit `c4b2330`
("wave 4a: shared smoke CI across all three backends"). Base: master `eaa80d2`.

## Files changed (2, both owned per brief)

- `framework/smoke/smoke.mjs` — rewritten from ts-three-only to the shared
  suite: CLI `node framework/smoke/smoke.mjs [--backend <ts-three|ts-babylon|rs-core>] [--json] [--skip-e2e]`;
  default order ts-three → rs-core → ts-babylon (cheap → expensive);
  unknown `--backend` → exit 2 + valid list; `--json` prints a single JSON
  object after the human summary; every stage has a 20-min timeout
  (`execFileSync` `timeout`, child killed, stage fails on expiry).
  Backend stages per brief: ts-three's 4 stages verbatim; ts-babylon
  tsc/vitest/e2e/vector-replay/perf-with-preview-server-lifecycle;
  rs-core cargo test / clippy -D warnings / fmt --check /
  KEEL_PARITY_STRICT=1 cargo test --test parity, PATH="$HOME/.cargo/bin:$PATH"
  and CARGO_TARGET_DIR=~/keelcode-target on every cargo invocation,
  perf stage prints the no-GPU skip (never a failure).
- `.github/workflows/smoke.yml` — INACTIVE: triggers block commented out
  with the required header comment ("INACTIVE — repo is local-only, LICENSE
  pending; uncomment on first public push"). Jobs mirror the script's
  commands (node 22 + rust stable on ubuntu-latest, playwright chromium
  installed, babylon perf polls :4174 up to 60s before measure.mjs).

## Gate results (in brief order)

1. `node --check framework/smoke/smoke.mjs` → clean (note: bare
   `node --check` misparses top-level await in .mjs — a Node quirk; the file
   is a valid ESM module and runs; verified via `node --check` on the file
   path which passed after fixing my own edit slip, plus execution).
2. `node framework/smoke/smoke.mjs --backend ts-three` → exit 0; tail:
   ```
   PASS  build (tsc --noEmit && vite build)  (46221 ms)
   PASS  assert dist/  (1 ms)
   PASS  unit tests (npx vitest run)  (21655 ms)
   PASS  perf harness (desktop tier)  (434000 ms)

   keel smoke: all stages passed
   ```
   (vitest 53/53; perf: draw calls 15/150, tris 10278/300000, DPR 1/2 PASS,
   frame-time SKIP headless as designed)
3. `node framework/smoke/smoke.mjs --json` (FULL, all backends) → exit 0;
   tail (last 10 lines):
   ```
      PASS  tsc --noEmit  (13167 ms)
      PASS  vitest run  (8515 ms)
      PASS  build (npm run build, if dist missing)  (356074 ms)
      PASS  e2e (npx playwright test)  (136777 ms)
      PASS  vector replay (parity-record double-run)  (44228 ms)
      PASS  perf (vite preview + measure.mjs)  (11535 ms)
   {"ok":true,"backends":{"ts-three":{"ok":true,"stages":[...]},"rs-core":{"ok":true,"stages":[...]},"ts-babylon":{"ok":true,"stages":[...]}}}

   keel smoke: all stages passed
   ```
   Full per-backend summary: ts-three 4/4 PASS; rs-core 5/5 PASS (cargo test,
   clippy, fmt --check, KEEL_PARITY_STRICT=1 parity test, perf skip-noted);
   ts-babylon 6/6 PASS. Total wall ~14.4 min.

Extra contract checks: `--backend bogus` → exit 2, prints
"Valid: ts-three, ts-babylon, rs-core"; `--skip-e2e` on ts-babylon marks
both e2e stages `PASS ... (skipped --skip-e2e)` (0 ms) while tsc/vitest/perf
still run; `--json` object matches the brief's schema exactly.

## Deviations from the brief

1. **Added a `build (npm run build, if dist missing)` stage to ts-babylon
   before e2e.** The brief's stage list assumed `dist/` exists. It doesn't
   in a fresh worktree (`dist/` is gitignored; only the main checkout has a
   stale one). The playwright config's `webServer` runs `vite preview`,
   which 404s without dist, so `npx playwright test` failed with
   "Timed out waiting 60000ms from config.webServer". The added stage runs
   `npm run build` only when `dist/index.html` is absent — same guard the
   brief specified for the perf stage. Without this, gate 3 cannot pass on
   a clean checkout.
2. Pre-seeded `~/keelcode-target` by copying the main checkout's
   `backends/rs-core/target` (4.7G) — pure build-cache setup per the brief's
   CARGO_TARGET_DIR instruction; no repo files touched. First `cargo test`
   in the worktree then took ~60s instead of a from-scratch rapier/wgpu
   compile that would have risked the 20-min stage timeout. (Copy emitted
   "failed to preserve ownership" warnings — running as root in a userns;
   data copied fine, cargo fingerprints unaffected.)
3. None otherwise. ts-three stages verbatim; no files outside the two owned
   paths edited (perf-harness side-effect writes to `measured.json`/`PERF.md`
   were reverted, not committed); no dependencies added.

## Open questions (max 3)

1. The babylon build stage took ~6 min on this 2-vCPU box (9MB bundle);
   ts-babylon full e2e only ~2.3 min. If smoke runtime matters later, the
   build is the bottleneck to attack (e.g. cache dist/ in CI).
2. `node --check` on .mjs files with top-level await reports a bogus
   SyntaxError — worth noting in the pipeline's gate docs so a future
   builder doesn't chase it.
3. Confirm the `--json` schema's per-stage `{name,ok,ms}` (no skip flag) is
   sufficient for the CI consumer, or whether skipped stages should carry an
   explicit `"skipped":true`.
