// Writes shared by every path that gives a draft integrity settings (spec m1 §6.6, R5-34, DB-M1-1; A2b fix round 1
// #4, #5, #9): the Standard preset with the org's admin locks for a locked org, the preset's catalog version next to
// its key (versioning rule: a named preset is stored with the version whose values were checked; custom stores none).
// The default navigation and the written paste rule of a draft with settings (R5-63 b, DB-M1-1) are derived by the
// database in the same write (M1-p, R5-71 b). Nothing here touches a rule's tier, threshold or `validated` flag
// (rule 3) or reads an integrity result (rule 2).
import { PresetKey } from '@trace/shared/contracts/m1';
import { eq, type OrgContext } from '../tests/org-context.js';
import type { ReferenceSource } from '../templates/reference.js';
import { applyLocks, type LockRow, type SettingValues } from './locks.js';

/** Settings as they are stored on a draft's ruleset: preset key and version (both null for custom) and the values. */
export interface SettingsWrite {
  presetKey: PresetKey | null;
  presetVersion: number | null;
  settings: SettingValues;
}

/**
 * A preset's values with the locks applied: the preset (with its catalog version) when no lock moved a value, else
 * custom (R5-34).
 */
export const presetWithLocks = (
  presetKey: PresetKey,
  preset: { version: number; values: SettingValues },
  locks: readonly Pick<LockRow, 'setting_key' | 'locked_value'>[],
): SettingsWrite => {
  const locked = applyLocks(preset.values, locks);
  return locked.changed
    ? { presetKey: null, presetVersion: null, settings: locked.values }
    : { presetKey, presetVersion: preset.version, settings: locked.values };
};

/**
 * R5-34: the Standard preset with the org's locks, for a draft of a locked org that would otherwise have no settings;
 * null when the org has no lock, or when the catalog cannot be read (the database then refuses the draft's publish
 * until settings are saved: fail closed).
 */
export const lockedStandard = async (
  reference: ReferenceSource | null,
  ctx: OrgContext,
  orgId: string,
  locks: readonly Pick<LockRow, 'setting_key' | 'locked_value'>[],
): Promise<SettingsWrite | null> => {
  if (locks.length === 0 || reference === null) return null;
  const catalog = await reference.settingsCatalog(ctx.caller, orgId);
  const standard = catalog.presets[PresetKey.enum.standard];
  return standard === undefined ? null : presetWithLocks(PresetKey.enum.standard, standard, locks);
};

/**
 * Stores the preset's catalog version on a draft ruleset whose settings were written without it (save_test_draft
 * writes preset_version null and the trigger would take the newest version, not the one whose values were checked).
 */
export const pinPresetVersion = async (
  ctx: OrgContext,
  orgId: string,
  rulesetId: string,
  write: Pick<SettingsWrite, 'presetKey' | 'presetVersion'>,
): Promise<void> => {
  if (write.presetKey === null || write.presetVersion === null) return;
  await ctx.rest.update(
    'ruleset_versions',
    {
      id: eq(rulesetId),
      org_id: eq(orgId),
      preset_key: eq(write.presetKey),
      published_at: 'is.null',
      select: 'id',
    },
    { preset_version: write.presetVersion },
  );
};
