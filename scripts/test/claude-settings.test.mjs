// .claude/settings.json deny rules (spec §14 S1.0, H7/Q56; widened under the founder's delegation
// of 2026-10-11 21:55 IST, build-notes §0). The rules are a guard rail, not a security boundary:
// this machine holds no Cloudflare or Supabase staging credential by design.
// `matches` mirrors the documented Claude Code rule syntax (code.claude.com/docs/en/permissions):
// `*` matches any text including spaces, a trailing `:*` equals a trailing ` *`, and a trailing
// ` *` also matches the bare command. It is an approximation used to pin intent, not the matcher.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const settings = JSON.parse(readFileSync(path.join(REPO, '.claude', 'settings.json'), 'utf8'));
const bashRules = (list) =>
  list.filter((r) => r.startsWith('Bash(') && r.endsWith(')')).map((r) => r.slice(5, -1));
const DENY = bashRules(settings.permissions.deny);

const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
export function matches(rule, command) {
  let body = rule.endsWith(':*') ? `${rule.slice(0, -2)} *` : rule;
  let tail = '';
  if (body.endsWith(' *')) {
    body = body.slice(0, -2);
    tail = '(?: .*)?';
  }
  const re = new RegExp(`^${body.split('*').map(escape).join('.*')}${tail}$`, 's');
  return re.test(command);
}
const denied = (command) => DENY.some((rule) => matches(rule, command));

const LAUNCHERS = ['', 'npx ', 'pnpx ', 'pnpm ', 'pnpm exec ', 'pnpm dlx '];

describe('matches (rule syntax approximation)', () => {
  it('treats :* and a trailing space-star as "this command, with or without arguments"', () => {
    expect(matches('git push --force:*', 'git push --force')).toBe(true);
    expect(matches('git push --force:*', 'git push --force trace main')).toBe(true);
    expect(matches('ls *', 'lsof')).toBe(false);
    expect(matches('ls*', 'lsof')).toBe(true);
    expect(matches('git push * --force*', 'git push trace --force-with-lease')).toBe(true);
  });
});

describe('deny rules: remote-changing commands are denied under every launcher', () => {
  const cloud = [
    'wrangler deploy',
    'wrangler deploy --env staging',
    'wrangler deploy --env=staging',
    'wrangler deploy -e staging',
    'wrangler versions deploy',
    'wrangler versions upload --env staging',
    'wrangler secret put EXAMPLE --env staging',
    'wrangler secret bulk secrets.json',
    'wrangler secret delete EXAMPLE',
    'wrangler pages deploy apps/candidate/dist --project-name x',
    'wrangler pages project create x',
    'wrangler pages project delete x',
    'wrangler pages secret put EXAMPLE',
    'wrangler delete',
    'wrangler rollback',
    'wrangler triggers deploy',
    'wrangler login',
    'supabase db push',
    'supabase db push --db-url x',
    'supabase migration up --linked',
    'supabase migration up --include-all --db-url x',
    'supabase db reset --linked',
    'supabase db reset --debug --db-url x',
    'supabase functions deploy',
    'supabase functions delete x',
    'supabase secrets set EXAMPLE=x',
    'supabase secrets unset EXAMPLE',
    'supabase config push',
    'supabase link --project-ref x',
    'supabase login',
    'supabase projects delete x',
  ];
  for (const launcher of LAUNCHERS)
    for (const command of cloud)
      it(`denies: ${launcher}${command}`, () => expect(denied(`${launcher}${command}`)).toBe(true));
});

describe('deny rules: history-rewriting pushes and hook bypasses', () => {
  it.each([
    'git push --force trace main',
    'git push trace --force main',
    'git push trace main --force-with-lease',
    'git push trace -f main',
    'git push trace +main',
    'git push trace main +milestone/m0a',
    'git push trace :main',
    'git push trace :milestone/m0a',
    'git push trace :refs/tags/cp/m0a-01',
    'git push trace :cp/m0a-01',
    'git push trace --delete main',
    'git push trace -d main',
    'git push --mirror trace',
    'git push trace --mirror',
    'git push --prune trace',
    'git push trace --prune',
    'git -C some/dir push --force trace main',
    'git -C some/dir push trace -f main',
    'git -C some/dir push trace +main',
    'git -c credential.helper= push trace :main',
    'git -c credential.helper= push trace --delete main',
    'git push trace main --no-verify',
    'git commit --no-verify -m x',
    'git commit -m x --no-verify',
    'git commit -n -m x',
    'git commit -F msg.txt -n',
    'git -C some/dir commit --no-verify -F msg.txt',
    'git merge --no-verify x',
  ])('denies: %s', (command) => expect(denied(command)).toBe(true));
});

describe('deny rules leave the everyday workflow alone', () => {
  it.each([
    // The session-end push (RESUME-PROMPT STEP 5) and tags.
    "git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push trace main milestone/m0a m0a/integration m0a/w1-fixes m0a/s14-lows",
    "git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push trace --tags",
    'git push trace m0a/integration',
    'git push trace m0a/w1-fixes m0a/s14-lows',
    'git commit -F msg.txt',
    'git commit --amend --no-edit -F msg.txt',
    'git merge --no-ff m0a/s2-ui -F msg.txt',
    // The local stack (lead only) and builds.
    'pnpm exec supabase start -x realtime,storage-api',
    'pnpm exec supabase stop',
    'pnpm exec supabase db reset',
    'pnpm exec supabase migration up',
    'pnpm exec supabase status',
    'pnpm --filter @trace/api build',
    'pnpm --filter @trace/edge types:gen',
    'pnpm exec wrangler types',
    'pnpm exec wrangler secret list --env staging --format json',
    'node scripts/check-staging-secrets.mjs',
  ])('allows: %s', (command) => expect(denied(command)).toBe(false));
});

describe('deny rules keep the approved Q56 list', () => {
  it.each([
    'Bash(wrangler deploy --env production:*)',
    'Bash(supabase db push --linked:*)',
    'Bash(git push --force:*)',
    'Bash(git push --delete:*)',
    'Bash(printenv:*)',
    'Read(**/.env)',
    'Read(**/.env.*)',
  ])('still lists %s', (rule) => expect(settings.permissions.deny).toContain(rule));

  it('has no duplicate rules', () => {
    expect(new Set(settings.permissions.deny).size).toBe(settings.permissions.deny.length);
  });
});
