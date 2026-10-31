// M2 scheduling and invite contracts (specs/m2-scheduling-invites.md revision 5 §5; value lists from §3.2, §4 and
// migrations M2-a, M2-b, M2-c). Every object schema is strict: an unknown key fails. Recruiter- and worker-side only;
// the candidate shapes (schedule phase, portal) live in contracts-candidate.ts (R5-23). Nothing here carries a score,
// band or outcome (rule 1), and no message body, recipient, OTP or link token (M2-14).
import { z } from 'zod';

const uuid = () => z.uuid();
const time = () => z.iso.datetime({ offset: true });
const sha256 = () => z.string().regex(/^[0-9a-f]{64}$/);

/** Text Postgres can store: no U+0000 and no lone UTF-16 surrogate. */
const storable = (s: string) =>
  !s.includes('\u0000') &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
const text = (min: number, max: number) =>
  z.string().min(min).max(max).refine(storable, { message: 'unstorable_text' });

export const DRIVE_MODES = ['open_window', 'scheduled'] as const;
export const DriveMode = z.enum(DRIVE_MODES);
export type DriveMode = z.infer<typeof DriveMode>;
export const DRIVE_STATUSES = ['draft', 'scheduled', 'closed', 'cancelled'] as const;
export const DriveStatus = z.enum(DRIVE_STATUSES);
export type DriveStatus = z.infer<typeof DriveStatus>;
export const SlotStatus = z.enum(['open', 'closed', 'cancelled']);
export type SlotStatus = z.infer<typeof SlotStatus>;

/** §4 Outbound message, in rank order (R2-15); `cancelled` is reached from `planned` only. */
export const MESSAGE_STATUSES = [
  'planned',
  'queued',
  'sent',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'cancelled',
] as const;
export const MessageStatus = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof MessageStatus>;
export const MessagePurpose = z.enum(['invite', 'reminder', 'reschedule']);
export type MessagePurpose = z.infer<typeof MessagePurpose>;

/** D1's invitation states, unchanged by M2 (no rejected state, rule 2). */
export const InvitationStatus = z.enum([
  'created',
  'sent',
  'otp_verified',
  'started',
  'submitted',
  'expired',
  'revoked',
  'blocked_age',
]);

// ---- Drives and slots (§5, §6.1; M2-8, M2-13, M2-17, M2-21) ------------------------------------------------------

/** 0-4 distinct reminder offsets, each 15 minutes to 7 days (drives.reminder_offsets, AT-M2-06). */
const reminderOffsets = () =>
  z
    .array(z.int().min(15).max(10080))
    .max(4)
    .refine((v) => new Set(v).size === v.length, { message: 'duplicate_offset' });

const driveFields = {
  name: text(1, 200),
  testId: uuid(),
  defaultTestVersionId: uuid(),
  mode: DriveMode,
  opensAt: time(),
  deadlineAt: time(),
  reminderOffsetsMinutes: reminderOffsets(),
  selfRescheduleAllowed: z.boolean(),
  labMode: z.boolean(),
};
const opensBeforeDeadline = (d: { opensAt: string; deadlineAt: string }) =>
  Date.parse(d.deadlineAt) > Date.parse(d.opensAt);

export const CreateDriveRequest = z
  .strictObject({ ...driveFields, expectedCandidates: z.int().min(1).max(100000).optional() })
  .refine(opensBeforeDeadline, { message: 'deadline_before_opening' });
export type CreateDriveRequest = z.infer<typeof CreateDriveRequest>;

/** A drive as staff see it. `minPoolRatio` is the open-window warning (M2-17), a draw ratio, never a score. */
export const DriveDetail = z
  .strictObject({
    ...driveFields,
    id: uuid(),
    status: DriveStatus,
    expectedCandidates: z.int().min(1).max(100000).nullable(),
    minPoolRatio: z.number().min(0).nullable(),
    createdAt: time(),
  })
  .refine(opensBeforeDeadline, { message: 'deadline_before_opening' });
export type DriveDetail = z.infer<typeof DriveDetail>;

