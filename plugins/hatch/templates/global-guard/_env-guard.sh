#!/usr/bin/env bash
# Shared logic for the global pre-commit/pre-push secret guard.
# Sourced by both hooks in this directory. Not a hook itself.

# Filenames that are always OK to commit even though they look env-like.
SAFE_ENV_PATTERN='(^|/)\.env(\.[A-Za-z0-9_-]+)*\.(example|sample|template)$'

# Path patterns that must never be committed.
BLOCKED_PATTERN='(^|/)\.env($|\.[^/]*$)|(^|/)\.dev\.vars($|\.[^/]*$)|\.pem$|\.p12$|\.pfx$|(^|/)id_rsa$|(^|/)id_ed25519$|(^|/)id_ecdsa$|(^|/)\.npmrc$|(^|/)\.pypirc$|(^|/)\.netrc$|(^|/)credentials\.json$|(^|/)service-account.*\.json$|\.tfvars$'

# Lightweight high-signal secret-format scan for content that slipped into a non-.env file.
# Kept intentionally small (low false-positive) — this is a backstop, not a full scanner.
SECRET_CONTENT_PATTERN='AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|sk-ant-[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'

is_blocked_path() {
  local path="$1"
  if echo "$path" | grep -qiE "$SAFE_ENV_PATTERN"; then
    return 1
  fi
  echo "$path" | grep -qiE "$BLOCKED_PATTERN"
}

check_paths() {
  local mode="$1"; shift
  local offenders=()
  while IFS= read -r path; do
    [ -z "$path" ] && continue
    if is_blocked_path "$path"; then
      offenders+=("$path")
    fi
  done

  if [ ${#offenders[@]} -gt 0 ]; then
    echo "" >&2
    echo "BLOCKED by global git secret guard ($mode): the following file(s) match a" >&2
    echo "credential/secret filename pattern (.env, keys, tokens, etc.):" >&2
    for f in "${offenders[@]}"; do
      echo "  - $f" >&2
    done
    echo "" >&2
    echo "If this is a false positive (e.g. a genuinely safe template file), rename it" >&2
    echo "to end in .example/.sample/.template, or as a last resort override with" >&2
    echo "'git commit --no-verify' / 'git push --no-verify' (NOT recommended)." >&2
    echo "" >&2
    return 1
  fi
  return 0
}

check_content() {
  local ref_range="$1"
  local hits
  hits=$(git diff $ref_range -- . 2>/dev/null | grep -E '^\+' | grep -viE '^\+\+\+' | grep -oE "$SECRET_CONTENT_PATTERN" | sort -u)
  if [ -n "$hits" ]; then
    echo "" >&2
    echo "BLOCKED by global git secret guard: content added in this change looks like a" >&2
    echo "live credential (AWS key, Anthropic/OpenAI/GitHub/Slack token, or private key" >&2
    echo "block). Remove it before committing/pushing." >&2
    echo "" >&2
    return 1
  fi
  return 0
}
