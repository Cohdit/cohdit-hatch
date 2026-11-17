#!/usr/bin/env bash
# check.sh — everything that must pass before a change lands. CI runs exactly this, on macOS,
# Ubuntu and Windows (Git Bash). Needs Node >= 20 and git; nothing else.
#   bash scripts/check.sh
set -uo pipefail
# Run from a git hook, git exports GIT_INDEX_FILE and friends; the tests build their own temporary repos and must not inherit them.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1
status=0
step() { printf '\n== %s ==\n' "$1"; }
ok()   { printf '  ok    %s\n' "${1:-}"; }
bad()  { printf '  FAIL  %s\n' "$1"; status=1; }
TMPF="$(mktemp -d)"; trap 'rm -rf "$TMPF"' EXIT

# The playbooks, agent briefs, data and maintainer docs are private: they live in the site repo
# (cohdit-hatch-private/hatch-content and cohdit-hatch-private/docs) and reach the plugin through
# scripts/lib/api.js. With them (HATCH_DEV_DIR, or the sibling site repo) every check runs. Without them
# (the public CI) only the code checks run, so no log ever prints private text.
if [ -z "${HATCH_DEV_DIR:-}" ] && [ -d "$ROOT/../cohdit-hatch-private/hatch-content" ]; then
  HATCH_DEV_DIR="$(cd "$ROOT/../cohdit-hatch-private/hatch-content" && pwd)"
fi
CONTENT=0
if [ -n "${HATCH_DEV_DIR:-}" ] && [ -f "$HATCH_DEV_DIR/data/codes.json" ]; then CONTENT=1; fi
command -v cygpath >/dev/null && [ -n "${HATCH_DEV_DIR:-}" ] && HATCH_DEV_DIR="$(cygpath -m "$HATCH_DEV_DIR")"   # node on Windows needs D:/ not /d/
if [ "$CONTENT" -eq 1 ]; then export HATCH_DEV_DIR; else unset HATCH_DEV_DIR; fi
C="${HATCH_DEV_DIR:-}"
CONTRACTS="$C/../docs/CONTRACTS.md"
STUB_END='Otherwise follow the printed instructions exactly as if they were this file.'
if [ "$CONTENT" -eq 1 ]; then echo "content: $C"; else echo "content: none (code-only checks; the full run needs cohdit-hatch-private beside this repo)"; fi
# Steps that read private content say so and are skipped without it.
needs_content() { [ "$CONTENT" -eq 1 ] && return 0; echo "  skipped: needs the private content"; return 1; }

step "node >= 20"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -ge 20 ] 2>/dev/null; then ok "node $(node --version)"; else bad "node $(node --version) is too old"; fi

step "every script parses"
parse_ok=1
while IFS= read -r f; do
  if ! node --check "$f" 2>"$TMPF/err"; then bad "$f: $(head -1 "$TMPF/err")"; parse_ok=0; fi
done < <(find plugins scripts -name '*.js' -not -path '*/node_modules/*')
[ "$parse_ok" -eq 1 ] && ok