const capacity = () => z.int().min(1).max(20000);
export const SlotsCreateRequest = z.union([
  z.strictObject({
    slots: z
      .array(z.strictObject({ startsAt: time(), capacity: capacity() }))
      .min(1)
      .max(500),
  }),
  z.strictObject({
    generator: z.strictObject({
      firstStartsAt: time(),
      count: z.int().min(1).max(500),
      intervalMinutes: z.int().min(15).max(1440),
      capacity: capacity(),
    }),
  }),
]);
export type SlotsCreateRequest = z.infer<typeof SlotsCreateRequest>;

/** A slot as staff see it (candidates see availability booleans only, E25, rule 5). */
export const SlotView = z.strictObject({
  id: uuid(),
  startsAt: time(),
  capacity: capacity(),
  booked: z.int().min(0).max(20000),
  startWindowMinutes: z.int().min(5).max(30),
  lobbyOpensMinutes: z.int().min(15).max(60),
  status: SlotStatus,
});
export type SlotView = z.infer<typeof SlotView>;

// ---- Bulk invite (§6.2; M2-4, M2-5, M2-6, R2-5, R2-12) -----------------------------------------------------------

/** invite_upload_errors.reason (§3.2): a refused file row, never a rejected candidate (I-M2-8, rule 2). */
export const ROW_REFUSAL_REASONS = [
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
] as const;
export const RowRefusalReason = z.enum(ROW_REFUSAL_REASONS);
export type RowRefusalReason = z.infer<typeof RowRefusalReason>;
/** The reasons the database decides (unique index, phone rule, booking); the api never sends them itself. */
const DB_REASONS: readonly RowRefusalReason[] = [
  'already_invited',
  'phone_shared',
  'slot_full',
  'bad_slot',
];

