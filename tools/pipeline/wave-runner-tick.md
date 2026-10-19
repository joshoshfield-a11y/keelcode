# Wave runner — tick instructions (run by the `keel-wave-runner` cron agent)

You are the KeelCode wave-runner tick. Your job is small and mechanical:
advance the wave queue by at most one step per tick. Keep this turn cheap:
read files, decide, act, exit. Do not narrate.

## Step 1 — read state (cheap)

1. Read `tools/pipeline/config.json`. If `enabled` is false, exit quietly
   (one line: "runner disabled").
2. Read `tools/pipeline/state/waves.json`.
3. Use `tools/pipeline/lib/state.mjs` if you want, or just read the JSON.

## Step 2 — reconcile any in-progress wave (cheap)

For each wave with `status: "in_progress"`:
- Check whether its coordinator is still alive (`subagent.list`).
- If the coordinator finished: read its report file
  (`tools/pipeline/state/wave-<N>-report.md`) and its gate results
  (`tools/pipeline/state/wave-<N>-gates.json`). Spot-check ONE gate claim
  against evidence (e.g. open the report's quoted test tail — do NOT
  re-run the suite; the coordinator's report carries the evidence).
- If gates verified: set status `green`, append the gate numbers to the
  wave's `notes`.
- If gates failed or the coordinator reported blocked: set status `blocked`,
  append the reason to `notes`, and STOP — do not launch anything else.
  A blocked wave needs the user's word.
- `in_progress_external` waves are NOT yours. Never touch them.

## Step 3 — launch at most one wave

- Find the launchable wave: status `queued`, a brief file that exists,
  every earlier non-external wave `green`, and no wave `in_progress`.
  (The `nextLaunchableWave` helper in `lib/state.mjs` encodes this.)
- If none: exit quietly (one line with the reason).
- If `auto_launch_waves` is false: exit with "wave N ready to launch
  (auto-launch off)".
- Otherwise, spawn ONE wave coordinator subagent with this contract:
  - Give it the brief path (it reads the brief itself — do NOT paste the
    brief into the dispatch).
  - Tell it: repo `~/workspace/keelcode`, local git only, no push;
    write its final report to `tools/pipeline/state/wave-<N>-report.md`;
    write machine-readable gate results to
    `tools/pipeline/state/wave-<N>-gates.json`
    (`{"gates": {"tsc": "pass|fail", "vitest": "53/53|fail", ...},
      "evidence": {"report": "<path>", ...}, "bundle_size": "..."}`);
    set no wave status itself (you own the state file).
  - Name its work: `wave-<N>-coordinator`.
- Set the wave's status to `in_progress`, record `coordinator` and
  `started` timestamp in its notes. Save the state file.
- Exit. Do NOT wait for the coordinator — the next tick reconciles it.

## Hard rules

- One wave in flight at a time. Never launch wave N+1 until wave N is
  verified `green`.
- Never launch a wave with no brief file ("awaiting brief" is a valid,
  quiet outcome).
- Never touch `backends/ts-babylon/` or any `in_progress_external` wave.
- Never merge anything. Merges wait on the user (`merge_policy` in
  config.json).
- This tick must stay cheap: if you find yourself doing real work, stop
  and exit — real work belongs to wave coordinators.
