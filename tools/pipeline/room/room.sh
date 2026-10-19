#!/usr/bin/env bash
# room.sh — collaboration safe room operator.
# The room is a git worktree on branch `integration-room`: builder branches
# merge here one by one, get audited, get fixed, and ONLY leave the room for
# main when everything is green AND the user says so.
#
# Usage:
#   room.sh init                  create (or reuse) the room worktree
#   room.sh merge <branch>        merge one builder branch into the room
#   room.sh audit [--backend N]   run check-contracts + matrix (read-only)
#   room.sh report                assemble COMPATIBILITY-REPORT.md
#   room.sh status                show room worktree + candidate branches
#   room.sh clean                 remove the room worktree (branches kept)
#
# The room never touches main. Merges to main wait on the user (see
# tools/pipeline/MERGE-POLICY.md).

set -euo pipefail

REPO="$HOME/workspace/keelcode"
ROOM="$HOME/keelcode-room"
BRANCH="integration-room"
ROOMDIR="$REPO/tools/pipeline/room"

# config overrides (room_worktree, room_branch)
if [ -f "$REPO/tools/pipeline/config.json" ]; then
  cfg_room="$(node -p "JSON.parse(require('fs').readFileSync('$REPO/tools/pipeline/config.json','utf8')).room_worktree || ''" 2>/dev/null || true)"
  cfg_branch="$(node -p "JSON.parse(require('fs').readFileSync('$REPO/tools/pipeline/config.json','utf8')).room_branch || ''" 2>/dev/null || true)"
  [ -n "$cfg_room" ] && ROOM="$cfg_room"
  [ -n "$cfg_branch" ] && BRANCH="$cfg_branch"
  case "$ROOM" in "~"*) ROOM="$HOME${ROOM:1}";; esac
fi

cmd="${1:-status}"

case "$cmd" in
  init)
    if [ -d "$ROOM" ]; then
      echo "room exists: $ROOM"
    else
      cd "$REPO"
      if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
        git worktree add "$ROOM" "$BRANCH"
      else
        git worktree add -b "$BRANCH" "$ROOM" HEAD
      fi
      echo "room ready: $ROOM (branch $BRANCH)"
    fi
    ;;

  merge)
    br="${2:?usage: room.sh merge <branch>}"
    [ -d "$ROOM" ] || { echo "no room — run room.sh init first"; exit 1; }
    cd "$ROOM"
    git fetch origin 2>/dev/null || true
    git merge --no-ff --no-edit "$br"
    echo "merged $br into $BRANCH"
    ;;

  audit)
    shift
    node "$ROOMDIR/check-contracts.mjs" "$@"
    node "$ROOMDIR/matrix.mjs"
    ;;

  report)
    [ -d "$ROOM" ] || { echo "no room — run room.sh init first"; exit 1; }
    node "$ROOMDIR/matrix.mjs" >/dev/null
    cp "$ROOMDIR/out/matrix.md" "$ROOM/COMPATIBILITY-REPORT.md"
    cat "$ROOMDIR/compat-report-template.md" >> "$ROOM/COMPATIBILITY-REPORT.md"
    echo "wrote $ROOM/COMPATIBILITY-REPORT.md — fill the audit-agent section next"
    ;;

  status)
    echo "repo: $REPO"
    git -C "$REPO" worktree list
    echo "--- branches ---"
    git -C "$REPO" branch --list | head -20
    ;;

  clean)
    cd "$REPO"
    git worktree remove --force "$ROOM" 2>/dev/null && echo "room removed" || echo "no room worktree"
    ;;

  *)
    echo "unknown: $cmd (init|merge|audit|report|status|clean)"
    exit 1
    ;;
esac
