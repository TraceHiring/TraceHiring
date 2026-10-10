// Unit tests for scripts/lib/tap.mjs, the TAP parser the S1.7 RLS harness uses (spec §8.3 step 5, AT-3).
import { describe, expect, it } from 'vitest';
import { countAssertionsByPrefix, parseProve, parseTap } from '../lib/tap.mjs';

const lines = (...l) => l.join('\n') + '\n';

describe('parseTap()', () => {
  it('counts a clean run with the plan first', () => {
    const r = parseTap(lines('1..3', 'ok 1 - a', 'ok 2 - b', 'ok 3 - c'));
    expect(r).toMatchObject({ count: 3, passed: 3, failed: 0, skipped: 0, todo: 0, ok: true });
    expect(r.plan).toEqual({ start: 1, end: 3, skipAll: false, reason: '' });
    expect(r.problems).toEqual([]);
  });

  it('accepts the plan last, CRLF endings, a version line and diagnostics', () => {
    const r = parseTap(
      'TAP version 13\r\nok 1 - a\r\n# diagnostic\r\n  indented detail\r\nok 2\r\n1..2\r\n',
    );
    expect(r).toMatchObject({ count: 2, passed: 2, ok: true });
    expect(r.tests[1]).toEqual({ ok: true, id: 2, description: '', directive: null, reason: '' });
  });

  it('reports every failure with its id and description', () => {
    const r = parseTap(lines('1..3', 'ok 1 - a', 'not ok 2 - policy denies other org', 'ok 3'));
    expect(r).toMatchObject({ count: 3, passed: 2, failed: 1, ok: false });
    expect(r.problems).toEqual(['not ok 2 - policy denies other org']);
  });

  it('treats # SKIP as a problem, never as a pass (the harness never skips)', () => {
    const r = parseTap(lines('1..2', 'ok 1 - a', 'ok 2 - b # SKIP no stack'));
    expect(r).toMatchObject({ count: 2, passed: 1, skipped: 1, ok: false });
    expect(r.tests[1]).toMatchObject({ directive: 'skip', reason: 'no stack', description: 'b' });
    expect(r.problems).toEqual(['skipped 2 - b (no stack)']);
  });

  it('recognises skip directives case-insensitively, including the long form', () => {
    const r = parseTap(lines('1..2', 'ok 1 # skip', 'ok 2 - x # Skipped: later'));
    expect(r.skipped).toBe(2);
  });

  it('treats a skip-all plan as a problem', () => {
    const r = parseTap(lines('1..0 # SKIP database not ready'));
    expect(r.plan).toEqual({ start: 1, end: 0, skipAll: true, reason: 'database not ready' });
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('all tests skipped (database not ready)');
  });

  // Spec §8.3 step 5 fails on any `not ok`; a pgTAP todo() must never hide a failing RLS assertion.
  it('fails a failing # TODO test, and a passing one too (TODO is never allowed)', () => {
    const failing = parseTap(lines('1..2', 'ok 1', 'not ok 2 - later # TODO write policy'));
    expect(failing).toMatchObject({ todo: 1, ok: false });
    expect(failing.problems).toContain('todo 2 - later (write policy)');
    const passing = parseTap(lines('1..2', 'ok 1', 'ok 2 - later # TODO write policy'));
    expect(passing).toMatchObject({ todo: 1, ok: false });
  });

  it('detects a plan mismatch in both directions', () => {
    expect(parseTap(lines('1..3', 'ok 1', 'ok 2')).problems).toContain(
      'plan says 3 tests but 2 ran',
    );
    expect(parseTap(lines('1..1', 'ok 1', 'ok 2')).problems).toContain(
      'plan says 1 tests but 2 ran',
    );
  });

  it('fails when there is no plan', () => {
    const r = parseTap(lines('ok 1', 'ok 2'));
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('no plan');
  });

  it('fails on a second plan or a plan in the middle', () => {
    expect(parseTap(lines('1..2', 'ok 1', 'ok 2', '1..2')).problems).toContain(
      'more than one plan',
    );
    expect(parseTap(lines('ok 1', '1..2', 'ok 2')).problems).toContain(
      'plan must come first or last',
    );
  });

  it('fails on ids out of sequence or duplicated', () => {
    const r = parseTap(lines('1..3', 'ok 1', 'ok 3', 'ok 3'));
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('test ids out of sequence: expected 2, got 3');
  });

  it('numbers tests without ids by position', () => {
    const r = parseTap(lines('1..2', 'ok - a', 'ok'));
    expect(r.tests.map((t) => t.id)).toEqual([1, 2]);
    expect(r.ok).toBe(true);
  });

  it('fails on zero tests', () => {
    const r = parseTap('');
    expect(r.count).toBe(0);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('no tests');
  });

  it('fails on Bail out!', () => {
    const r = parseTap(lines('1..3', 'ok 1', 'Bail out! could not connect'));
    expect(r.bailedOut).toBe('could not connect');
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('bail out: could not connect');
  });

  it('does not mistake words that start with ok for test lines', () => {
    const r = parseTap(lines('1..1', 'okay this is noise', 'ok 1'));
    expect(r.count).toBe(1);
  });
});

