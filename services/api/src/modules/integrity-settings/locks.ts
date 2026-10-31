// Admin locks as the settings paths apply them (spec m1 §6.6, M1-13, M1-14, E16, R5-34). A lock is an org-level
// `org_integrity_locks` row: the database refuses to store a locked setting with another value (ruleset guard, at save
// and at publish), so every api path that writes settings writes the locked value. Applying a lock only replaces the
// value of the locked key with the admin's value; it never touches a rule's tier, threshold or `validated` flag (rule 3)
// and nothing here can reject anyone (rule 2).
import {
  ALWAYS_LOCKED_SETTINGS,
  INTEGRITY_SETTING_VALUES,
  SettingKey,
  type IntegritySettingsRequest,
} from '@trace/shared/contracts/m1';
import { z } from 'zod';
import { parseRows } from '../tests/authoring.js';
import { eq, type Rest } from '../tests/org-context.js';

export type SettingValues = IntegritySettingsRequest['values'];

export const LockRowSchema = z.object({
  id: z.uuid(),
  setting_key: SettingKey,
  locked_value: z.string().min(1).max(40),
  locked_by: z.uuid().nullable(),
  locked_at: z.string().min(1),
});
export type LockRow = z.infer<typeof LockRowSchema>;

export const LOCK_COLS = 'id,setting_key,locked_value,locked_by,locked_at';

/** The org's admin locks the caller can read (every member reads them, §3.5). */
export const loadLocks = async (rest: Rest, orgId: string): Promise<LockRow[]> =>
  parseRows(
    LockRowSchema,
    await rest.select('org_integrity_locks', {
      select: LOCK_COLS,
      org_id: eq(orgId),
      order: 'setting_key.asc',
    }),
  );

/**
 * The values with every admin-locked setting set to its locked value; `changed` is true when a value moved (a preset
 * then no longer describes the values, so the caller stores it as custom, preset null). A lock whose value is not one
 * of its setting's values is ignored (the database refuses such a lock row).
 */
export const applyLocks = (
  values: SettingValues,
  locks: readonly Pick<LockRow, 'setting_key' | 'locked_value'>[],
): { values: SettingValues; changed: boolean } => {
  const out: Record<string, string> = { ...values };
  let changed = false;
  for (const lock of locks) {
    if (ALWAYS_LOCKED_SETTINGS.includes(lock.setting_key)) continue;
    const allowed = INTEGRITY_SETTING_VALUES[lock.setting_key] as readonly string[];
    if (!allowed.includes(lock.locked_value)) continue;
    if (out[lock.setting_key] !== lock.locked_value) {
      out[lock.setting_key] = lock.locked_value;
      changed = true;
    }
  }
  return { values: out as SettingValues, changed };
};
