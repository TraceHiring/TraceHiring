// Assemble supabase/tests/rls_m1_*.test.sql from preamble.sql + bodies/<name>.sql, counting assertions for the plan.
// Usage: node gen.mjs <repo-root> [name ...]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const repo = process.argv[2];
const only = process.argv.slice(3);
const preamble = readFileSync(path.join(here, 'preamble.sql'), 'utf8').trimEnd();
const ASSERT = /^select (is|isnt|ok|matches|doesnt_match|throws_ok|lives_ok|results_eq|set_eq|bag_eq|is_empty|isnt_empty|row_eq|cmp_ok)\(/;
for (const f of readdirSync(path.join(here, 'bodies')).filter((n) => n.endsWith('.sql'))) {
  const name = f.replace(/\.sql$/, '');
  if (only.length && !only.includes(name)) continue;
  const body = readFileSync(path.join(here, 'bodies', f), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  const [header, ...rest] = body.split('\n');
  const n = rest.filter((l) => ASSERT.test(l)).length;
  const out = `${header}\n${preamble}\nselect plan(${n});\n${rest.join('\n')}\nselect * from finish();\nrollback;\n`;
  writeFileSync(path.join(repo, 'supabase', 'tests', `${name}.test.sql`), out);
  console.log(`${name}: ${n}`);
}
