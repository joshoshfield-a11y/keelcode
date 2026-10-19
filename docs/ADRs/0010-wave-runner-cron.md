# ADR-0010: Wave runner — cron + state file, not a workflow

Date: 2026-10-19. Status: accepted.

## Context

Waves must launch back-to-back: wave N+1 starts when wave N's gates are
verified green. Two candidate mechanisms: a VM-local workflow (deterministic
JS orchestrating child agents) or a cron tick + state file.

## Decision

**Cron + state file** (`keel-wave-runner` cron ~every 3h running
`tools/pipeline/wave-runner-tick.md`; queue in
`tools/pipeline/state/waves.json`).

## Rationale

- **Survives VM replacement.** All state is JSON on disk under `~`; a
  workflow run's in-memory loop does not survive a daemon restart, and
  recovery paths add machinery we don't need.
- **Matches the approved pattern.** The XANDRIA upgrade loop already runs
  as a cron with on-disk state and a never-merge rule — one operational
  model for both.
- **Cheap idle ticks.** A tick that finds nothing to do reads two small
  JSON files and exits (~hundreds of tokens). A resident workflow holds a
  run slot for days.
- **One wave in flight, verified gates.** The tick reconciles the previous
  wave (spot-checks the coordinator's gate evidence, never blind-trusts,
  never re-runs the suite) before launching the next. Blocked waves stop
  the queue and surface to the user.
- **Brief-gated.** A wave with no brief file is "awaiting brief", never
  launched blind.

## Consequences

- Max queue latency ~3h between a green wave and the next launch (plus the
  tick can be run manually for zero wait).
- The tick agent must stay cheap — real work belongs to coordinators.
  Enforced in `wave-runner-tick.md` hard rules.
- `in_progress_external` waves (e.g. Wave 3's live coordinator) are
  explicitly out of the runner's reach.
