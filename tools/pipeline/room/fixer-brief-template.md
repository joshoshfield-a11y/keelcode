# Fixer brief template (PINNED — fill bracketed fields, hand the fixer the path)

# Fixer brief — <component>: <one-line issue>

Scope: fix EXACTLY the issue below. Nothing else. Do not refactor, do not
"improve" neighboring code.

- Branch: `<branch>` (work in the room worktree or your own worktree of it —
  the integrator tells you which).
- Failing check / finding: <verbatim: gate name + output tail, or the
  audit finding with its evidence file:line>.
- Files you may touch: <paths>. Every other file is frozen for this fix.
- Expected behavior: <what "fixed" means, concretely — the gate passing,
  the API matching the reference signature, etc.>

Gates after the fix (cheap → expensive, stop at first failure):
1. <the failing gate, re-run>
2. <the next gate that covers the touched code>

Commit: same branch, message `room: fix <component> — <one-liner>`.
Append to `<report path>`: what changed, gate output tail, any deviation.

Return ONLY: status line + gate results (max 5 lines). Do not spawn
subagents. Do not touch files outside the listed paths.
