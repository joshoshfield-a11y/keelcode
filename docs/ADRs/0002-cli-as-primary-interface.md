# ADR 0002 — CLI plus agent skills as the primary interface

Date: 2026-10-18. Status: accepted. Decided by: the user.

## Context

Game engines traditionally ship an editor: a visual tool for scene
assembly, property editing, and asset management. Building one is a
multi-year commitment and usually happens before there is a game to put
in it. KeelCode is a two-person workshop — the user and the agent —
where games get built conversationally.

## Decision

The `keel` CLI (in `tools/keel-cli/`) and the 23 agent skills in the
knowledge base are the primary interface for building games on
KeelCode. Conversational builds with the agent are the editor.

## Rationale

- The user's words on 2026-10-18: this is a CLI / vibe-coding engine
  for the two of us. Scaffolding a game, running it, testing it, and
  shipping it should all be one command away.
- The skills already encode the build playbooks (core loop, physics,
  perf budgets, QA gates). The CLI gives those playbooks a handle.
- Building a visual editor before a game is how engines die (per the
  architecture proposal §6). The Babylon backend keeps the door open
  with its free web editor; a KeelCode editor only lands if a shipped
  game needs it.

## Consequences

- `keel new / dev / build / test / smoke` are the five verbs every game
  is built with. They must work before any wave's demo work starts.
- Agent builds reference the skills as playbooks; new engine-specific
  playbooks get LEDGER provenance rows like everything else.
- Wave 4 (convergence) may add editor affordances, but only on evidence
  from a shipped game.