const PROVE_VERBOSE = lines(
  'supabase/tests/catalog_meta.test.sql .. ',
  '1..2',
  'ok 1 - MT-1 clean',
  'ok 2 - MT-2 clean',
  'ok',
  'supabase/tests/rls_orgs.test.sql ...... 1..3',
  'ok 1 - own org visible',
  'not ok 2 - other org hidden',
  '# Failed test 2',
  'ok 3',
  'Failed 1/3 subtests',
  'supabase/tests/rls_empty.test.sql ..... ',
  'No subtests run',
  '',
  'Test Summary Report',
  '-------------------',
  'Files=3, Tests=5,  1 wallclock secs',
  'Result: FAIL',
);

describe('parseProve()', () => {
  it('splits pg_prove verbose output into one TAP result per file', () => {
    const files = parseProve(PROVE_VERBOSE);
    expect(files.map((f) => f.file)).toEqual([
      'supabase/tests/catalog_meta.test.sql',
      'supabase/tests/rls_orgs.test.sql',
      'supabase/tests/rls_empty.test.sql',
    ]);
    expect(files[0]).toMatchObject({ count: 2, passed: 2, ok: true });
    expect(files[1]).toMatchObject({ count: 3, failed: 1, ok: false });
    expect(files[1].problems).toEqual(['not ok 2 - other org hidden']);
    expect(files[2]).toMatchObject({ count: 0, ok: false });
    expect(files[2].problems).toContain('no tests');
  });

  it('fails closed on non-verbose output, which has no TAP lines to count', () => {
    const files = parseProve(lines('supabase/tests/rls_a.test.sql .. ok', 'All tests successful.'));
    expect(files).toHaveLength(1);
    expect(files[0].ok).toBe(false);
    expect(files[0].problems).toContain('no tests');
  });

  it('returns no files for output without file headers', () => {
    expect(parseProve('nothing here\n')).toEqual([]);
  });
});

describe('countAssertionsByPrefix()', () => {
  it('counts only passing assertions, never TODO, skipped or failing ones', () => {
    const files = [
      {
        file: 'supabase/tests/rls_a.sql',
        ...parseTap(lines('1..4', 'ok 1', 'not ok 2 # TODO x', 'ok 3 # SKIP y', 'not ok 4')),
      },
    ];
    expect(countAssertionsByPrefix(files, ['rls_'])).toEqual({ rls_: 1 });
  });

  it('counts assertions by the file basename prefix, so catalog never counts as rls', () => {
    const files = parseProve(PROVE_VERBOSE);
    // rls_orgs has 3 assertions but "not ok 2" fails, so only 2 count toward the floor.
    expect(countAssertionsByPrefix(files, ['catalog_', 'rls_'])).toEqual({
      catalog_: 2,
      rls_: 2,
    });
  });
});
