# Swarm cost research — credit-lean multi-agent methods for KeelCode waves

Date: 2026-10-19. Status: research note feeding the pipeline design
(`tools/pipeline/`, ADRs 0010–0012). Question: how to run agent swarms
(wave builders, room auditors, fixers) with less credit consumption,
without sacrificing gate quality.

Skills read first: `local-vibecoding-general-swarm`, `local-swarm-workspace`,
`local-context-optimization`, `local-dispatching-parallel-agents`,
`local-subagent-driven-development` (SDD). Method sources below are tagged
**[measured]** (instrumented in this sandbox on the real KeelCode repo),
**[observed]** (reported in the skill texts from real sessions), or
**[estimated]** (reasoned, not measured — treat as an order-of-magnitude
guess, not a number to quote).

## What was measured here

### M1. File-based handoffs vs pasted-content briefs — [measured]

Wrote a representative builder brief (1,687 chars, a realistic Babylon
audio-port task). Compared two dispatch styles:

| Style | Dispatch chars |
|---|---|
| Brief pasted inline + framing | 1,863 |
| Lean: path pointer + interface pointers + constraints | 723 |

**Saving: 1,140 chars per dispatch, −61%.** The coordinator never carries
the brief; the builder reads it once from disk. For a wave with 6 builders
held in the coordinator's context across ~15 turns: ~11.2K chars/turn inline
vs ~4.3K chars/turn lean — roughly **1.7K tokens/turn saved** at ~4
chars/token. The brief stays the single source of truth, so there is no
drift between what the coordinator remembers and what the builder reads.

Why it matters beyond chars: the SDD skill records a real session where a
coordinator pasted 42K chars of accumulated history into a dispatch, 99% of
it pasted prior-task summary. History-pasting is the dominant waste mode.

### M2. Shared repo-map instead of per-agent tree reads — [measured]

`backends/ts-three/src`: 21 files, 117,723 bytes raw source. The shared
`repo-map` (symbols + structure): 27,020 bytes — **−77%**.

Pattern: the coordinator generates ONE repo-map (or reuses the committed
one), hands every builder the map path. 4 builders × 117KB of naive
re-reading = ~470KB; with the map: 27KB once + targeted file reads.
Measured saving per 4-builder wave: **~400KB+ of context** that never
enters any agent.

### M3. Gate-first short-circuiting — [observed] + [estimated]

Order gates cheap → expensive and stop at the first failure:
`tsc --noEmit` (seconds) → `vitest run` (~30 s) → Playwright e2e (minutes).
A wave that fails typecheck never pays for an e2e run. The existing
`framework/smoke/smoke.mjs` already stages build → unit → perf in this
order; the pipeline's room checks reuse the same ordering. Estimated
saving per caught-early failure: one full e2e session (~5–15 min of agent
turns and browser time). [estimated]

### M4. Trust reports, don't re-run — [observed]

The SDD skill is explicit: never ask a reviewer to re-run tests the
implementer already ran on the same code — the implementer's report carries
the test evidence. Re-verification = a full duplicate seat. The room's
gate step re-runs gates only at merge boundaries (once per branch merge),
not per review round. [observed]

### M5. Recorded vectors instead of re-recording — [observed]

Wave 2 proved the technique: the parity recorder runs a full Playwright
session once, writes vectors; the smoke test asserts against the stored
vectors forever after. Recording is expensive (browser + hundreds of ticks);
assertion is a file compare. Every backend records its own vectors once.
[observed]

### M6. Non-overlapping directory ownership — [observed]

Each builder owns a disjoint directory set and commits to its own branch.
From the vibecoding-general-swarm skill: group related work into one agent
to minimize cross-agent dependencies; the dispatching skill: agents that
edit the same files interfere and must be sequential. Each merge conflict
costs a fixer round; ownership scoping removes the category. [observed]

### M7. No worker-spawned reviewers — [observed]

SDD: "every reviewer a worker spawned duplicated the task review the
controller dispatched anyway — a full extra review seat per task."
Contract for all KeelCode builders: **no subagents, no self-spawned
reviewers.** Review arrives from the coordinator/room exactly once.
[observed]