step "json is valid"
JSONS=(.claude-plugin/marketplace.json plugins/*/.claude-plugin/plugin.json plugins/*/hooks/hooks.json)
[ "$CONTENT" -eq 1 ] && JSONS+=("$C"/data/*.json)
for f in "${JSONS[@]}"; do
  if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f" 2>/dev/null; then ok "$f"; else bad "$f is not valid JSON"; fi
done

step "manifests agree"
MV="$(node -p 'require("./.claude-plugin/marketplace.json").plugins[0].version')"
PV="$(node -p 'require("./plugins/hatch/.claude-plugin/plugin.json").version')"
if [ "$MV" = "$PV" ]; then ok "version $PV"; else bad "marketplace $MV != plugin $PV"; fi

step "fixtures are regenerable (mkfixtures.js output is byte-identical to what is committed)"
cp -R plugins/hatch/tests/fixtures "$TMPF/before"
node plugins/hatch/tests/mkfixtures.js >/dev/null
# Files only: git cannot store the empty folders mkfixtures makes, so a fresh checkout would always differ.
fxsum() { (cd "$1" && find . -type f -print0 | sort -z | xargs -0 cksum); }
if [ "$(fxsum "$TMPF/before")" = "$(fxsum plugins/hatch/tests/fixtures)" ]; then ok; else bad "fixtures drifted from mkfixtures.js"; fi

step "prices cover every model named in an agent or fixture"
if needs_content; then
MISSING="$(node -e '
const fs = require("fs"), path = require("path");
const prices = require(process.env.HATCH_DEV_DIR + "/data/prices.json").models;
const names = new Set();
const agents = "plugins/hatch/agents";
if (fs.existsSync(agents)) for (const f of fs.readdirSync(agents)) {
  for (const m of fs.readFileSync(path.join(agents, f), "utf8").matchAll(/model:\s*(claude-[\w-]+)/g)) names.add(m[1]);
}
const fx = "plugins/hatch/tests/fixtures";
for (const d of fs.readdirSync(fx)) {
  const runs = path.join(fx, d, "ledger", "runs");
  if (!fs.existsSync(runs)) continue;
  for (const f of fs.readdirSync(runs)) for (const line of fs.readFileSync(path.join(runs, f), "utf8").split("\n")) {
    try { const r = JSON.parse(line); if (r.c === "DISPATCH") names.add(r.f.model); } catch (e) {}
  }
}
names.delete("claude-future-9");   // the deliberately unpriced model in the untrusted fixture
console.log([...names].filter((n) => !(n in prices)).sort().join(",") || "none");')"
if [ "$MISSING" = "none" ]; then ok; else bad "unpriced: $MISSING"; fi
fi

step "prices.json is dated and no older than 90 days (the estimate must say which list it comes from)"
if needs_content; then
AGE="$(node -e '
const p = require(process.env.HATCH_DEV_DIR + "/data/prices.json");
if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || "")) { console.log("undated"); process.exit(0); }
console.log(Math.floor((Date.now() - Date.parse(p.date + "T00:00:00Z")) / 86400000));')"
if [ "$AGE" = "undated" ]; then bad "prices.json has no date"
elif [ "$AGE" -gt 90 ] 2>/dev/null; then bad "prices.json is $AGE days old — re-check the public API list prices and update date"
else ok "prices of $(node -p 'require(process.env.HATCH_DEV_DIR + "/data/prices.json").date') ($AGE days old)"; fi
fi

step "secret patterns: data/secret-patterns.txt matches the global guard"
for name in SAFE_ENV_PATTERN BLOCKED_PATTERN SECRET_CONTENT_PATTERN; do
  a="$(sed -n "s/^$name=//p" plugins/hatch/data/secret-patterns.txt)"
  b="$(sed -n "s/^$name='\(.*\)'$/\1/p" plugins/hatch/templates/global-guard/_env-guard.sh)"
  if [ -n "$a" ] && [ "$a" = "$b" ]; then ok "$name"; else bad "$name differs"; fi
done

step "skills in the plugin are thin stubs"
stub_ok=1
for f in plugins/hatch/skills/*/SKILL.md; do
  [ "$(tail -1 "$f")" = "$STUB_END" ] || { bad "$f does not end with the stub"; stub_ok=0; }
  grep -q 'hatch.js" content skill' "$f" || { bad "$f does not fetch its playbook"; stub_ok=0; }
done
[ "$stub_ok" -eq 1 ] && ok

step "playbooks: <= 100 lines, reference CONTRACTS.md, never restate an enum"
if needs_content; then
found=0; skills_ok=1
for f in "$C"/skills/*/SKILL.md; do
  grep -qF "$STUB_END" "$f" 2>/dev/null && continue
  [ -f "$f" ] || continue
  found=1
  n="$(grep -c '' "$f")"
  [ "$n" -le 100 ] || { bad "$f is $n lines (limit 100)"; skills_ok=0; }
  grep -q "CONTRACTS.md" "$f" || { bad "$f does not reference docs/CONTRACTS.md"; skills_ok=0; }
  if grep -qF -e 'budget|cap|gate_fail_max' -e 'gate|review|contract' -e 'dependency|ambiguous|access' "$f"; then bad "$f restates an enum from codes.json"; skills_ok=0; fi
  grep -q 'hatch.js' "$f" || { bad "$f does not go through scripts/hatch.js (one script, one permission)"; skills_ok=0; }
done
if [ "$found" -eq 0 ]; then echo "  skipped: no playbooks in $C"; elif [ "$skills_ok" -eq 1 ]; then ok; fi
fi

step "interview.json names no technology; stack.json facts are dated and fresh; no skill says 'new chat'"
if needs_content; then
iv_ok=1
HITS="$(grep -niE '\b(next\.?js|react|postgres|sql|database|vercel|github|aws|typescript|javascript|framework|api|server|cloud|hosting provider)\b' "$C"/data/interview.json || true)"
if [ -n "$HITS" ]; then bad "interview.json names a technology:"; printf '%s\n' "$HITS" | sed 's/^/        /'; iv_ok=0; fi
if ! node -e '
  const s = require(process.env.HATCH_DEV_DIR + "/data/stack.json"); const now = Date.now(); let bad = 0;
  for (const cap of Object.keys(s.capabilities)) for (const k of Object.keys(s.capabilities[cap].options)) {
    const e = s.capabilities[cap].options[k];
    const age = (now - Date.parse(e.checked_on)) / 86400000;
    if (!e.checked_on || !(age <= 90)) { console.error("  stack.json " + cap + "." + k + " checked_on " + e.checked_on + " is missing or older than 90 days"); bad = 1; }
    for (const f of ["name","free","docs","skill","scales"]) if (!e[f]) { console.error("  stack.json " + cap + "." + k + " lacks " + f); bad = 1; }
    if (!Array.isArray(e.npm)) { console.error("  stack.json " + cap + "." + k + " lacks its npm package list"); bad = 1; }
  }
  const sc = s.scaffold || {};
  if (!sc.command || !Array.isArray(sc.args) || !sc.checked_on || !((now - Date.parse(sc.checked_on)) / 86400000 <= 90)) { console.error("  stack.json scaffold is missing, undated or older than 90 days"); bad = 1; }
  process.exit(bad);
'; then bad "stack.json"; iv_ok=0; fi
if grep -rqi 'new chat' plugins/hatch/skills "$C"/skills; then bad "a skill says 'new chat' (dropped 2026-10-26)"; iv_ok=0; fi
[ "$iv_ok" -eq 1 ] && ok
fi

step "dream, build and rails.json carry the refusal clause verbatim from CONTRACTS.md"
if needs_content; then
clause="$(sed -n '/^> Cohdit does not build apps in a refused category/,/^$/p' "$CONTRACTS" | sed 's/^> //' | tr '\n' ' ' | sed 's/  */ /g; s/ *$//')"
rc_ok=1
for sk in dream build; do
  f="$C/skills/$sk/SKILL.md"; [ -f "$f" ] || continue
  grep -qF "$STUB_END" "$f" && continue
  body="$(tr '\n' ' ' < "$f" | sed 's/  */ /g')"
  case "$body" in *"$clause"*) ;; *) bad "$f does not carry the refusal clause verbatim"; rc_ok=0;; esac
