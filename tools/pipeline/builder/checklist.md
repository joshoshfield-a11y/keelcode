# Wave coordinator checklist — parallel builders

Use for any wave that fans out to 2–4 builders. One coordinator, bounded
fan-out, file-based handoffs. (Grounding: SWARM-COST-RESEARCH.md M1–M12,
skills local-vibecoding-general-swarm, local-swarm-workspace,
local-subagent-driven-development.)

## Before dispatching anyone

- [ ] Wave brief read; decomposed into 2–4 INDEPENDENT domains
      (engine port / game port / gfx / e2e is the usual split).
      Fewer than 2 → don't parallelize. More than 4 → regroup.
- [ ] Shared repo-map generated or reused:
      `tools/pipeline/state/repo-map-<scope>.txt` (via `~/tools/bin/repo-map`).
      Builders read the map, not the whole tree.
- [ ] Base commit recorded (`git rev-parse HEAD`) — review diffs need it.
- [ ] For each builder: brief written from `builder/brief-template.md`
      to `tools/pipeline/state/wave-<N>-briefs/<area>-brief.md`.
      Directory ownership disjoint across builders — verify no overlap.

## Per builder dispatch (keep each dispatch < ~700 chars)

- [ ] One line of project context.
- [ ] Brief path ("read this first — it is your requirements").
- [ ] Repo-map path (shared, read-only).
- [ ] Worktree path + branch. Setup pattern (adapted from
      local-swarm-workspace for this sandbox):
      `cd ~/workspace/keelcode && git worktree add ~/keelcode-work-<branch> -b <branch>`
      then copy/symlink `node_modules` into the worktree if the stack needs
      it (worktrees do NOT carry node_modules). NEVER `git worktree prune`.
- [ ] Report file path + the 5-line output contract.
- [ ] Explicit: no subagents, no self-spawned reviewers.
- [ ] Model tier set explicitly per task (SDD Model Selection):
      transcription/mechanical → cheapest tier; prose-driven or
      integration → mid tier; judgment/architecture → top tier.
      Never omit the model.

## When builders report back

- [ ] Read each REPORT.md (files, not pasted chat).
- [ ] Verify no two builders touched the same file (`git diff --stat`
      per branch).
- [ ] Review each branch's diff as a FILE handed to a reviewer agent
      (one reviewer per branch, or one reviewer for small waves) —
      reviewer gets: brief path + report path + diff file. Reviewer does
      NOT re-run tests the builder already ran.
- [ ] Fix loop: resume the same builder with findings (max 3 rounds),
      then fresh builder on a higher tier (rounds 4–5), then adjudicate
      and park with a ruling. Record rulings.
- [ ] Merge reviewed branches into the wave branch (or main, per the
      wave's merge instructions — default: wave branch, main merge waits
      on the user).

## After the wave

- [ ] Full gate run on the merged result (cheap → expensive, short-circuit).
- [ ] Write `tools/pipeline/state/wave-<N>-report.md` (narrative) and
      `tools/pipeline/state/wave-<N>-gates.json` (machine-readable).
- [ ] Remove worktrees (`git worktree remove ~/keelcode-work-<branch>`).
      Do NOT delete the briefs/reports — they are the audit trail.
- [ ] Commit wave work (local git only, no push).
