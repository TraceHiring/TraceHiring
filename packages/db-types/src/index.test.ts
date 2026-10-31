import { describe, expect, expectTypeOf, it } from 'vitest';
import { Constants, type Database } from './index.js';

type PublicTables = keyof Database['public']['Tables'];

describe('@trace/db-types', () => {
  it('exposes only the public schema (spec §8.1: exposed schemas = public)', () => {
    expect(Object.keys(Constants)).toEqual(['public']);
    expectTypeOf<keyof Database>().toEqualTypeOf<'public'>();
  });

  it('has the eight M0b tables and the nineteen D1 migration-1 to migration-3 tables (specs/d1-demo-slice.md §3.1), the M1 tables, views and M1-c functions', () => {
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
      | 'invitations'
      | 'consents'
      | 'sessions'
      | 'session_items'
      | 'responses'
      | 'media_objects'
      | 'quality_cards'
      | 'integrity_cards'
      | 'integrity_timeline_entries'
      | 'reports'
    >().toExtend<PublicTables>();
    // gen types also lists the audit partitions as tables (DC-10); everything else is one of the twenty-seven.
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
      | 'invitations'
      | 'consents'
      | 'sessions'
      | 'session_items'
      | 'responses'
      | 'media_objects'
      | 'quality_cards'
      | 'integrity_cards'
      | 'integrity_timeline_entries'
      | 'reports'
      // M1 migration M1-a (specs/m1-test-authoring.md §3.2)
      | 'skill_taxonomy'
      | 'items'
      | 'item_variants'
      | 'item_variant_keys'
      | 'item_exposure_events'
      | 'pools'
      | 'pool_items'
      | 'library_copy_requests'
      // M1 migration M1-b (specs/m1-test-authoring.md §3.2)
      | 'role_templates'
      | 'jobs'
      | 'section_pool_snapshot'
      | 'integrity_setting_defs'
      | 'integrity_presets'
      | 'org_integrity_locks'
      // M1 migrations M1-c and M1-d (specs/m1-test-authoring.md §3.2)
      | 'import_jobs'
      | 'import_row_errors'
      | 'ai_draft_jobs'
      | 'member_invites'
      // M2 migrations M2-a and M2-b (specs/m2-scheduling-invites.md §3.2)
      | 'org_keys'
      | 'candidates'
      | 'candidate_contacts'
      | 'drives'
      | 'slots'
      | 'invite_uploads'
      | 'invite_upload_errors'
      | 'reschedule_events'
      // M2 migration M2-c (specs/m2-scheduling-invites.md §3.4)
      | 'message_templates'
      | 'outbound_messages'
      | 'message_events'
      | 'message_events_unmatched'
    >();
    expectTypeOf<keyof Database['public']['Views']>().toEqualTypeOf<
      // M1-m (R5-64 d): per-pool counts.
      'v_item_exposure' | 'v_item_bank_quant_share' | 'v_pool_item_counts'
    >();
    // M1-c: three INVOKER functions the api calls with the caller's JWT (§3.4, DC-M1-1); M1-o adds the one-call
    // publish source read (R5-65); M1-q the atomic from-template and bank draft writes (R5-71 d, e).
    expectTypeOf<keyof Database['public']['Functions']>().toEqualTypeOf<
      | 'import_item_batch'
      | 'save_test_draft'
      | 'save_item_variants'
      | 'publish_source_v2'
      | 'create_test_from_template'
      | 'save_bank_draft'
      // M2-b: the bulk invite batch and the recruiter's reschedule, both INVOKER (§3.3).
      | 'ingest_invite_batch'
      | 'reschedule_invitation'
    >();
  });

  it('carries the M0b enums, the three D1 enums (migrations 1 and 2) and the two M2-b drive enums', () => {
    expect(Object.keys(Constants.public.Enums).sort()).toEqual(
      [
        'actor_kind',
        'data_residency',
        'drive_mode',
        'drive_status',
        'invitation_status',
        'item_status',
        'membership_status',
        'org_kind',
        'org_role',
        'org_status',
        'section_format',
        'staff_grant_scope',
        'test_version_status',
        'workspace_kind',
      ].sort(),
    );
  });
});
