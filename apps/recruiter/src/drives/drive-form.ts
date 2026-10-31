// The new-drive form as data (specs/m2-scheduling-invites.md §5 CreateDriveRequest, M2-8, M2-13, M2-21). Everything is
// checked here first, with a plain sentence per problem, and the request is parsed with the shared contract before
// anything is sent; the api checks it all again.
import { CreateDriveRequest, type DriveMode } from '@trace/shared/contracts/m2';
import { driveErrorText } from './messages';
import { istInputToIso } from './time';

export type ReminderUnit = 'minutes' | 'hours' | 'days';
export interface ReminderField {
  value: string;
  unit: ReminderUnit;
}

export interface DriveForm {
  name: string;
  testId: string;
  /** The published version id typed by hand, for a test whose latest version is not published. */
  versionId: string;
  mode: DriveMode;
  /** datetime-local values, read as IST. */
  opens: string;
  deadline: string;
  reminders: ReminderField[];
  reschedule: 'yes' | 'no';
  lab: 'off' | 'on';
  expected: string;
}

/** The default reminders: 24 hours and 1 hour before (M2-13). */
export const DEFAULT_REMINDERS: readonly ReminderField[] = [
  { value: '24', unit: 'hours' },
  { value: '1', unit: 'hours' },
];
export const MAX_REMINDERS = 4;
export const EMPTY_FORM: DriveForm = {
  name: '',
  testId: '',
  versionId: '',
  mode: 'scheduled',
  opens: '',
  deadline: '',
  reminders: DEFAULT_REMINDERS.map((r) => ({ ...r })),
  reschedule: 'yes',
  lab: 'off',
  expected: '',
};

export const UNIT_MINUTES: Readonly<Record<ReminderUnit, number>> = {
  minutes: 1,
  hours: 60,
  days: 1440,
};
export const UNIT_LABEL: Readonly<Record<ReminderUnit, string>> = {
  minutes: 'minutes',
  hours: 'hours',
  days: 'days',
};

/** How the published version of the chosen test is known. */
export type VersionLookup =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'published'; versionId: string; versionNo: number }
  /** The latest version is not published, or could not be read: the id is typed by hand. */
  | { kind: 'manual' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHOLE = /^\d{1,9}$/;

export type FormResult =
  { ok: true; request: CreateDriveRequest } | { ok: false; problems: string[] };

/** The minutes of one reminder, or null when it is not a whole number of at least 1. */
function minutesOf(field: ReminderField): number | null {
  const value = field.value.trim();
  return WHOLE.test(value) && Number(value) >= 1 ? Number(value) * UNIT_MINUTES[field.unit] : null;
}

export function buildDriveRequest(form: DriveForm, lookup: VersionLookup): FormResult {
  const problems: string[] = [];
  const name = form.name.trim();
  if (name === '') problems.push('Enter a name for the drive.');
  else if (name.length > 200) problems.push('The name can be at most 200 characters.');

  let versionId = '';
  if (form.testId === '') problems.push('Choose a test.');
  else if (lookup.kind === 'published') versionId = lookup.versionId;
  else if (lookup.kind === 'loading') problems.push('Wait while the test’s version loads.');
  else {
    versionId = form.versionId.trim().toLowerCase();
    if (versionId === '') problems.push('Enter the published version id.');
    else if (!UUID.test(versionId)) problems.push('The published version id is not valid.');
  }

  const opensAt = form.opens === '' ? null : istInputToIso(form.opens);
  const deadlineAt = form.deadline === '' ? null : istInputToIso(form.deadline);
  if (form.opens === '') problems.push('Enter the opening time.');
  else if (opensAt === null) problems.push('The opening time is not a valid time.');
  if (form.deadline === '') problems.push('Enter the deadline.');
  else if (deadlineAt === null) problems.push('The deadline is not a valid time.');
  if (opensAt !== null && deadlineAt !== null && Date.parse(deadlineAt) <= Date.parse(opensAt)) {
    problems.push('The deadline must be after the opening time.');
  }

  const minutes = form.reminders.map(minutesOf);
  if (minutes.some((m) => m === null)) {
    problems.push('Each reminder needs a whole number of minutes, hours or days.');
  } else {
    const known = minutes as number[];
    if (known.some((m) => m < 15 || m > 10080)) {
      problems.push('Each reminder must be between 15 minutes and 7 days before the start.');
    }
    if (new Set(known).size !== known.length) problems.push('Each reminder must be different.');
  }

  const expectedText = form.expected.trim();
  let expected: number | undefined;
  if (expectedText !== '') {
    if (WHOLE.test(expectedText) && Number(expectedText) >= 1 && Number(expectedText) <= 100000) {
      expected = Number(expectedText);
    } else {
      problems.push('Expected candidates must be a whole number from 1 to 100,000.');
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const candidate = {
    name,
    testId: form.testId,
    defaultTestVersionId: versionId,
    mode: form.mode,
    opensAt,
    deadlineAt,
    reminderOffsetsMinutes: [...(minutes as number[])].sort((a, b) => b - a),
    selfRescheduleAllowed: form.reschedule === 'yes',
    labMode: form.lab === 'on',
    ...(expected === undefined ? {} : { expectedCandidates: expected }),
  };
  const parsed = CreateDriveRequest.safeParse(candidate);
  return parsed.success
    ? { ok: true, request: parsed.data }
    : { ok: false, problems: [driveErrorText('bad_request')] };
}
