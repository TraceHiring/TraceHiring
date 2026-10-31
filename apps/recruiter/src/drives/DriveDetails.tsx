// The details and the drive-level actions of `/drives/:driveId` (specs/m2-scheduling-invites.md §4, §6.1, M2-17, R5-13,
// R5-59, R5-64 f). Publish, Close and Cancel by status; Close, Cancel and the one revoke on a cancelled drive ask again
// before they send. There is no row selection and no other bulk control: the revoke is one explicit, audited action.
import type { DriveDetail } from '@trace/shared/contracts/m2';
import { Link } from 'react-router';
import ui from '../common/Ui.module.css';
import { DRIVE_STATUS_LABEL, MODE_LABEL } from './texts';
import { formatIst, offsetsSentence } from './time';

export function DriveDetailsPanel({ drive }: { drive: DriveDetail }) {
  const anchor = drive.mode === 'open_window' ? 'deadline' : 'start';
  return (
    <div className={ui.panel}>
      <div className={ui.stack}>
        <p>{`Status: ${DRIVE_STATUS_LABEL[drive.status]}`}</p>
        <p>{`Mode: ${MODE_LABEL[drive.mode]}`}</p>
        <p>{`Opens: ${formatIst(drive.opensAt)}`}</p>
        <p>{`Deadline: ${formatIst(drive.deadlineAt)}`}</p>
        <p>{`Reminders: ${offsetsSentence(drive.reminderOffsetsMinutes, anchor)}`}</p>
        <p>{`Candidates may reschedule once: ${drive.selfRescheduleAllowed ? 'Yes' : 'No'}`}</p>
        <p>{`Lab mode: ${drive.labMode ? 'On' : 'Off'}`}</p>
        {drive.expectedCandidates !== null && (
          <p>{`Expected candidates: ${drive.expectedCandidates.toLocaleString('en-IN')}`}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The open-window warning (M2-17): shown when the smallest pool is under 10 times the draw. A ratio, never a score. A
 * scheduled drive does not show it, because publishing one with a smaller pool is refused.
 */
export function PoolWarning({ drive }: { drive: DriveDetail }) {
  if (drive.mode !== 'open_window' || drive.minPoolRatio === null || drive.minPoolRatio >= 10) {
    return null;
  }
  return (
    <p className={ui.banner} role="status">
      {`Warning: the pool is smaller than 10 times the draw. The smallest question pool in this test holds ${drive.minPoolRatio.toFixed(1)} times as many questions as the test draws, so candidates may see many of the same questions.`}
    </p>
  );
}

export type DriveAsk = 'close' | 'cancel' | 'revoke_all';

export interface DriveActionsProps {
  drive: DriveDetail;
  pending: DriveAsk | null;
  busy: boolean;
  /** "N revoked, M skipped (a test may still start)" after the drive-level revoke. */
  revokeResult: string | null;
  onPublish(): void;
  onAsk(ask: DriveAsk): void;
  onKeep(): void;
  onYes(): void;
}

const PANEL: Readonly<Record<DriveAsk, { lines: readonly string[]; yes: string; keep: string }>> = {
  close: {
    lines: ['Candidates can no longer start once the drive is closed. This cannot be undone.'],
    yes: 'Yes, close the drive',
    keep: 'Keep the drive open',
  },
  cancel: {
    lines: [
      'Planned messages are cancelled.',
      'Invitations stay as they are until you revoke them.',
      'This cannot be undone.',
    ],
    yes: 'Yes, cancel the drive',
    keep: 'Keep the drive',
  },
  revoke_all: {
    lines: [
      'This revokes every invitation whose test has not started. It is recorded under your name.',
      'An invitation that may still start is skipped and counted.',
    ],
    yes: 'Yes, revoke them',
    keep: 'Keep the invitations',
  },
};

export function DriveActions(props: DriveActionsProps) {
  const { drive, pending, busy } = props;
  const canInvite = drive.status === 'draft' || drive.status === 'scheduled';
  return (
    <div className={ui.stack}>
      <div className={ui.row}>
        {drive.status === 'draft' && (
          <button
            type="button"
            className={`${ui.button} ${ui.primary}`}
            disabled={busy}
            onClick={props.onPublish}
          >
            Publish drive
          </button>
        )}
        {drive.status === 'scheduled' && (
          <button
            type="button"
            className={ui.button}
            disabled={busy}
            onClick={() => {
              props.onAsk('close');
            }}
          >
            Close drive
          </button>
        )}
        {(drive.status === 'draft' || drive.status === 'scheduled') && (
          <button
            type="button"
            className={ui.button}
            disabled={busy}
            onClick={() => {
              props.onAsk('cancel');
            }}
          >
            Cancel drive
          </button>
        )}
        {drive.status === 'cancelled' && (
          <button
            type="button"
            className={ui.button}
            disabled={busy}
            onClick={() => {
              props.onAsk('revoke_all');
            }}
          >
            Revoke all invitations not yet started
          </button>
        )}
        {canInvite && (
          <Link className={ui.button} to={`/drives/${drive.id}/upload`}>
            Invite candidates
          </Link>
        )}
      </div>
      {pending !== null && (
        <div className={ui.dialog} role="group" aria-label="Are you sure?">
          <div className={ui.stack}>
            {PANEL[pending].lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <div className={ui.row}>
              <button type="button" className={ui.button} disabled={busy} onClick={props.onYes}>
                {PANEL[pending].yes}
              </button>
              <button type="button" className={ui.button} disabled={busy} onClick={props.onKeep}>
                {PANEL[pending].keep}
              </button>
            </div>
          </div>
        </div>
      )}
      {props.revokeResult !== null && <p role="status">{props.revokeResult}</p>}
    </div>
  );
}
