import { describe, expect, expectTypeOf, it } from 'vitest';
import { Constants, type Database } from './index.js';

type PublicTables = keyof Database['public']['Tables'];

describe('@trace/db-types', () => {
  it('exposes only the public schema (spec §8.1: exposed schemas = public)', () => {
    expect(Object.keys(Constants)).toEqual(['public']);
    expectTypeOf<keyof Database>().toEqualTypeOf<'public'>();
  });

  it('has the eight M0b tables and the nine D1 migration-1 tables (specs/d1-demo-slice.md §3.1), no views and no public functions', () => {
    expectTypeOf<
      | 'orgs'
      | 'workspaces'
      | 'teams'
      | 'memberships'
      | 'audit_log'
      | 'platform_staff'
      | 'staff_access_grants'
      | 'idempotency_keys'
      | 'tests'
      | 'rubric_versions'
      | 'notice_versions'
      | 'ruleset_versions'
      | 'test_versions'
      | 'sections'
      | 'item_versions'
      | 'item_answer_keys'
      | 'assignments'
    >().toExtend<PublicTables>();
    // gen types also lists the audit partitions as tables (DC-10); everything else is one of the seventeen.
    expectTypeOf<Exclude<PublicTables, `audit_log_${string}`>>().toEqualTypeOf<
      | 'orgs'
      | 'workspaces'
      | 'teams'
      | 'memberships'
      | 'audit_log'
      | 'platform_staff'
      | 'staff_access_grants'
      | 'idempotency_keys'
      | 'tests'
      | 'rubric_versions'
      | 'notice_versions'
      | 'ruleset_versions'
      | 'test_versions'
      | 'sections'
      | 'item_versions'
      | 'item_answer_keys'
      | 'assignments'
    >();
    expectTypeOf<keyof Database['public']['Views']>().toEqualTypeOf<never>();
    expectTypeOf<keyof Database['public']['Functions']>().toEqualTypeOf<never>();
  });

  it('carries the M0b enums', () => {
    expect(Object.keys(Constants.public.Enums).sort()).toEqual(
      [
        'actor_kind',
        'data_residency',
        'membership_status',
        'org_kind',
        'org_role',
        'org_status',
        'staff_grant_scope',
        'workspace_kind',
      ].sort(),
    );
  });
});
