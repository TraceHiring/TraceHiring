// The invitations of a drive (specs/m2-scheduling-invites.md §3.2, §4, M2-11, M2-14, R2-4, R5-13, R5-52 d, R5-59):
// label, name and contact hints (staff only), slot in IST, status and the latest message status per purpose in plain
// words, in cursor pages. Each row has its own Move to slot, Resend invite and Revoke; Revoke asks again; nothing acts
// on several rows at once, and there is no row selection.
import type { DriveDetail, InvitationRow, SlotView } from '@trace/shared/contracts/m2';
import { Fragment } from 'react';
import ui from '../common/Ui.module.css';
import { driveErrorText } from './messages';
import { PagerControls } from './PagerControls';
import { CAN_MOVE, CAN_RESEND, CAN_REVOKE, DELIVERY_LABEL, INVITATION_STATUS_LABEL } from './texts';
import { formatIst } from './time';
import type { PagerState } from './use-pager';

export type RowAsk = { kind: 'revoke' | 'move'; invitationId: string };

export interface InvitationsPanelProps {
  drive: DriveDetail;
  state: PagerState<InvitationRow>;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious(): void;
  onNext(): void;
  ask: RowAsk | null;
  /** The slots a move may target, once loaded; null while loading. */
  targets: readonly SlotView[] | null;
  choice: string;
  busy: boolean;
  /** An api failure code, shown as fixed text. */
  error: string | null;
  notice: string | null;
  onAsk(kind: RowAsk['kind'], row: InvitationRow): void;
  onKeep(): void;
  onChoice(slotId: string): void;
  onMove(): void;
  onResend(row: InvitationRow): void;
  onRevoke(): void;
}

const MESSAGE_PARTS = [
  ['Invite', 'invite'],
  ['Reminder', 'reminder'],
  ['Reschedule', 'reschedule'],
] as const;

function Delivery({ row }: { row: InvitationRow }) {
  const parts = MESSAGE_PARTS.flatMap(([title, key]) => {
    const status = row.delivery[key];
    return status === null ? [] : [{ title, text: DELIVERY_LABEL[status] }];
  });
  if (parts.length === 0) return <span>No messages yet</span>;
  return (
    <>
      {parts.map((part) => (
        <div key={part.title}>{`${part.title}: ${part.text}`}</div>
      ))}
    </>
  );
}

/** Which of the three row actions a row offers, by the drive's state and the invitation's status. */
export function rowActions(
  drive: DriveDetail,
  row: InvitationRow,
): { move: boolean; resend: boolean; revoke: boolean } {
  const live = drive.status === 'draft' || drive.status === 'scheduled';
  return {
    move: live && drive.mode === 'scheduled' && CAN_MOVE.includes(row.status),
    resend: live && CAN_RESEND.includes(row.status),
    revoke: CAN_REVOKE.includes(row.status),
  };
}

const dash = '—';

export function InvitationsPanel(props: InvitationsPanelProps) {
  const { drive, state, ask } = props;
  return (
    <section className={ui.stack} aria-label="Invitations">
      <h3 className={ui.subtitle}>Invitations</h3>
      {props.notice !== null && <p role="status">{props.notice}</p>}
      {props.error !== null && (
        <p role="alert" className={ui.alert}>
          {driveErrorText(props.error)}
        </p>
      )}
      {state.kind === 'loading' && <p role="status">Loading invitations...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {driveErrorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' &&
        (state.rows.length === 0 ? (
          <p className={ui.note}>No invitations yet.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th scope="col">Candidate</th>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">Slot (IST)</th>
                <th scope="col">Status</th>
                <th scope="col">Messages</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((row) => {
                const actions = rowActions(drive, row);
                const asked = ask?.invitationId === row.invitationId ? ask : null;
                return (
                  <Fragment key={row.invitationId}>
                    <tr>
                      <th scope="row">{row.label}</th>
                      <td>{row.nameDisplay ?? dash}</td>
                      <td>{row.emailHint ?? dash}</td>
                      <td>{row.phoneHint ?? dash}</td>
                      <td>{row.slotStartsAt === undefined ? dash : formatIst(row.slotStartsAt)}</td>
                      <td>{INVITATION_STATUS_LABEL[row.status]}</td>
                      <td>
                        <Delivery row={row} />
                      </td>
                      <td>
                        <div className={ui.row}>
                          {actions.move && (
                            <button
                              type="button"
                              className={ui.button}
                              disabled={props.busy}
                              aria-label={`Move to slot, ${row.label}`}
                              onClick={() => {
                                props.onAsk('move', row);
                              }}
                            >
                              Move to slot
                            </button>
                          )}
                          {actions.resend && (
                            <button
                              type="button"
                              className={ui.button}
                              disabled={props.busy}
                              aria-label={`Resend invite, ${row.label}`}
                              onClick={() => {
                                props.onResend(row);
                              }}
                            >
                              Resend invite
                            </button>
                          )}
                          {actions.revoke && (
                            <button
                              type="button"
                              className={ui.button}
                              disabled={props.busy}
                              aria-label={`Revoke, ${row.label}`}
                              onClick={() => {
                                props.onAsk('revoke', row);
                              }}
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {asked?.kind === 'revoke' && (
                      <tr>
                        <td colSpan={8}>
                          <div className={ui.dialog} role="group" aria-label="Are you sure?">
                            <div className={ui.stack}>
                              <p>{`Revoke the invitation of ${row.label}? Their link stops working.`}</p>
                              <div className={ui.row}>
                                <button
                                  type="button"
                                  className={ui.button}
                                  disabled={props.busy}
                                  onClick={props.onRevoke}
                                >
                                  Yes, revoke
                                </button>
                                <button type="button" className={ui.button} onClick={props.onKeep}>
                                  Keep the invitation
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    {asked?.kind === 'move' && (
                      <tr>
                        <td colSpan={8}>
                          <div className={ui.dialog} role="group" aria-label={`Move ${row.label}`}>
                            <div className={ui.form}>
                              {props.targets === null ? (
                                <p role="status">Loading slots...</p>
                              ) : (
                                <label className={ui.field}>
                                  <span className={ui.label}>Move to</span>
                                  <select
                                    className={ui.select}
                                    value={props.choice}
                                    onChange={(e) => {
                                      props.onChoice(e.target.value);
                                    }}
                                  >
                                    <option value="">Choose a slot</option>
                                    {props.targets.map((slot) => (
                                      <option key={slot.id} value={slot.id}>
                                        {`${formatIst(slot.startsAt)} (${String(slot.capacity - slot.booked)} seats free)`}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              {props.targets?.length === 0 && (
                                <p className={ui.note}>
                                  No open slot in the future has a seat free.
                                </p>
                              )}
                              <div className={ui.row}>
                                <button
                                  type="button"
                                  className={`${ui.button} ${ui.primary}`}
                                  disabled={props.busy || props.choice === ''}
                                  onClick={props.onMove}
                                >
                                  Move
                                </button>
                                <button type="button" className={ui.button} onClick={props.onKeep}>
                                  Keep the slot
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        ))}
      <PagerControls
        hasPrevious={props.hasPrevious}
        hasNext={props.hasNext}
        of="invitations"
        onPrevious={props.onPrevious}
        onNext={props.onNext}
      />
    </section>
  );
}
