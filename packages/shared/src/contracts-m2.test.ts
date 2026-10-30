// M2 contracts (specs/m2-scheduling-invites.md revision 5 §5, §3.2, §6.2, R2-5, R5-9, R5-44; Wave 0b lead). Synthetic data
// only: names, addresses and ciphertexts below are fixtures, never a real person's.
import { describe, expect, it } from 'vitest';
import {
  CreateDriveRequest,
  DriveDetail,
  IngestInviteDbRow,
  InvitationRow,
  InviteBatchRequest,
  InviteBatchResponse,
  InviteRow,
  MESSAGE_STATUSES,
  MessagesQueueMessage,
  RescheduleRequest,
  ROW_REFUSAL_REASONS,
  SlotView,
  SlotsCreateRequest,
} from './contracts-m2.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = String.fromCharCode(64);
const hex = (c: string) => c.repeat(64);

const drive = {
  name: 'Campus drive',
  testId: id(1),
  defaultTestVersionId: id(2),
  mode: 'scheduled',
  opensAt: '2026-11-01T09:00:00+05:30',
  deadlineAt: '2026-11-10T18:00:00+05:30',
  reminderOffsetsMinutes: [1440, 60],
  selfRescheduleAllowed: true,
  labMode: false,
};

describe('CreateDriveRequest (§5, M2-8, M2-13, AT-M2-06)', () => {
  it('accepts a scheduled drive with the default reminders', () => {
    expect(CreateDriveRequest.parse(drive)).toEqual(drive);
  });
  it.each([
    ['five offsets', { ...drive, reminderOffsetsMinutes: [15, 30, 60, 120, 240] }],
    ['an offset under 15 minutes', { ...drive, reminderOffsetsMinutes: [10] }],
    ['an offset over 7 days', { ...drive, reminderOffsetsMinutes: [10081] }],
    ['repeated offsets', { ...drive, reminderOffsetsMinutes: [60, 60] }],
    ['a deadline before the opening', { ...drive, deadlineAt: '2026-10-31T09:00:00+05:30' }],
    ['an unknown key', { ...drive, timezone: 'UTC' }],
    ['an empty name', { ...drive, name: '' }],
    ['over 100,000 expected candidates', { ...drive, expectedCandidates: 100001 }],
  ])('refuses %s', (_name, body) => {
    expect(CreateDriveRequest.safeParse(body).success).toBe(false);
  });
  it('allows no reminders', () => {
    expect(CreateDriveRequest.safeParse({ ...drive, reminderOffsetsMinutes: [] }).success).toBe(
      true,
    );
  });
});

describe('DriveDetail and slots (§5)', () => {
  it('carries the open-window pool warning as a ratio, never a score', () => {
    const detail = {
      ...drive,
      id: id(3),
      status: 'draft',
      expectedCandidates: null,
      minPoolRatio: 9.5,
      createdAt: '2026-10-30T10:00:00Z',
    };
    expect(DriveDetail.parse(detail)).toEqual(detail);
  });
  it('creates slots by list or by generator, never both', () => {
    expect(
      SlotsCreateRequest.safeParse({ slots: [{ startsAt: '2026-11-02T10:00:00Z', capacity: 50 }] })
        .success,
    ).toBe(true);
    expect(
      SlotsCreateRequest.safeParse({
        generator: {
          firstStartsAt: '2026-11-02T10:00:00Z',
          count: 8,
          intervalMinutes: 60,
          capacity: 50,
        },
      }).success,
    ).toBe(true);
    expect(SlotsCreateRequest.safeParse({ slots: [] }).success).toBe(false);
    expect(
      SlotsCreateRequest.safeParse({
        slots: [{ startsAt: '2026-11-02T10:00:00Z', capacity: 20001 }],
      }).success,
    ).toBe(false);
    expect(
      SlotsCreateRequest.safeParse({
        generator: {
          firstStartsAt: '2026-11-02T10:00:00Z',
          count: 501,
          intervalMinutes: 60,
          capacity: 5,
        },
      }).success,
    ).toBe(false);
  });
  it('shows booked against capacity to staff', () => {
    const slot = {
      id: id(4),
      startsAt: '2026-11-02T10:00:00Z',
      capacity: 50,
      booked: 12,
      startWindowMinutes: 15,
      lobbyOpensMinutes: 30,
      status: 'open',
    };
    expect(SlotView.parse(slot)).toEqual(slot);
    expect(SlotView.safeParse({ ...slot, startWindowMinutes: 31 }).success).toBe(false);
  });
});

const row = {
  rowNo: 2,
  fullName: 'Asha Kumari',
  email: `asha${at}example.test`,
  adult18: 'yes',
};

