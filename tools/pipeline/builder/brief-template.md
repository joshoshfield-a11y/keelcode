# Builder brief template (PINNED — do not reword between waves; see SWARM-COST-RESEARCH.md M12)

Copy this file to `tools/pipeline/state/wave-<N>-briefs/<area>-brief.md`,
fill the bracketed fields, and hand the BUILDER the file path — never paste
the brief into the dispatch. The dispatch prompt itself stays under ~700
chars: one line of context, the brief path, the repo-map path, the worktree
path/branch, the report path, the output contract.

---

# Builder brief — wave <N> (<wave name>), task: <area>

Scope: <one paragraph: exactly what to build/port, and what "done" means>.
This is a <TRANSCRIPTION|CONSTRUCTION> task — <if transcription: "the
reference file <path> is complete and correct; adapt only the seams listed
below"|if construction: "no reference exists; the contracts below are the
spec">.

Directory ownership: you own <paths> ONLY. Do not touch any other file.
Frozen (never touch): <paths, e.g. backends/ts-three/, backends/rs-core/>.

Reference files (read these, nothing else):
- <path> (the contract / reference implementation)
- <path>

Exact values (use verbatim — do not "improve"):
- <name> = <value>
- <name> = <value>

Seams to adapt (transcription tasks): <list the exact seams, e.g. "three.js
Scene → Babylon Scene; Rapier driver → Havok driver behind the same
boundary">. Everything else ports as-is.

Forbidden: <e.g. adopting Babylon GUI/input/audio/PBR; spawning subagents;
reading files outside your owned directories + the listed references>.

Gates before you commit (in this order — stop at the first failure):
1. <cheapest gate, e.g. `npx tsc --noEmit` in the worktree>
2. <next gate, e.g. `npx vitest run <test file>`>
3. <expensive gate only if cheap ones pass>

Commit: branch `<branch>`, message `<message>`.
Then write your full report to `<report path>` (contract below) and return
ONLY: status line + one-line test summary + concerns (max 5 lines).

Report contract (in the report FILE, not in your reply):
- Files changed (paths), gate commands + exact output tail (last 10 lines),
  deviations from this brief (list; "none" if none), open questions (max 3).
