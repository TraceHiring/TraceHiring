import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AiDraftErrorCode,
  AiDraftJobStatus,
  AiDraftJobView,
  ImportErrorCode,
  ImportField,
  ImportJobErrorCode,
  ImportJobStatus,
  MemberInviteStatus,
} from './contracts-m1.js';
import { AuditDetails } from './contracts-tenancy.js';

// The closed lists M1-c and M1-d store (CHECK constraints) must equal the zod enums the api and the apps parse
// (spec review of Wave 0c, finding 2). Migrations are found by suffix: R5-30 re-timestamps them at the D1 CLOSE merge.
const migrations = resolve(import.meta.dirname, '../../..', 'supabase/migrations');
const sqlOf = (suffix: string): string => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  expect(names).toHaveLength(1);
  return readFileSync(resolve(migrations, names[0] ?? ''), 'utf8');
};
const tableOf = (sql: string, table: string): string => {
  const start = sql.indexOf(`create table public.${table} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('\n);', start));
};
/** The values of `<column> in (...)` inside the table's CHECK constraints. */
const checkList = (block: string, column: string): string[] => {
  const m = new RegExp(`\\b${column} in \\(([^)]*)\\)`).exec(block);
  expect(m, `${column} CHECK list`).not.toBeNull();
  return [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((v) => v[1] ?? '').sort();
};
const sorted = (values: readonly string[]) => [...values].sort();

const m1c = sqlOf('_m1_imports_drafts.sql');
const m1d = sqlOf('_m1_members.sql');

describe('M1-c/M1-d closed lists equal the contracts', () => {
  it('import_jobs.status and error_code', () => {
    const t = tableOf(m1c, 'import_jobs');
    expect(checkList(t, 'status')).toEqual(sorted(ImportJobStatus.options));
    expect(checkList(t, 'error_code')).toEqual(sorted(ImportJobErrorCode.options));
  });
  it('import_row_errors.field and error_code', () => {
    const t = tableOf(m1c, 'import_row_errors');
    expect(checkList(t, 'field')).toEqual(sorted(ImportField.options));
    expect(checkList(t, 'error_code')).toEqual(sorted(ImportErrorCode.options));
  });
  it('ai_draft_jobs.status and error_code', () => {
    const t = tableOf(m1c, 'ai_draft_jobs');
    expect(checkList(t, 'status')).toEqual(sorted(AiDraftJobStatus.options));
    expect(checkList(t, 'error_code')).toEqual(sorted(AiDraftErrorCode.options));
  });
  it('member_invites.status', () => {
    expect(checkList(tableOf(m1d, 'member_invites'), 'status')).toEqual(
      sorted(MemberInviteStatus.options),
    );
  });
});

describe('job error codes are enums, never open strings (R5-14, R5-26)', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  it('import.fail takes only an import job code', () => {
    expect(
      AuditDetails['import.fail'].safeParse({ import_job_id: id, error_code: 'row_limit' }).success,
    ).toBe(true);
    expect(
      AuditDetails['import.fail'].safeParse({ import_job_id: id, error_code: 'drafter_error' })
        .success,
    ).toBe(false);
  });
  it('ai_draft.fail takes only a drafting job code', () => {
    expect(
      AuditDetails['ai_draft.fail'].safeParse({
        ai_draft_job_id: id,
        error_code: 'no_draft_passed',
      }).success,
    ).toBe(true);
    expect(
      AuditDetails['ai_draft.fail'].safeParse({ ai_draft_job_id: id, error_code: 'row_limit' })
        .success,
    ).toBe(false);
  });
  it('AiDraftJobView.errorCode is a drafting job code', () => {
    const job = {
      id,
      status: 'failed',
      format: 'mcq',
      skillKey: 'verbal',
      difficulty: 0.5,
      count: 2,
      draftsCreated: 0,
    };
    expect(AiDraftJobView.safeParse({ ...job, errorCode: 'timeout' }).success).toBe(true);
    expect(AiDraftJobView.safeParse({ ...job, errorCode: 'something_else' }).success).toBe(false);
  });
});
