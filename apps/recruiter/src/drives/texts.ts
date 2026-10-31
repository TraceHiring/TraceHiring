// Plain-words labels for the drive screens (specs/m2-scheduling-invites.md §4, M2-8, M2-14). Fixed text only: nothing
// here is computed from a person's answers, and none of it is a score, band or decision (rules 1 and 2).
import type {
  DriveMode,
  DriveStatus,
  InvitationRow,
  MessageStatus,
  SlotStatus,
} from '@trace/shared/contracts/m2';

export const MODE_LABEL: Readonly<Record<DriveMode, string>> = {
  open_window: 'Open window',
  scheduled: 'Scheduled slots',
};

/** `scheduled` is the published state of a drive (§4: draft, then published, then closed or cancelled). */
export const DRIVE_STATUS_LABEL: Readonly<Record<DriveStatus, string>> = {
  draft: 'Draft',
  scheduled: 'Published',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const SLOT_STATUS_LABEL: Readonly<Record<SlotStatus, string>> = {
  open: 'Open',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export const INVITATION_STATUS_LABEL: Readonly<Record<InvitationRow['status'], string>> = {
  created: 'Created',
  sent: 'Invite sent',
  otp_verified: 'Code verified',
  started: 'Started',
  submitted: 'Submitted',
  expired: 'Expired',
  revoked: 'Revoked',
  blocked_age: 'Blocked (age)',
};

/** The latest message status per purpose (M2-14), in words a recruiter can act on. */
export const DELIVERY_LABEL: Readonly<Record<MessageStatus, string>> = {
  planned: 'Planned',
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  bounced: 'Bounced',
  complained: 'Reported as spam',
  failed: 'Could not be sent',
  cancelled: 'Cancelled',
};

/** The statuses from which a recruiter may still act on an invitation (§4; R4-4 allows a revoke from otp_verified). */
export const CAN_RESEND: readonly InvitationRow['status'][] = ['created', 'sent', 'otp_verified'];
export const CAN_REVOKE: readonly InvitationRow['status'][] = ['created', 'sent', 'otp_verified'];
export const CAN_MOVE: readonly InvitationRow['status'][] = ['created', 'sent'];
