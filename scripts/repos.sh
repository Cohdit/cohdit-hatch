#!/usr/bin/env bash
# repos.sh — where every repo behind Hatch stands, so nothing is changed in one and forgotten in another.
#   bash scripts/repos.sh
# Read-only. Prints branch, uncommitted files, and commits not yet pushed or not yet pulled, per repo.
# Which repo owns which change: CLAUDE.md here, and docs/ARCHITECTURE.md in cohdit-hatch-private.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PARENT="$(dirname "$HERE")"
REPOS=(
  "cohdit-hatch|public plugin: code, hooks, stubs"
  "cohdit-hatch-private|private: ALL Hatch content and docs; deploys the content service"
  "cohdit-access|private: site, keys, subscriptions; the API that fetches the content"
  "cohdit-knowledge-software-leader|private: the owner's knowledge; confirmed atoms become lessons"
  "cohdit-knowlege-interviewer|private: tools that read and export the knowledge"
)
problems=0
for entry in "${REPOS[@]}"; do
  name="${entry%%|*}"; role="${entry#*|}"; dir="$PARENT/$name"
  printf '\n%s  (%s)\n' "$name" "$role"
  if [ ! -d "$dir/.git" ]; then printf '  MISSING  clone it beside this repo: git clone git@github.com:Cohdit/%s.git\n' "${name/knowlege/knowledge}"; problems=1; continue; fi
  git -C "$dir" fetch --quiet 2>/dev/null || printf '  warn  could not fetch (offline?)\n'
  branch="$(git -C "$dir" branch --show-current)"
  printf '  branch  %s\n' "${branch:-detached}"
  dirty="$(git -C "$dir" status --porcelain | wc -l | tr -d ' ')"
  [ "$dirty" -gt 0 ] && { printf '  UNCOMMITTED  %s file(s)\n' "$dirty"; problems=1; }
  if git -C "$dir" rev-parse --verify --quiet origin/main >/dev/null; then
    ahead="$(git -C "$dir" rev-list --count origin/main..main 2>/dev/null || echo 0)"
    behind="$(git -C "$dir" rev-list --count main..origin/main 2>/dev/null || echo 0)"
    [ "$ahead" -gt 0 ] && { printf '  UNPUSHED  main is %s commit(s) ahead of origin/main\n' "$ahead"; problems=1; }
    [ "$behind" -gt 0 ] && { printf '  BEHIND  main is %s commit(s) behind origin/main\n' "$behind"; problems=1; }
    if [ -n "$branch" ] && [ "$branch" != main ]; then
      n="$(git -C "$dir" rev-list --count origin/main.."$branch" 2>/dev/null || echo 0)"
      [ "$n" -gt 0 ] && { printf '  UNMERGED  %s has %s commit(s) not on origin/main (what users get comes from main)\n' "$branch" "$n"; problems=1; }
    fi
  fi
done
printf '\n'
if [ "$problems" -eq 0 ]; then echo "repos.sh: every repo is clean, pushed and merged"; else echo "repos.sh: the lines above need a decision before you call anything done"; fi
exit 0
