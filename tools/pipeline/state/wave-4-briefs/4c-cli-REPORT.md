# Builder report — wave 4, task 4c: broader keel CLI

Branch: `wave-4c` @ `e5013b8` ("wave 4c: broader keel CLI surface (new/perf/vectors/bake/room)"),
worktree `~/keelcode-work-wave-4c`, based on `wave-4-integration` (confirmed
`a85076e` merge wave-4b / `e238fca` merge wave-4a before writing code).
4 files changed; nothing outside the owned dirs touched; frozen
`framework/smoke/smoke.mjs`, `tools/asset-baker/`, `tools/pipeline/room/`,
`backends/` untouched.

## Files changed

- `tools/keel-cli/bin/keel.mjs` — full Wave 4 surface: `new --backend`,
  `perf`, `vectors`, `bake`, `room`, backend-aware `smoke` passthrough.
  Added a `passthrough()` runner that propagates wrapped tools' exit codes
  verbatim (see deviations). `dev`/`build`/`test` unchanged.
- `tools/keel-cli/test.mjs` — new; 7 suites / 10 tests, node --test, stdlib only.
- `docs/CLI.md` — full reference: every subcommand, flags, exit codes
  (0/1/2), 4 examples.
- `docs/ADRs/0014-keel-cli-surface.md` — subcommand list, rs-core scaffold
  semantics, perf/vectors per-backend mapping (why rs-core degrades to
  informative no-ops), why the CLI stays zero-dep, exit-code note.

## Gates (in brief order) + exact output tails

1. `node --check tools/keel-cli/bin/keel.mjs && node --check tools/keel-cli/test.mjs`
   → `CHECK-OK` (final run; the first run also passed and caught nothing
   structural — the smoke-exit-2 issue was found by test, not by check).

2. `node --test tools/keel-cli/test.mjs` — first run 9/10: smoke test
   failed (`1 !== 2` — smoke's "unknown --backend" printed correctly but my
   `run()` collapsed the exit to 1). After the `passthrough()` fix: 10/10.
   Last 10 lines:
   ```
   ✔ keel room (332.510904ms)
   ▶ keel smoke
     ✔ --backend bogus exits 2 (proves flag forwarding; smoke rejects the name) (209.154671ms)
   ✔ keel smoke (171.829503ms)
   ▶ keel --help
     ✔ documents every new subcommand (91.56694ms)
   ✔ keel --help (91.904955ms)
   ℹ tests 10
   ℹ suites 7
   ℹ pass 10
   ℹ fail 0
   ℹ cancelled 0
   ℹ skipped 0
   ℹ todo 0
   ℹ duration_ms 1505.380489
   ```

3. Manual: `node tools/keel-cli/bin/keel.mjs new /tmp/cli-manual-demo --backend ts-babylon`
   → `Created /tmp/cli-manual-demo (backend: ts-babylon)`; package.json
   name verified `cli-manual-demo`; scratch removed.

## Deviations from the brief

1. **Exit-code propagation change (improvement, not spec-breaking):** the
   brief's test requires `keel smoke --backend bogus` → exit 2, but the
   inherited `run()` helper wrapped every non-zero child exit in a generic
   Error and `main()` always `process.exit(1)` — so smoke's documented exit
   2 never reached the caller. I added a `passthrough()` runner used by
   smoke/bake/room and the perf/vectors stages; it rethrows with
   `err.exitCode` and `main()` honors it. `dev`/`build`/`test` keep the
   old behavior. ADR 0014 records this.
2. **None other.** Subcommand contracts, exit codes (1 for bad
   `--backend` on new/perf/vectors; verbatim forward for smoke/bake/room),
   exact strings (`keel perf: no runnable perf harness for rs-core on
   headless (no GPU)`), copyTree exclusions (`node_modules|dist|target`),
   poll orchestration for ts-babylon perf (60 s, port 4174, kill after),
   rs-core vectors listing — all implemented verbatim per the brief.

## Open questions (max 3)

1. `keel perf --backend ts-babylon` will fail on a fresh checkout when
   `dist/` is missing (vite preview needs a built app). The 4a smoke
   script builds first when `dist/index.html` is absent (reported as a
   deviation); the brief says to mirror only the poll/run/kill
   orchestration, so I did not add a build step. Worth deciding whether
   `keel perf` should also build-first.
2. `keel vectors` recording path requires playwright browsers installed
   in each backend dir; no test covers it (tests never run e2e per the brief).
3. `keel room` execs `room.sh` with cwd=repo root; it lists worktrees from
   the *main* repo, not the worktree — cosmetic, status works.

## Coordinator fix round (after builder handoff)

Ruling on open question 1: YES — `keel perf` and `keel vectors` now build
first. Added `ensureDist(root, backend)` to `tools/keel-cli/bin/keel.mjs`:
when `backends/<b>/dist/index.html` is missing, run `npm run build` in that
backend dir before the harness/recorder — the exact guard the 4a smoke
script uses. Applies to both TS backends, in both `cmdPerf` and
`cmdVectors`. `docs/CLI.md` updated to document it.
Verified: `node --check` clean, `node --test tools/keel-cli/test.mjs`
10/10 green. (The build-first path itself is not unit-tested — it would
trigger a multi-minute vite build; it mirrors the 4a smoke script's
already-verified guard line-for-line.)

1. **`dev`/`build`/`test` do not know about cargo (per the brief's
   explicit non-scope):** `keel dev` runs `npx vite`, `build` runs
   `npx tsc --noEmit && npx vite build`, `test` runs `npx vitest run` —
   all in the nearest `package.json` dir. An rs-core scaffold has no
   `package.json` at top level, so `keel dev/build/test` fail there with
   "Not inside a KeelCode project". The brief says do NOT fix it here;
   this gap is confirmed and reported, not fixed. A future task should
   either teach keel to detect a `Cargo.toml` project root and run
   `cargo` (mirroring the 4a smoke script's rsCoreEnv), or keep the
   documented stance that rs-core scaffolds are run by the user via cargo.
2. **Exit-code contract inconsistency (found, fixed in this task):** as in
   Deviations #1 — the old CLI collapsed all wrapped-tool exit codes to
   1, contradicting the brief's exit-2 requirement for smoke. Now
   propagated verbatim.
3. None other: the ts-babylon `npx vite preview -- --port 4174 --strictPort`
   invocation and the 60 s poll mirror the 4a smoke script exactly
   (verified against `framework/smoke/smoke.mjs` lines 109–160); nothing
   was imported from the wrapped tools.