/** Unicode letters and marks, spaces and . ' - (§5); a leading letter, so no formula character (E23). */
const FULL_NAME = /^\p{L}[\p{L}\p{M} .'-]*$/u;

/** One parsed file row as the browser sends it; the api re-validates and normalises everything (M2-7). */
export const InviteRow = z.strictObject({
  rowNo: z.int().min(1).max(5000),
  fullName: text(1, 200).regex(FULL_NAME),
  email: z.string().min(3).max(254),
  phone: z.string().min(1).max(32).optional(),
  adult18: z.enum(['yes', 'no']).nullable(),
  slotStartsAt: time().optional(),
  language: z.enum(['en', 'hi']).optional(),
});
export type InviteRow = z.infer<typeof InviteRow>;

export const InviteBatchRequest = z.strictObject({
  uploadId: uuid(),
  rows: z
    .array(InviteRow)
    .min(1)
    .max(200)
    .refine((rows) => new Set(rows.map((r) => r.rowNo)).size === rows.length, {
      message: 'duplicate_row',
    }),
  confirmPhoneDuplicate: z.boolean().optional(),
});
export type InviteBatchRequest = z.infer<typeof InviteBatchRequest>;

/** Each row's outcome: an invitation, or a reason (held only for phone_shared). Never the cell value (Q30). */
export const InviteRowResult = z.union([
  z.strictObject({ rowNo: z.int().min(1).max(5000), invitationId: uuid() }),
  z
    .strictObject({ rowNo: z.int().min(1).max(5000), reason: RowRefusalReason, held: z.boolean() })
    .refine((r) => r.held === (r.reason === 'phone_shared'), { message: 'held_mismatch' }),
]);
export const InviteBatchResponse = z.strictObject({ results: z.array(InviteRowResult).max(200) });
export type InviteBatchResponse = z.infer<typeof InviteBatchResponse>;

const ciphertext = () =>
  z
    .string()
    .max(2048)
    .regex(/^v1\.[0-9]+\.[A-Za-z0-9_-]+$/);
const EMAIL_HINT = /^[a-z0-9]•••@[a-z0-9.-]+$/;
const PHONE_HINT = /^••••[0-9]{4}$/;

/**
 * One row of public.ingest_invite_batch (the M2-b header's row contract): either an api-decided refusal, or the
 * encrypted row. Plaintext never reaches Postgres (M2-3); a minor is refused by the api and never sent (rule 9).
 */
export const IngestInviteDbRow = z.union([
  z.strictObject({
    rowNo: z.int().min(1).max(5000),
    reason: RowRefusalReason.refine((r) => !DB_REASONS.includes(r), { message: 'db_reason' }),
  }),
  z
    .strictObject({
      rowNo: z.int().min(1).max(5000),
      fullNameCt: ciphertext(),
      fingerprint: sha256(),
      keyVersion: z.int().min(1),
      emailCt: ciphertext(),
      emailBidx: sha256(),
      emailHint: z.string().max(80).regex(EMAIL_HINT),
      phoneCt: ciphertext().optional(),
      phoneBidx: sha256().optional(),
      phoneHint: z.string().regex(PHONE_HINT).optional(),
      adult: z.literal(true).nullable(),
      slotStartsAt: time().nullable(),
      language: z.enum(['en', 'hi']),
      linkTokenHash: sha256(),
      confirmPhoneDuplicate: z.boolean(),
    })
    .refine(
      (r) =>
        (r.phoneCt === undefined) === (r.phoneBidx === undefined) &&
        (r.phoneCt === undefined) === (r.phoneHint === undefined),
      { message: 'phone_parts' },
    ),
]);
export type IngestInviteDbRow = z.infer<typeof IngestInviteDbRow>;

// ---- Invitation list and reschedule (§5, R4-5, M2-14) ------------------------------------------------------------

/** One invitation on the drive page. Names are decrypted by the api for owner, admin and recruiter only (R2-11). */
export const InvitationRow = z.strictObject({
  invitationId: uuid(),
  label: z.string().min(1).max(40),
  nameDisplay: text(1, 200).optional(),
  emailHint: z.string().max(80).regex(EMAIL_HINT).optional(),
  phoneHint: z.string().regex(PHONE_HINT).optional(),
  slotStartsAt: time().optional(),
  status: InvitationStatus,
  delivery: z.strictObject({
    invite: MessageStatus.nullable(),
    reminder: MessageStatus.nullable(),
    reschedule: MessageStatus.nullable(),
  }),
});
export type InvitationRow = z.infer<typeof InvitationRow>;

export const RescheduleRequest = z.strictObject({ toSlotId: uuid() });
export type RescheduleRequest = z.infer<typeof RescheduleRequest>;

// ---- Recruiter drive API surface (Wave 1 lead part, build-notes 2026-10-31; routes by B2, screens by B5) ---------
// Every route sits under /v1/orgs/:orgId (R5-37) and is staff-only (owner, admin, recruiter; §2):
//   GET  /drives                                   PageQuery            → DriveListResponse
//   POST /drives                                   CreateDriveRequest   → DriveDetail
//   GET  /drives/:driveId                                               → DriveDetail
//   POST /drives/:driveId/{publish,close,cancel}                        → DriveDetail   (§4 drive transitions)
//   GET  /drives/:driveId/slots                    PageQuery            → SlotListResponse
//   POST /drives/:driveId/slots                    SlotsCreateRequest   → SlotsCreateResponse
//   POST /drives/:driveId/uploads                  InviteUploadCreateRequest → InviteUploadView
//   POST /drives/:driveId/uploads/:uploadId/rows   InviteBatchRequest   → InviteBatchResponse (path id = body uploadId)
//   POST /drives/:driveId/uploads/:uploadId/{complete,cancel}           → InviteUploadView
//   GET  /drives/:driveId/invitations              PageQuery            → DriveInvitationPage
//   POST /drives/:driveId/invitations/:invitationId/move   RescheduleRequest → InvitationRow ("Move to slot", M2-11)
//   POST /drives/:driveId/invitations/:invitationId/resend                   → InvitationRow ("Resend invite", R2-4)
//   POST /drives/:driveId/invitations/:invitationId/revoke                   → InvitationRow (explicit, audited, R5-13)
//   POST /drives/:driveId/revoke-not-started                                 → RevokeNotStartedResponse (R5-59, R5-64 f)
// The phone-shared confirmation is the body flag `confirmPhoneDuplicate` on …/rows, never a route (R2-12, R5-37).

/** An opaque keyset cursor (R5-31, R5-44): url-safe text, at most 256 characters. Pages hold at most 200 rows. */
const cursor = () =>
  z
    .string()
    .min(1)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/);
