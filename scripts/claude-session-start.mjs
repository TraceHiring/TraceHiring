#!/usr/bin/env node
// SessionStart hook (startup | resume | clear | compact). Its stdout is added to Claude's context,
// so every session — including one after a limit reset or a compaction — starts from the handoff.
// The live handoff is on the newest `<milestone>/integration` branch (local or remote-tracking), not
// on the checkout's branch: `main` moves only at a milestone CLOSE (founder decision, 2026-10-11,
// docs/build-notes.md §0). TRACE_INTEGRATION_BRANCH overrides the choice.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Larger hook output is moved to a file and only a short preview reaches the session.
const MAX_BYTES = 9000;
const size = (s) => Buffer.byteLength(s, 'utf8');
const MAX_LINES = 150;
const HANDOFF = 'docs/progress/HANDOFF.md';

const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const git = (args) => {
  try {
    return execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
};

/** A plain branch name only: no option-looking or revision-syntax values reach git. */
const isPlainRef = (name) => /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) && !name.includes('..');

function integrationRef() {
  const forced = process.env.TRACE_INTEGRATION_BRANCH || '';
  if (isPlainRef(forced) && git(['rev-parse', '--verify', '--quiet', `refs/heads/${forced}`])) {
    return forced;
  }
  const refs = git([
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)',
    'refs/heads/*/integration',
    'refs/remotes/*/*/integration',
  ]);
  return refs.split('\n').find(Boolean) || '';
}

const branch = git(['branch', '--show-current']) || 'unknown';
const head = [];
head.push('=== TRACE SESSION START (injected by .claude hook) ===');
head.push(`Branch: ${branch}`);
head.push('Last commits:\n' + (git(['log', '--oneline', '-5']) || '(none)'));
const dirty = git(['status', '--porcelain']);
head.push('Uncommitted changes: ' + (dirty ? `${dirty.split('\n').length} file(s)` : 'none'));

let source = '';
let text = '';
const ref = integrationRef();
if (ref) {
  text = git(['show', `${ref}:${HANDOFF}`]);
  if (text) {
    const sha = git(['rev-parse', '--short', ref]);
    source = ref;
    head.push(
      `Live integration branch: ${ref} @ ${sha}. The procedure is docs/progress/RESUME-PROMPT.md on that branch.`,
    );
    const local = ref.replace(/^[^/]+\/(?=[^/]+\/integration$)/, '');
    if (branch !== ref && branch !== local) {
      head.push(
        `NOTE: this checkout is on \`${branch}\`, not on \`${local}\`. Work on the integration branch; ` +
          `read files there with \`git show ${ref}:<path>\`.`,
      );
    }
  }
}
if (!text) {
  const h = path.join(dir, HANDOFF);
  if (fs.existsSync(h)) {
    text = fs.readFileSync(h, 'utf8');
    source = 'this checkout';
  }
}

const tail =
  'RULES: Treat the handoff as a claim, not a fact. Before continuing, verify it against git log and by running `pnpm verify:fast` (if it exists). If the repo and the handoff disagree, the repo wins — note the mismatch in the handoff.';

const out = [...head];
if (text) {
  const lines = text.replace(/\n$/, '').split('\n');
  const readAll = source === 'this checkout' ? HANDOFF : `git show ${source}:${HANDOFF}`;
  const title = `--- ${HANDOFF} from ${source} ---`;
  const cut = (shown) =>
    `… (truncated: ${shown} of ${lines.length} lines shown; read it all: ${readAll})`;
  // Budget: header + title + handoff lines + truncation note + rules, each joined by '\n'.
  const fixed = size(out.join('\n')) + size(title) + size(cut(lines.length)) + size(tail) + 4;
  let used = fixed;
  let shown = 0;
  while (shown < lines.length && shown < MAX_LINES && used + size(lines[shown]) + 1 <= MAX_BYTES) {
    used += size(lines[shown]) + 1;
    shown += 1;
  }
  out.push(title);
  out.push(lines.slice(0, shown).join('\n'));
  if (shown < lines.length) out.push(cut(shown));
} else {
  out.push('No docs/progress/HANDOFF.md yet — this is the first session.');
}
out.push(tail);
process.stdout.write(out.join('\n') + '\n');
