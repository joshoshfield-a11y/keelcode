# KeelCode build pipeline

Automated wave orchestration + the collaboration safe room. Three pieces:

1. **Wave runner** — launches waves back-to-back: when wave N's gates are
   verified green, wave N+1 starts automatically. Driven by the
   `keel-wave-runner` cron (~every 3h) executing
   `tools/pipeline/wave-runner-tick.md`, with queue state in
   `tools/pipeline/state/waves.json`.
2. **Parallel builders** — a wave coordinator fans out to 2–4 builders,
   each in its own git worktree, each with a tight file-based brief and
   non-overlapping directory ownership. Template + checklist in
   `tools/pipeline/builder/`.
3. **Collaboration safe room** — builder branches merge one-by-one into
   the `integration-room` worktree (never main), get audited by scripts
   plus a coherence audit agent, get fixed in bounded loops, and only
   leave the room when green. Operator: `tools/pipeline/room/room.sh`.

Credit-lean swarm methods are baked in throughout — see
[SWARM-COST-RESEARCH.md](SWARM-COST-RESEARCH.md) (measured: −61% dispatch
context via file handoffs, −77% tree reads via shared repo-map).

## Running the runner

The cron `keel-wave-runner` ticks on its own. To tick manually (cheap):

```bash
# read-only: what would the runner do?
node -e "
import('./tools/pipeline/lib/state.mjs').then(m => {
  const doc = m.readWaves();
  console.log(JSON.stringify(m.nextLaunchableWave(doc), null, 2));
});"
```

To pause the automation: set `enabled: false` in
`tools/pipeline/config.json` (or delete/disable the cron). To let a wave
through without auto-launch: `auto_launch_waves: false`.

## Launching a wave by hand

1. Write the wave brief (model on `~/workspace/game-kb/WAVE2-BRIEF.md`).
2. Add a row to `tools/pipeline/state/waves.json`:
   `status: "queued"`, `brief: "workspace/game-kb/WAVE4-BRIEF.md"`.
   No brief file → the runner reports "awaiting brief" and launches nothing.
3. Either wait for the next tick or spawn the coordinator yourself with the
   brief path + the gate/state contract in `wave-runner-tick.md` step 3.

## Using the room

```bash
tools/pipeline/room/room.sh init            # create the room worktree
tools/pipeline/room/room.sh merge wave4/gfx # merge one builder branch
tools/pipeline/room/room.sh audit --backend ts-three
tools/pipeline/room/room.sh report          # assemble COMPATIBILITY-REPORT.md
tools/pipeline/room/room.sh status
tools/pipeline/room/room.sh clean           # remove worktree (branches kept)
```

Full room runs use the integrator: dispatch an agent with
`tools/pipeline/room/integrator-brief.md`. Targeted re-audit of one
component:

```bash
node tools/pipeline/room/check-contracts.mjs --backend ts-three --component src/engine/audio.ts
```

## Merge policy

`tools/pipeline/MERGE-POLICY.md`: the room is fully automatic up to the
final merge, which waits on the user's word (`merge_policy: wait-user`,
the default).

## Layout

```
tools/pipeline/
  config.json            # enabled, auto_launch_waves, merge_policy, paths
  MERGE-POLICY.md
  wave-runner-tick.md    # cron agent instructions (one cheap step per tick)
  lib/state.mjs          # state helpers (atomic JSON writes)
  state/
    waves.json           # the wave queue (the runner owns this file)
    wave-<N>-report.md   # coordinator narrative reports
    wave-<N>-gates.json  # machine-readable gate results
    repo-map-<scope>.txt # shared repo-maps for builders
  builder/
    brief-template.md    # PINNED dispatch template (file-based handoffs)
    checklist.md         # coordinator checklist (fan-out, review, merge)
  room/
    room.sh              # init|merge|audit|report|status|clean
    check-contracts.mjs  # gates (cheap→expensive) + static SPEC conformance
    matrix.mjs           # cross-backend compatibility matrix
    integrator-brief.md  # the agent that runs the room end-to-end
    audit-agent-brief.md # coherence/alignment review (PINNED)
    fixer-brief-template.md
    compat-report-template.md
    out/                 # per-run artifacts (gitignored)
docs/PIPELINE/
  README.md              # this file
  SWARM-COST-RESEARCH.md # the credit-lean research grounding
```

Design decisions: ADRs 0010 (runner), 0011 (room + merge policy),
0012 (credit-lean swarm method).
