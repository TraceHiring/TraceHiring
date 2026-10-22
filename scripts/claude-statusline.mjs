#!/usr/bin/env node
// Claude Code status line. Shows plan usage + context use, and saves the usage numbers to
// .claude/usage.json so the usage-guard hook can warn Claude before the 5-hour limit.
// rate_limits is only present for claude.ai Pro/Max logins, after the first response.
import fs from 'node:fs';
import path from 'node:path';
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let j = {};
  try {
    j = JSON.parse(raw);
  } catch {}
  const dir =
    j.workspace?.project_dir ||
    j.workspace?.current_dir ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd();
  const rl = j.rate_limits;
  if (rl) {
    try {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, '.claude', 'usage.json'),
        JSON.stringify({
          at: Date.now(),
          five_hour: rl.five_hour ?? null,
          seven_day: rl.seven_day ?? null,
        }),
      );
    } catch {}
  }
  const pct = (x) => (typeof x === 'number' ? `${Math.round(x)}%` : '–');
  const t = (s) =>
    s ? new Date(s * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const parts = [];
  parts.push(j.model?.display_name || 'Claude');
  if (rl?.five_hour)
    parts.push(
      `5h ${pct(rl.five_hour.used_percentage)}${rl.five_hour.resets_at ? ' (resets ' + t(rl.five_hour.resets_at) + ')' : ''}`,
    );
  if (rl?.seven_day) parts.push(`7d ${pct(rl.seven_day.used_percentage)}`);
  const ctx = j.context_window?.used_percentage;
  if (typeof ctx === 'number') parts.push(`ctx ${pct(ctx)}`);
  process.stdout.write(parts.join(' · '));
});
