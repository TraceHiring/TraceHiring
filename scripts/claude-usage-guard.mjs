#!/usr/bin/env node
// PostToolUse hook. Reads .claude/usage.json (written by the status line) and tells Claude to
// wrap up before the plan limit. Exit 2 shows the message to Claude without undoing the tool call.
// Thresholds (founder, 2026-10-12): work until 95%. 90% → warn only: start no new agent, task or
// stream, keep working on the current one. 95% → stop new work and start the wrap-up (hand off,
// log, backup, push, print the next prompt).
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = path.join(dir, '.claude', 'usage.json');
const stateFile = path.join(dir, '.claude', 'usage-guard-state.json');
let u;
try {
  u = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch {
  process.exit(0);
}
if (!u || Date.now() - (u.at || 0) > 15 * 60 * 1000) process.exit(0); // stale or missing → do nothing
let state = {};
try {
  state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
} catch {}
const checks = [
  ['five_hour', u.five_hour, 'the 5-hour session limit'],
  ['seven_day', u.seven_day, 'the weekly limit'],
];
for (const [key, lim, label] of checks) {
  const p = lim?.used_percentage;
  if (typeof p !== 'number') continue;
  const level = p >= 95 ? 95 : p >= 90 ? 90 : 0;
  const windowId = `${key}:${lim.resets_at || ''}`;
  if (!level || (state[windowId] || 0) >= level) continue;
  state[windowId] = level;
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } catch {}
  const msg =
    level >= 95
      ? `USAGE GUARD: ${Math.round(p)}% of ${label} used. STOP starting new work and start the wrap-up NOW: commit work in progress, run the trace-handoff skill (write docs/progress/HANDOFF.md, append docs/progress/LOG.md), run scripts/backup.sh and the gitleaks scan, push, then print the next prompt and stop.`
      : `USAGE GUARD: ${Math.round(p)}% of ${label} used. Do not start a new agent, task or stream. Keep working on the current one until 95%, committing at each green step, then the guard tells you to wrap up.`;
  process.stderr.write(msg + '\n');
  process.exit(2);
}
process.exit(0);
