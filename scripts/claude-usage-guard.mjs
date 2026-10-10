#!/usr/bin/env node
// PostToolUse hook. Reads .claude/usage.json (written by the status line) and tells Claude to
// wrap up before the plan limit. Exit 2 shows the message to Claude without undoing the tool call.
// Thresholds: 80% → finish the current small step, then hand off. 90% → hand off now.
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = path.join(dir, '.claude', 'usage.json');
const stateFile = path.join(dir, '.claude', 'usage-guard-state.json');
let u;
try { u = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { process.exit(0); }
if (!u || Date.now() - (u.at || 0) > 15 * 60 * 1000) process.exit(0); // stale or missing → do nothing
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
const checks = [
  ['five_hour', u.five_hour, 'the 5-hour session limit'],
  ['seven_day', u.seven_day, 'the weekly limit'],
];
for (const [key, lim, label] of checks) {
  const p = lim?.used_percentage;
  if (typeof p !== 'number') continue;
  const level = p >= 90 ? 90 : p >= 80 ? 80 : 0;
  const windowId = `${key}:${lim.resets_at || ''}`;
  if (!level || (state[windowId] || 0) >= level) continue;
  state[windowId] = level;
  try { fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}
  const msg = level >= 90
    ? `USAGE GUARD: ${Math.round(p)}% of ${label} used. STOP starting new work. Run the trace-handoff skill NOW: commit work in progress to the milestone branch, write docs/progress/HANDOFF.md, append docs/progress/LOG.md, then print the resume prompt and stop.`
    : `USAGE GUARD: ${Math.round(p)}% of ${label} used. Finish only the current small step (do not start a new task or stream), make sure tests for it are green or marked in the handoff, then run the trace-handoff skill and stop.`;
  process.stderr.write(msg + '\n');
  process.exit(2);
}
process.exit(0);
