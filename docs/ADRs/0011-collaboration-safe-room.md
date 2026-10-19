# ADR-0011: Collaboration safe room + merge policy

Date: 2026-10-19. Status: accepted.

## Context

Parallel builders produce branches that must be compared and audited for
compatibility before they meet: gate conformance, SPEC contract conformance,
cross-backend compatibility, and coherence/alignment (naming, API shapes,
drift). Merging straight to main risks silent divergence.

## Decision

**The room**: a git worktree on branch `integration-room`, operated by
`tools/pipeline/room/room.sh` and an integrator agent
(`room/integrator-brief.md`).

- Builder branches merge into the room **one at a time**, with
  `check-contracts.mjs` (gates cheap → expensive, short-circuit) after
  each merge. A failed merge stops the line.
- `matrix.mjs` builds the cross-backend **compatibility matrix**: contract
  conformance per backend (gates, `__keel`/CLI surface, 11 schema
  components, physics driver boundary, perf budgets). Explicitly NOT
  cross-backend bit-parity — determinism was dropped (2026-10-18) and
  ADR-0007 proved bit-exactness unachievable across physics engines.
- One **audit agent** (`room/audit-agent-brief.md`, pinned) reviews
  coherence: naming, API shapes, backend drift (renderer-native subsystems
  adopted instead of framework contracts), duplicated logic, contract gaps
  scripts can't see.
- **Correction loop**: each issue → one fixer agent on a narrow brief
  (`room/fixer-brief-template.md`), max 3 rounds, then park with a ruling.
- Output: `COMPATIBILITY-REPORT.md` (merge log, findings + dispositions,
  parked rulings, merge recommendation).
- The room also does **targeted re-audit**: `check-contracts.mjs
  --component <path>` scopes static checks to one file.

## Merge policy

`tools/pipeline/MERGE-POLICY.md`: everything automatic up to the final
merge; merging to main waits on the user's word (`merge_policy:
wait-user`, default). Settable to `auto` only on his explicit word.
Pushes and budget waivers always stay with the user.

## Consequences

- Main stays clean by construction; the room is the only merge surface.
- Audit cost is bounded: scripts do the mechanical work (local compute),
  exactly one model-reasoning seat (the audit agent) per room run.
- Room worktrees are cheap to create/destroy; `room.sh clean` leaves
  branches intact.
