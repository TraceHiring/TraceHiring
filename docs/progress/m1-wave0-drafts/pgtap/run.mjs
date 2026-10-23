// node run.mjs <name ...>: regenerate the named rls_m1 files and run them; print failures only.
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = process.env.TRACE_REPO ?? 'C:/Users/artra/Arambh data/Trace data/TraceHiring/.claude/worktrees/m1-integration';
const names = process.argv.slice(2);
execFileSync(process.execPath, [path.join(here, 'gen.mjs'), repo, ...names], { stdio: 'inherit' });
const files = names.map((n) => `supabase/tests/${n}.test.sql`);
const r = spawnSync('pnpm', ['exec', 'supabase', 'test', 'db', '--local', ...files], {
  cwd: repo,
  encoding: 'utf8',
  shell: true,
});
const out = `${r.stdout}\n${r.stderr}`;
const lines = out.split('\n').filter((l) => !/^ok \d+/.test(l) && !/Supabase CLI|recommend updating/.test(l));
console.log(lines.join('\n').slice(0, 12000));