const PAGE = 200;

/** The query of every paged list: an optional cursor from the previous page's `nextCursor`. */
export const PageQuery = z.strictObject({ cursor: cursor().optional() });
export type PageQuery = z.infer<typeof PageQuery>;

/** One drive in the drive list. */
export const DriveSummary = z.strictObject({
  id: uuid(),
  name: text(1, 200),
  testId: uuid(),
  mode: DriveMode,
  status: DriveStatus,
  opensAt: time(),
  deadlineAt: time(),
  createdAt: time(),
});
export type DriveSummary = z.infer<typeof DriveSummary>;
export const DriveListResponse = z.strictObject({
  drives: z.array(DriveSummary).max(PAGE),
  nextCursor: cursor().nullable(),
});
export type DriveListResponse = z.infer<typeof DriveListResponse>;

export const SlotListResponse = z.strictObject({
  slots: z.array(SlotView).max(PAGE),
  nextCursor: cursor().nullable(),
});
export type SlotListResponse = z.infer<typeof SlotListResponse>;
/** The slots one SlotsCreateRequest made (1–500, in start order). */
export const SlotsCreateResponse = z.strictObject({ slots: z.array(SlotView).max(500) });
export type SlotsCreateResponse = z.infer<typeof SlotsCreateResponse>;

export const InviteUploadStatus = z.enum(['open', 'completed', 'cancelled']);
export type InviteUploadStatus = z.infer<typeof InviteUploadStatus>;
/** Opens an upload: the file's SHA-256 (computed in the browser; only to warn about a re-upload) and its rows. */
export const InviteUploadCreateRequest = z.strictObject({
  fileSha256: sha256(),
  rowsInFile: z.int().min(1).max(5000),
});
export type InviteUploadCreateRequest = z.infer<typeof InviteUploadCreateRequest>;
const rowCount = () => z.int().min(0).max(5000);
/** An upload's counts (invite_uploads). No file, file name or cell value is ever stored or returned (Q30). */
export const InviteUploadView = z.strictObject({
  uploadId: uuid(),
  driveId: uuid(),
  status: InviteUploadStatus,
  rowsInFile: rowCount(),
  rowsInvited: rowCount(),
  rowsRefused: rowCount(),
  rowsHeld: rowCount(),
  /** True when an earlier upload of this drive had the same file hash. */
  reuploadWarning: z.boolean(),
  createdAt: time(),
  completedAt: time().nullable(),
});
export type InviteUploadView = z.infer<typeof InviteUploadView>;

export const DriveInvitationPage = z.strictObject({
  invitations: z.array(InvitationRow).max(PAGE),
  nextCursor: cursor().nullable(),
});
export type DriveInvitationPage = z.infer<typeof DriveInvitationPage>;

/** "Revoke all invitations not yet started" on a cancelled drive: rows the guard refuses are skipped and counted. */
export const RevokeNotStartedResponse = z.strictObject({
  revoked: z.int().min(0),
  skipped: z.int().min(0),
});
export type RevokeNotStartedResponse = z.infer<typeof RevokeNotStartedResponse>;

// ---- Queue (R5-9) -------------------------------------------------------------------------------------------------

/**
 * The trace-messages queue message: ids only. The claim stage (`private.claim_due_messages`) produces it and the
 * consumer reads everything else under the claim through `private.message_send_context` (M2-c lead decision a).
 */
export const MessagesQueueMessage = z.strictObject({ orgId: uuid(), id: uuid(), claimId: uuid() });
export type MessagesQueueMessage = z.infer<typeof MessagesQueueMessage>;
