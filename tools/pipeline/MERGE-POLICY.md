# Merge policy — KeelCode pipeline

Standing user rule: **no merges without the user's word.** The pipeline is
fully automatic up to the final merge; the merge itself waits.

## What the automation may do without asking

- Create branches and worktrees.
- Merge builder branches into the `integration-room` branch (the room is
  not main; nothing user-facing).
- Run gates, audits, and fix loops inside the room.
- Write reports, matrices, and state files.

## What waits on the user

- Merging `integration-room` (or any wave branch) into `main`.
- Any public push (the repo has no public remote by design; adding one is
  the user's call).
- Waiving a failed budget number (binding no-regression rule,
  framework/SPEC.md §4).
- Changing this policy.

## Configuration

`tools/pipeline/config.json` → `merge_policy`:

| Value | Meaning |
|---|---|
| `wait-user` (default) | Room goes green, then stops and reports. The user says "merge". |
| `auto` | Room merges green branches to main itself. Only set on the user's explicit word. |

Even under `auto`, pushes stay manual and budget waivers stay with the user.
