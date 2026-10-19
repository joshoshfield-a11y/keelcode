# ADR-0012: Credit-lean swarm method

Date: 2026-10-19. Status: accepted.

## Context

Standing user rule: reduce credit consumption without sacrificing quality.
The user asked for a researched method, not folk wisdom. Research:
`docs/PIPELINE/SWARM-COST-RESEARCH.md`.

## Decision

Every swarm in the pipeline (wave builders, room fixers, auditors) follows
these rules, encoded in the templates:

1. **File-based handoffs.** Briefs live in files; dispatches carry paths
   (~700 chars), never pasted content. Measured −61% dispatch context.
2. **Shared repo-map.** One 27KB map instead of N agents re-reading 117KB
   of source. Measured −77% per read.
3. **Gate-first short-circuit.** Cheap → expensive; stop at first failure.
4. **Trust reports.** Reviewers read diff files; never re-run tests the
   builder already ran. No worker-spawned reviewers (duplicate seats).
5. **Recorded vectors.** Assert against stored vectors; never re-record.
6. **Non-overlapping directory ownership.** Merge conflicts are a cost
   category; scope them away.
7. **Bounded fan-out: 2–4 builders.** Coordination overhead caps the gains
   past 4; fewer than 3 rarely beats a single agent.
8. **Model tiering, explicit.** Cheapest for transcription, mid-tier floor
   for reviewers/prose tasks, top tier for judgment only. Turn count beats
   token price — cheapest-tier-everything is rejected.
9. **Disk ledger.** Progress in `tools/pipeline/state/`, never chat memory
   alone — the re-dispatch-after-compaction failure mode is the most
   expensive known one.
10. **Pinned templates.** Brief templates byte-stable for cache hit rate;
    dynamic values at the end of prompts.

Estimated combined effect: **40–60% cheaper** than the naive baseline at
equal gate quality (estimate — per-model credit pricing not instrumented;
the −61%/−77% rows are measured).

## Consequences

- Templates are pinned: rewording `brief-template.md` or
  `audit-agent-brief.md` between waves is a deliberate act with a cost note.
- The one deliberate model-reasoning expense per wave is the room's
  coherence audit — everything else mechanical goes to scripts.