### M8. Model tiering by task — [observed], savings [estimated]

From SDD's Model Selection: cheapest tier for transcription/mechanical
tasks (spec contains the complete code to write), mid-tier as the floor
for reviewers and prose-driven implementers, top tier only for
architecture/judgment and the final whole-branch review. Critical nuance:
**turn count beats token price** — cheapest models routinely take 2–3×
the turns on multi-step work and can cost more overall. Rule: tier the
model to the task, and always pass it explicitly (an omitted model
inherits the session's — usually the most capable and most expensive —
which silently defeats tiering). Estimated saving vs all-top-tier:
**~30–50%** on mixed waves. [estimated]

### M9. Bounded fan-out — [observed]

context-optimization: partitioning pays only when savings exceed
coordination overhead; break-even typically needs 3+ subtasks. The
dispatching skill: one agent per independent domain, never parallel when
agents share state. KeelCode rule: **2–4 builders per wave**, each a real
independent domain (engine port / game port / gfx / e2e). Beyond 4, the
coordinator's aggregation context and merge sequencing eat the gains.
[observed]

### M10. Disk ledger, not chat memory — [observed]

SDD's single most expensive observed failure: a controller that lost its
place after compaction re-dispatched entire completed task sequences.
KeelCode waves write progress to `tools/pipeline/state/` (waves.json,
gate results, REPORT.md per builder) — on disk under `~`, surviving
compaction AND VM replacement. `/tmp` is never used for anything a later
step needs. [observed]

### M11. Batched parallel tool calls — [observed]

Independent reads in one turn (one message per call, same block) instead
of sequential turns. Each sequential turn re-reads the full context;
batching collapses N turns into 1. Standard practice, applied everywhere
in the pipeline scripts' operator docs. [observed]

### M12. Stable prompt prefixes — [observed]

context-optimization: KV-cache hit rate collapses when prompts churn
(whitespace, timestamps, reordered sections). The pipeline pins brief
templates byte-for-byte (`builder/brief-template.md`) and keeps dynamic
values (branch names, paths) at the END of dispatch prompts. [observed]

## What this means for a KeelCode wave — honest roll-up [estimated]

Naive baseline: coordinator pastes briefs + history into every dispatch,
every builder re-reads the tree, reviewers re-run tests, no tiering,
unbounded fan-out.

| Lever | Effect |
|---|---|
| File-based handoffs (M1) | −60% dispatch context per builder |
| Shared repo-map (M2) | −~400KB context per 4-builder wave [measured basis] |
| Gate-first short-circuit (M3) | −1 e2e run per early-caught failure |
| Trust reports (M4) + no duplicate reviewers (M7) | −1 full agent seat per task |
| Model tiering (M8) | −30–50% blended model cost |
| Bounded fan-out (M9) | coordination overhead capped |
| Disk ledger (M10) | eliminates the re-dispatch failure mode |

Combined estimate: a wave run under these methods costs roughly **40–60%
less** than the naive baseline at equal gate quality. This is an estimate,
not a measurement: per-model credit pricing and real wave token counts were
not instrumented. The [measured] rows (M1, M2) are the hard numbers; the
rest is disciplined reasoning from the skills.

## Deliberately NOT adopted

- **Cheapest-tier-everything**: loses on turn count (M8).
- **One agent per file**: fan-out beyond independent domains (M9); batch
  same-shape edits into one dispatch (SDD task loop).
- **Re-verifying gates inside the review loop**: the review reads the diff
  file once; tests were already run by the implementer (M4).
- **Cross-backend re-recording**: each backend records its own vectors
  once; the room asserts, never re-records (M5 + determinism dropped).

## How the pipeline applies this (traceability)

- `builder/brief-template.md` — M1, M12 (pinned template, path pointers).
- `tools/pipeline/state/repo-map-*.txt` — M2 (committed, regenerated per wave).
- `room/check-contracts.mjs` — M3 (cheap → expensive, short-circuit), M5.
- `room/integrator-brief.md`, `room/audit-agent-
...[truncated 1346 chars]