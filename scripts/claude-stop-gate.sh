#!/usr/bin/env bash
# Claude Code Stop hook: block "done" while `pnpm verify:fast` fails.
# - No-op until package.json has a "verify:fast" script (before M0 is built).
# - No-op while .claude/allow-red exists (deliberate red tests, or stopping to ask the founder).
# - Skips when nothing changed (content hash) since the last green run.
# - Blocks up to 3 consecutive times, then lets Claude stop with a loud warning so it can ask for help.
# Exit 2 = block and show stderr to Claude; exit 0 = allow.
set -uo pipefail
cat >/dev/null || true
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
[ -f package.json ] || exit 0
grep -q '"verify:fast"' package.json || exit 0
mkdir -p .claude
[ -f .claude/allow-red ] && exit 0
GREEN=".claude/.last-green"; TRIES=".claude/.stop-gate-tries"
HASH="$({ git diff HEAD 2>/dev/null; git ls-files -o --exclude-standard -z 2>/dev/null | xargs -0 -r sha256sum 2>/dev/null; } | sha256sum | cut -d' ' -f1)"
if [ -f "$GREEN" ] && [ "$(cat "$GREEN")" = "$HASH" ]; then exit 0; fi
OUT="$(pnpm -s verify:fast 2>&1)"; CODE=$?
if [ $CODE -eq 0 ]; then printf '%s' "$HASH" > "$GREEN"; rm -f "$TRIES"; exit 0; fi
N=$(( $(cat "$TRIES" 2>/dev/null || echo 0) + 1 )); printf '%s' "$N" > "$TRIES"
if [ "$N" -gt 3 ]; then
  rm -f "$TRIES"
  printf 'WARNING: verify:fast still failing after 3 attempts. Stopping so you can tell the founder exactly what is red and why. Do not claim the task is done.\n' >&2
  exit 0
fi
printf 'pnpm verify:fast failed (attempt %s/3). Fix it before finishing — do not weaken, skip or delete tests. If you are intentionally stopping with red tests, create .claude/allow-red and say so.\n%s\n' "$N" "$(printf '%s' "$OUT" | tail -60)" >&2
exit 2
