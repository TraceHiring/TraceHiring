import { describe, expect, expectTypeOf, it } from 'vitest';
import { JOB_NAMES, jobKey, type EvidenceReader, type SqlTx } from './jobs.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const RULESET = '22222222-2222-4222-8222-222222222222';

describe('jobKey (spec d1 §5.1, L-6, L-20)', () => {
  it('is session:job:ruleset for each of the three jobs', () => {
    expect(JOB_NAMES).toEqual(['session_mirror', 'quality_score', 'integrity_band']);
    for (const job of JOB_NAMES) {
      expect(jobKey(SESSION, job, RULESET)).toBe(`${SESSION}:${job}:${RULESET}`);
    }
  });

  it('refuses ids that are not lower-case uuids', () => {
    expect(() => jobKey('not-a-uuid', 'quality_score', RULESET)).toThrow('bad_job_key');
    expect(() => jobKey(SESSION, 'quality_score', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toThrow(
      'bad_job_key',
    );
  });

  it('refuses an unknown job name', () => {
    // @ts-expect-error not a job name
    expect(() => jobKey(SESSION, 'other', RULESET)).toThrow('bad_job_key');
  });
});

describe('injected interfaces', () => {
  it('SqlTx takes constant text and bound parameters only', () => {
    expectTypeOf<SqlTx['query']>().parameter(0).toEqualTypeOf<string>();
    expectTypeOf<Parameters<SqlTx['query']>[1]>().toEqualTypeOf<
      readonly (string | number | boolean | null)[] | undefined
    >();
  });

  it('EvidenceReader is read-only (get and head)', () => {
    expectTypeOf<keyof EvidenceReader>().toEqualTypeOf<'get' | 'head'>();
  });
});
