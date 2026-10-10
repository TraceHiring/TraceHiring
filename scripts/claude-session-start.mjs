#!/usr/bin/env node
// SessionStart hook (startup | resume | clear | compact). Its stdout is added to Claude's context,
// so every session — including one after a limit reset or a compaction — starts from the handoff.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const sh = (c) => {
  try {
    return execSync(c, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
};
const out = [];
out.push('=== TRACE SESSION START (injected by .claude hook) ===');
out.push(`Branch: ${sh('git branch --show-current') || 'unknown'}`);
out.push('Last commits:\n' + (sh('git log --oneline -5') || '(none)'));
const dirty = sh('git status --porcelain');
out.push('Uncommitted changes: ' + (dirty ? `${dirty.split('\n').length} file(s)` : 'none'));
const h = path.join(dir, 'docs', 'progress', 'HANDOFF.md');
if (fs.existsSync(h)) {
  const lines = fs.readFileSync(h, 'utf8').split('\n').slice(0, 150);
  out.push('--- docs/progress/HANDOFF.md (first 150 lines) ---');
  out.push(lines.join('\n'));
} else {
  out.push('No docs/progress/HANDOFF.md yet — this is the first session.');
}
out.push(
  'RULES: Treat the handoff as a claim, not a fact. Before continuing, verify it against git log and by running `pnpm verify:fast` (if it exists). If the repo and the handoff disagree, the repo wins — note the mismatch in the handoff.',
);
process.stdout.write(out.join('\n') + '\n');