describe('InviteRow and batches (§5, §6.2, R2-5, M2-6)', () => {
  it('accepts a row, with Devanagari and Tamil names (E22)', () => {
    expect(InviteRow.parse(row)).toEqual(row);
    expect(InviteRow.safeParse({ ...row, fullName: 'आशा कुमारी' }).success).toBe(true);
    expect(InviteRow.safeParse({ ...row, fullName: 'ஆஷா' }).success).toBe(true);
    expect(InviteRow.safeParse({ ...row, adult18: null }).success).toBe(true);
  });
  it.each([
    ['a missing email (email is the only channel, R2-5)', { ...row, email: undefined }],
    ['a name with digits', { ...row, fullName: 'Asha 1' }],
    ['a name starting with a formula character', { ...row, fullName: '=cmd' }],
    ['a name over 200 characters', { ...row, fullName: 'a'.repeat(201) }],
    ['an adult value outside yes/no/blank', { ...row, adult18: 'maybe' }],
    ['a date-of-birth field (M2-6)', { ...row, dob: '2000-01-01' }],
    ['a row number of 0', { ...row, rowNo: 0 }],
  ])('refuses %s', (_name, body) => {
    expect(InviteRow.safeParse(body).success).toBe(false);
  });
  it('takes 1 to 200 rows with distinct row numbers', () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ ...row, rowNo: i + 1 }));
    expect(InviteBatchRequest.safeParse({ uploadId: id(5), rows }).success).toBe(true);
    expect(
      InviteBatchRequest.safeParse({ uploadId: id(5), rows: [...rows, { ...row, rowNo: 201 }] })
        .success,
    ).toBe(false);
    expect(InviteBatchRequest.safeParse({ uploadId: id(5), rows: [row, row] }).success).toBe(false);
  });
  it('answers each row with an invitation or a reason, never a cell value (AT-M2-03)', () => {
    const res = {
      results: [
        { rowNo: 2, invitationId: id(6) },
        { rowNo: 3, reason: 'phone_shared', held: true },
        { rowNo: 4, reason: 'minor', held: false },
      ],
    };
    expect(InviteBatchResponse.parse(res)).toEqual(res);
    expect(
      InviteBatchResponse.safeParse({
        results: [{ rowNo: 5, reason: 'invalid_email', held: false, value: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      InviteBatchResponse.safeParse({
        results: [{ rowNo: 5, reason: 'phone_shared', held: false }],
      }).success,
    ).toBe(false);
  });
  it('lists the reasons of §3.2 exactly (no word like reject, I-M2-8)', () => {
    expect([...ROW_REFUSAL_REASONS].sort()).toEqual(
      [
        'missing_name',
        'missing_contact',
        'invalid_email',
        'invalid_phone',
        'duplicate_email_in_file',
        'duplicate_phone_in_file',
        'already_invited',
        'phone_shared',
        'minor',
        'bad_adult_value',
        'bad_slot',
        'slot_full',
        'name_too_long',
        'row_limit',
        'unknown_column',
        'missing_email',
      ].sort(),
    );
    expect(ROW_REFUSAL_REASONS.some((r) => /reject/.test(r))).toBe(false);
  });
});

const ct = (s: string) => `v1.1.${Buffer.from(s).toString('base64url')}`;
const dbRow = {
  rowNo: 2,
  fullNameCt: ct('n'),
  fingerprint: hex('a'),
  keyVersion: 1,
  emailCt: ct('e'),
  emailBidx: hex('b'),
  emailHint: `a•••${at}example.test`,
  adult: true,
  slotStartsAt: null,
  language: 'en',
  linkTokenHash: hex('c'),
  confirmPhoneDuplicate: false,
};

describe('IngestInviteDbRow (the ingest_invite_batch row contract, M2-b header)', () => {
  it('carries ciphertext, blind indexes and hints only', () => {
    expect(IngestInviteDbRow.parse(dbRow)).toEqual(dbRow);
    expect(IngestInviteDbRow.parse({ rowNo: 3, reason: 'minor' })).toEqual({
      rowNo: 3,
      reason: 'minor',
    });
  });
  it.each([
    ['a plaintext name', { ...dbRow, fullName: 'Asha' }],
    ['a plaintext email in the ciphertext field', { ...dbRow, emailCt: `asha${at}example.test` }],
    ['a phone without its blind index and hint', { ...dbRow, phoneCt: ct('p') }],
    ['adult false (minors are never sent, rule 9)', { ...dbRow, adult: false }],
    ['a reason the database decides', { rowNo: 3, reason: 'already_invited' }],
    ['a hint that shows the address', { ...dbRow, emailHint: `asha${at}example.test` }],
  ])('refuses %s', (_name, body) => {
    expect(IngestInviteDbRow.safeParse(body).success).toBe(false);
  });
});

describe('InvitationRow, reschedule and messages (§5, M2-14, R5-9)', () => {
  it('shows delivery status per purpose', () => {
    const inv = {
      invitationId: id(7),
      label: 'Candidate 12',
      nameDisplay: 'Asha Kumari',
      emailHint: `a•••${at}example.test`,
      slotStartsAt: '2026-11-02T10:00:00Z',
      status: 'sent',
      delivery: { invite: 'delivered', reminder: null, reschedule: null },
    };
    expect(InvitationRow.parse(inv)).toEqual(inv);
    expect(InvitationRow.safeParse({ ...inv, status: 'rejected' }).success).toBe(false);
  });
  it('has the message statuses of §4 in rank order', () => {
    expect(MESSAGE_STATUSES).toEqual([
      'planned',
      'queued',
      'sent',
      'delivered',
      'bounced',
      'complained',
      'failed',
      'cancelled',
    ]);
  });
  it('moves to a slot by id only', () => {
    expect(RescheduleRequest.parse({ toSlotId: id(8) })).toEqual({ toSlotId: id(8) });
    expect(RescheduleRequest.safeParse({ toSlotId: id(8), reason: 'x' }).success).toBe(false);
  });
  it('queues ids only (R5-9)', () => {
    const m = { orgId: id(2), id: id(9), claimId: id(10) };
    expect(MessagesQueueMessage.parse(m)).toEqual(m);
    expect(MessagesQueueMessage.safeParse({ ...m, to: `a${at}example.test` }).success).toBe(false);
    expect(MessagesQueueMessage.safeParse({ ...m, token: 'x' }).success).toBe(false);
  });
});