done
RC_RAILS="$(node -p 'require(process.env.HATCH_DEV_DIR + "/data/rails.json").refusal_clause || ""')"
[ "$RC_RAILS" = "$clause" ] || { bad "rails.json refusal_clause differs from CONTRACTS.md"; rc_ok=0; }
[ "$rc_ok" -eq 1 ] && ok
fi

step "agents: maker, checker, the lenses and the advisor exist, one page each, a contract not a procedure"
ag_ok=1
for a in maker checker lens-security lens-privacy lens-cost advisor; do
  f="plugins/hatch/agents/$a.md"
  [ -f "$f" ] || { bad "$f missing"; ag_ok=0; continue; }
  body="$C/agents/$a.md"
  if [ -f "$body" ] && ! grep -qF "$STUB_END" "$body"; then n="$(grep -c '' "$body")"; [ "$n" -le 60 ] || { bad "$body is $n lines (limit 60)"; ag_ok=0; }; fi
  for key in name description tools model; do grep -q "^$key: " "$f" || { bad "$f lacks $key in its frontmatter"; ag_ok=0; }; done
done
for a in checker lens-security lens-privacy lens-cost advisor; do
  grep -q '^tools: Read, Glob, Grep$' "plugins/hatch/agents/$a.md" || { bad "$a must be read-only"; ag_ok=0; }
done
[ "$CONTENT" -eq 1 ] && for a in checker lens-security lens-privacy lens-cost; do
  grep -q "\"$a\"" "$C"/data/lenses.json || { bad "$a is not a lens in data/lenses.json"; ag_ok=0; }
done
[ "$ag_ok" -eq 1 ] && ok

step "no audience or owner assumptions in product copy"
HITS="$(grep -rniE '\bfamily\b|ask delon|for delon|cohdit team' plugins README.md ${C:+"$CONTRACTS" "$C"/skills "$C"/agents "$C"/data} 2>/dev/null | grep -v '/tests/' || true)"
if [ -z "$HITS" ]; then ok; else bad "found:"; printf '%s\n' "$HITS" | sed 's/^/        /'; fi

step "no operating-system names or install routes in the plugin"
HITS="$(grep -rniE '\b(macos|homebrew|xcode-select|apt-get|winget)\b|python3' plugins/hatch/scripts plugins/hatch/data plugins/hatch/skills plugins/hatch/agents plugins/hatch/hooks ${C:+"$C"/skills "$C"/agents "$C"/data} 2>/dev/null | grep -v 'scripts/lib/tools.js' || true)"   # tools.js is the one file allowed to know where tools live
if [ -z "$HITS" ]; then ok; else bad "found:"; printf '%s\n' "$HITS" | sed 's/^/        /'; fi

step "nothing private in this repo (scripts/ip-guard.js)"
if node scripts/ip-guard.js; then ok; else status=1; fi

step "shellcheck (if installed)"
if command -v shellcheck >/dev/null; then
  files="$(ls scripts/*.sh plugins/*/connectors/*.sh plugins/*/hooks/pre-commit 2>/dev/null)"
  # shellcheck disable=SC2086
  if shellcheck -S warning $files; then ok; else bad "shellcheck"; fi
else echo "  skipped"; fi

for p in plugins/*/; do
  [ -d "$p/tests" ] || continue
  step "node --test ${p%/}"
  # Without the content only the tests that never read it run.
  if [ "$CONTENT" -eq 1 ]; then TESTS=(tests/*.test.js); else TESTS=(tests/api.test.js tests/stubs.test.js tests/ipguard.test.js); fi
  if (cd "$p" && node --test "${TESTS[@]}" > "$TMPF/test.out" 2>&1); then
    grep -E '^# (pass|fail)' "$TMPF/test.out" | tr '\n' ' '; echo
  else
    status=1
    grep -E '^not ok|^# (pass|fail)|error:|expected|actual' "$TMPF/test.out" | head -40
  fi
done

printf '\n'
if [ "$status" -eq 0 ]; then echo "check.sh: all green"; else echo "check.sh: FAILED"; fi
exit $status
