// TAP parser for the RLS harness (spec specs/m0-foundations.md §8.3 step 5, AT-3).
// Fail-closed: a run is `ok` only with a valid plan that matches the tests that ran, at least one
// test, no failures, no skips and no bail-out. A `not ok ... # TODO` is not a failure.

const PLAN = /^1\.\.(\d+)\s*(?:#\s*(.*))?$/;
const TEST = /^(not )?ok\b(?:\s+(\d+))?\s*(.*)$/;
const BAIL = /^Bail out!\s*(.*)$/;

function splitDirective(rest) {
  // "- description # SKIP reason" → description, directive, reason. The first unescaped # starts it.
  const m = /^(.*?)(?<!\\)#\s*(skip\S*|todo\S*)\b\s*:?\s*(.*)$/i.exec(rest);
  const raw = m ? m[1] : rest;
  const description = raw.trim().replace(/^-\s*/, '').trim();
  if (!m) return { description, directive: null, reason: '' };
  const directive = m[2].toLowerCase().startsWith('skip') ? 'skip' : 'todo';
  return { description, directive, reason: m[3].trim() };
}

/** Parses one TAP stream. */
export function parseTap(text) {
  const lines = text.split(/\r?\n/);
  const tests = [];
  const problems = [];
  let plan = null;
  let planCount = 0;
  let testsBeforePlan = 0;
  let bailedOut = null;

  for (const line of lines) {
    if (line === '' || /^\s/.test(line) || line.startsWith('#')) continue; // diagnostics, YAML
    if (/^TAP version \d+$/i.test(line)) continue;
    const bail = BAIL.exec(line);
    if (bail) {
      bailedOut = bail[1].trim();
      break;
    }
    const p = PLAN.exec(line);
    if (p) {
      planCount++;
      const end = Number(p[1]);
      const directive = p[2] ?? '';
      const skipAll = end === 0 && /^skip/i.test(directive);
      plan = {
        start: 1,
        end,
        skipAll,
        reason: skipAll ? directive.replace(/^skip\S*\s*/i, '') : '',
      };
      testsBeforePlan = tests.length;
      continue;
    }
    const t = TEST.exec(line);
    if (t) {
      const id = t[2] === undefined ? tests.length + 1 : Number(t[2]);
      tests.push({ ok: !t[1], id, ...splitDirective(t[3]) });
    }
    // Anything else is free text, which TAP consumers ignore.
  }

  if (planCount === 0) problems.push('no plan');
  if (planCount > 1) problems.push('more than one plan');
  if (planCount === 1 && testsBeforePlan > 0 && tests.length > testsBeforePlan) {
    problems.push('plan must come first or last');
  }
  if (plan?.skipAll) problems.push(`all tests skipped (${plan.reason})`);
  if (plan && planCount === 1 && plan.end !== tests.length && !plan.skipAll) {
    problems.push(`plan says ${plan.end} tests but ${tests.length} ran`);
  }
  const outOfOrder = tests.find((t, i) => t.id !== i + 1);
  if (outOfOrder) {
    const i = tests.indexOf(outOfOrder);
    problems.push(`test ids out of sequence: expected ${i + 1}, got ${outOfOrder.id}`);
  }
  if (bailedOut !== null) problems.push(`bail out: ${bailedOut}`);
  if (tests.length === 0) problems.push('no tests');

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let todo = 0;
  for (const t of tests) {
    const label = `${t.id}${t.description ? ` - ${t.description}` : ''}`;
    // A TODO never passes: §8.3 fails on any `not ok`, and a todo() must not hide an RLS gap.
    if (t.directive === 'todo') {
      todo++;
      problems.push(`todo ${label}${t.reason ? ` (${t.reason})` : ''}`);
    } else if (t.directive === 'skip') {
      skipped++;
      problems.push(`skipped ${label}${t.reason ? ` (${t.reason})` : ''}`);
    } else if (t.ok) passed++;
    else {
      failed++;
      problems.push(`not ok ${label}`);
    }
  }

  return {
    plan,
    tests,
    count: tests.length,
    passed,
    failed,
    skipped,
    todo,
    bailedOut,
    problems,
    ok: problems.length === 0,
  };
}

// pg_prove (via `supabase test db`) prints "<file> .. " then, in verbose mode, the file's TAP,
// then a status line. The status lines and the closing summary are not TAP.
const FILE_HEADER = /^(\S.*?\.(?:sql|pg))\s+\.{2,}\s?(.*)$/;
const STATUS = /^(ok|skipped:.*|Failed \d+\/\d+ subtests.*|No subtests run|Dubious,.*)\s*$/;
const SUMMARY = /^(All tests successful\.|Test Summary Report|-{3,}|Files=\d+|Result: )/;

/** Splits pg_prove output into `{ file, ...parseTap() }` per test file. */
export function parseProve(text) {
  const sections = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const header = FILE_HEADER.exec(line);
    if (header) {
      current = { file: header[1], lines: [] };
      sections.push(current);
      const rest = header[2].trim();
      if (rest && !STATUS.test(rest)) current.lines.push(rest);
      continue;
    }
    if (!current) continue;
    if (SUMMARY.test(line)) {
      current = null;
      continue;
    }
    if (STATUS.test(line)) continue;
    current.lines.push(raw);
  }
  return sections.map(({ file, lines }) => ({ file, ...parseTap(lines.join('\n')) }));
}

/**
 * Passing assertions per file-name prefix, e.g. { catalog_: 12, rls_: 50 }. Uses the file's
 * basename. TODO, skipped and failing assertions never count toward a floor.
 */
export function countAssertionsByPrefix(files, prefixes) {
  const counts = Object.fromEntries(prefixes.map((p) => [p, 0]));
  for (const f of files) {
    const base = f.file.split(/[\\/]/).pop();
    const prefix = prefixes.find((p) => base.startsWith(p));
    if (prefix) counts[prefix] += f.passed;
  }
  return counts;
}
