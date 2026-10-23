// Integrity presets, per-signal settings and admin locks (spec m1 §6.6-§6.7, §6.11 rows `GET/PUT …/tests/:testId/
// integrity` and `GET/POST/DELETE …/settings/integrity-locks`; M1-13, M1-14, R3-1, R5-53 c, DB-M1-1, E16, E17).
//
// - The settings live on the draft's pinned ruleset (`ruleset_versions.settings`, preset_key); the database validates
//   them against the catalog, the always-locked settings and the org's admin locks, and derives `signal_settings`
//   (I-M1-6, I-M1-7). The api never writes signal_settings and never touches the band rule table: a setting only
//   switches a signal on or off (rule 3). Nothing here rejects anyone or reads an integrity result (rule 2).
// - A named preset must carry exactly that preset's values (read from the library catalog as trace_api); other values
//   are stored as custom (preset null).
// - A written section with a navigation takes the settings' paste_written (DB-M1-1), so the candidate's paste rule and
//   the band input come from one setting; a section without a navigation takes the default (R5-63 b).
// - A named preset is stored with the catalog version whose values were checked; custom stores none (fix round 1 #9).
// - The view of a draft shows an admin lock's value in place of the stored one (E16: the stored value can be neither
//   saved nor published; A5c review M2); a published version shows its frozen values (E17).
// - Admin locks: admin role only (counts at aal2, ADR-029); DELETE answers 204 with no body (R5-53 c).
import { renderCandidateSummary } from '@trace/shared';
import {
  ALWAYS_LOCKED_SETTINGS,
  INTEGRITY_CATALOG_VERSION,
  IntegrityLockCreateRequest,
  IntegrityLockListResponse,
  IntegrityLockView,
  IntegritySettingsRequest,
  IntegritySettingsView,
  SettingKey,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import {
  findRuleset,
  findTest,
  latestVersion,
  parseRows,
  type RulesetRow,
} from '../tests/authoring.js';
import { PUBLISHERS } from '../tests/draft-routes.js';
import { answer, noContent, parseBody, readJson } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import {
  eq,
  handleOrg,
  orgFail,
  pathId,
  type OrgContext,
  type OrgDeps,
} from '../tests/org-context.js';
import type { ReferenceSource } from '../templates/reference.js';
import { LOCK_COLS, LockRowSchema, applyLocks, loadLocks, type SettingValues } from './locks.js';
import { applySettingsToSections } from './settings-write.js';

export interface IntegritySettingsDeps {
  org: OrgDeps;
  /** The library catalog read as trace_api (preset values), or null when no database path is bound (503). */
  reference(env: Env): ReferenceSource | null;
}

/**
 * How a D1 draft without settings behaves, as catalog values (R3-1: D1's ruleset has all five signals enabled; the D1
 * client blocks and records pastes). The catalog defaults (equal to the Standard preset) with paste_written blocked:
 * every signal is captured and enabled, exactly as D1. Shown as custom (preset null) until settings are saved.
 */
export const D1_EQUIVALENT_VALUES: SettingValues = {
  calibration_warmup: 'on',
  typing_provenance: 'on',
  burst_after_tab: 'on',
  fullscreen_tab_focus: 'warn_first',
  single_screen: 'off',
  camera_face_presence: 'on',
  mic_speech_presence: 'off',
  explain_probe: 'off',
  question_copy: 'on',
  paste_written: 'blocked',
  integrity_review_scope: 'shortlist_only',
  accommodations: 'on',
  id_verification: 'off',
};

const ADMIN = ['admin'] as const;

export const TEST_INTEGRITY_PATH = '/v1/orgs/:orgId/tests/:testId/integrity';
export const INTEGRITY_LOCKS_PATH = '/v1/orgs/:orgId/settings/integrity-locks';
export const INTEGRITY_LOCK_PATH = '/v1/orgs/:orgId/settings/integrity-locks/:settingKey';

const storedValues = (ruleset: RulesetRow | null): SettingValues | null => {
  if (ruleset?.settings === null || ruleset?.settings === undefined) return null;
  const parsed = IntegritySettingsRequest.shape.values.safeParse(ruleset.settings);
  return parsed.success ? parsed.data : orgFail('unavailable');
};

const viewOf = async (ctx: OrgContext, orgId: string, testId: string) => {
  if ((await findTest(ctx.rest, orgId, testId)) === null) return orgFail('not_found');
  const version = (await latestVersion(ctx.rest, orgId, testId)) ?? orgFail('not_found');
  const ruleset = await findRuleset(ctx.rest, orgId, version.ruleset_version_id);
  if (ruleset === null) return orgFail('not_found');
  const locks = await loadLocks(ctx.rest, orgId);
  const stored = storedValues(ruleset);
  const base = stored ?? D1_EQUIVALENT_VALUES;
  // A draft follows the locks (E16); a published or retired version keeps its frozen values (E17).
  const applied =
    version.status === 'draft' ? applyLocks(base, locks) : { values: base, changed: false };
  const locked: Record<string, 'admin' | 'always'> = {};
  for (const l of locks)
    if (!ALWAYS_LOCKED_SETTINGS.includes(l.setting_key)) locked[l.setting_key] = 'admin';
  for (const key of ALWAYS_LOCKED_SETTINGS) locked[key] = 'always';
  return {
    presetKey: stored === null || applied.changed ? null : ruleset.preset_key,
    values: applied.values,
    locked,
    candidateSummary: renderCandidateSummary(applied.values, INTEGRITY_CATALOG_VERSION).lines,
  };
};

const sameValues = (a: SettingValues, b: SettingValues) =>
  (Object.keys(a) as (keyof SettingValues)[]).every((k) => a[k] === b[k]) &&
  Object.keys(a).length === Object.keys(b).length;

export const createIntegritySettingsRoutes = (
  deps: IntegritySettingsDeps,
): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.get(TEST_INTEGRITY_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      return answer(IntegritySettingsView, await viewOf(ctx, orgId, testId));
    }),
  );

  app.put(TEST_INTEGRITY_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, PUBLISHERS);
      const req = parseBody(IntegritySettingsRequest, await readJson(c.req.raw));
      if ((await findTest(ctx.rest, orgId, testId)) === null) return orgFail('not_found');
      const version = (await latestVersion(ctx.rest, orgId, testId)) ?? orgFail('not_found');
      // Settings freeze with the version (Q20); a published test is edited as a new version.
      if (version.status !== 'draft' || version.ruleset_version_id === null) {
        return orgFail('conflict');
      }
      let presetVersion: number | null = null;
      if (req.presetKey !== null) {
        const reference = deps.reference(c.env) ?? orgFail('unavailable');
        const preset = (await reference.settingsCatalog(ctx.caller, orgId)).presets[req.presetKey];
        if (preset === undefined) return orgFail('unavailable');
        // A preset names a set of values; values that differ are custom (preset null), never mislabelled.
        if (!sameValues(preset.values, req.values)) return orgFail('bad_request');
        // Fix round 1 #9: the version whose values were just checked is stored with the key.
        presetVersion = preset.version;
      }
      const updated = await ctx.rest.update(
        'ruleset_versions',
        {
          id: eq(version.ruleset_version_id),
          org_id: eq(orgId),
          published_at: 'is.null',
          select: 'id',
        },
        { preset_key: req.presetKey, preset_version: presetVersion, settings: req.values },
      );
      if (updated.length !== 1) return orgFail('conflict');
      // R5-63 b and DB-M1-1: with settings the draft is package v2, so a section without a navigation takes the
      // default, and every written section takes the paste rule of the settings.
      await applySettingsToSections(ctx, orgId, version.id, req.values.paste_written);
      return answer(IntegritySettingsView, await viewOf(ctx, orgId, testId));
    }),
  );

  app.get(INTEGRITY_LOCKS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, ADMIN);
      const locks = await loadLocks(ctx.rest, orgId);
      return answer(IntegrityLockListResponse, {
        locks: locks.map((l) => ({
          id: l.id,
          settingKey: l.setting_key,
          lockedValue: l.locked_value,
          lockedBy: l.locked_by,
          lockedAt: l.locked_at,
        })),
      });
    }),
  );

  app.post(INTEGRITY_LOCKS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, ADMIN);
      const req = parseBody(IntegrityLockCreateRequest, await readJson(c.req.raw));
      const [row] = parseRows(
        LockRowSchema,
        await ctx.rest.insert(
          'org_integrity_locks',
          { org_id: orgId, setting_key: req.settingKey, locked_value: req.lockedValue },
          { select: LOCK_COLS },
        ),
      );
      if (row === undefined) return orgFail('not_found');
      return answer(
        IntegrityLockView,
        {
          id: row.id,
          settingKey: row.setting_key,
          lockedValue: row.locked_value,
          lockedBy: row.locked_by,
          lockedAt: row.locked_at,
        },
        201,
      );
    }),
  );

  app.delete(INTEGRITY_LOCK_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, ADMIN);
      const key = SettingKey.safeParse(c.req.param('settingKey'));
      if (!key.success) return orgFail('not_found');
      const removed = await ctx.rest.remove('org_integrity_locks', {
        org_id: eq(orgId),
        setting_key: eq(key.data),
        select: 'id',
      });
      return removed.length === 0 ? orgFail('not_found') : noContent();
    }),
  );

  return app;
};
