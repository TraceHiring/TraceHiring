// `/drives/:driveId` (specs/m2-scheduling-invites.md §4, §6.1, M2-11, M2-14, M2-17, R5-13, R5-52 d, R5-59, R5-64 f): the
// drive's details and pool warning, Publish / Close / Cancel by status, its slots (paged, created by list or generator),
// its invitations in pages with one-row-at-a-time Move to slot, Resend invite and Revoke, and on a cancelled drive the
// one drive-level "Revoke all invitations not yet started". Nothing here selects rows or acts on several at once, and
// nothing revokes by itself (rule 2). The server decides every request; a refusal is shown as fixed words.
import type { DriveDetail, InvitationRow, SlotView } from '@trace/shared/contracts/m2';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ApiClient, ApiResult } from '../api/client';
import {
  cancelDrive,
  closeDrive,
  createSlots,
  getDrive,
  listDriveInvitations,
  listSlots,
  moveInvitation,
  publishDrive,
  resendInvitation,
  revokeInvitation,
  revokeNotStarted,
} from '../api/endpoints';
import { useApi } from '../api/runtime';
import ui from '../common/Ui.module.css';
import { DriveActions, DriveDetailsPanel, PoolWarning, type DriveAsk } from './DriveDetails';
import { InvitationsPanel, type RowAsk } from './InvitationsPanel';
import { driveErrorText } from './messages';
import { SlotsPanel } from './SlotsPanel';
import { EMPTY_SLOT_FORM, buildSlotsRequest, movableSlots, type SlotForm } from './slot-form';
import { usePager } from './use-pager';

type DriveState =
  { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ready'; drive: DriveDetail };

/** Every page of a drive's slots (for the move picker), up to a sane cap. */
async function allSlots(api: ApiClient, driveId: string): Promise<SlotView[]> {
  const out: SlotView[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await listSlots(api, driveId, cursor === undefined ? undefined : { cursor });
    if (!result.ok) break;
    out.push(...result.data.slots.filter((slot) => !out.some((known) => known.id === slot.id)));
    if (result.data.nextCursor === null || result.data.nextCursor === cursor) break;
    cursor = result.data.nextCursor;
  }
  return out;
}

export function DriveRoute() {
  const { driveId = '' } = useParams();
  // One screen per drive: moving to another drive starts from a clean state.
  return <DriveScreen key={driveId} driveId={driveId} />;
}

function DriveScreen({ driveId }: { driveId: string }) {
  const api = useApi();
  const [drive, setDrive] = useState<DriveState>({ kind: 'loading' });
  const ready = drive.kind === 'ready';
  const scheduled = drive.kind === 'ready' && drive.drive.mode === 'scheduled';

  useEffect(() => {
    if (api === null || driveId === '') return;
    let live = true;
    void getDrive(api, driveId).then((result) => {
      if (!live) return;
      setDrive(
        result.ok ? { kind: 'ready', drive: result.data } : { kind: 'error', code: result.code },
      );
    });
    return () => {
      live = false;
    };
  }, [api, driveId]);

  // ---- The two paged lists ----
  const loadSlots = useCallback(
    async (cursor: string | undefined) => {
      if (api === null) return { ok: false as const, code: 'unauthorized' };
      const result = await listSlots(api, driveId, cursor === undefined ? undefined : { cursor });
      return result.ok
        ? {
            ok: true as const,
            data: { rows: result.data.slots, nextCursor: result.data.nextCursor },
          }
        : result;
    },
    [api, driveId],
  );
  const loadInvitations = useCallback(
    async (cursor: string | undefined) => {
      if (api === null) return { ok: false as const, code: 'unauthorized' };
      const result = await listDriveInvitations(
        api,
        driveId,
        cursor === undefined ? undefined : { cursor },
      );
      return result.ok
        ? {
            ok: true as const,
            data: { rows: result.data.invitations, nextCursor: result.data.nextCursor },
          }
        : result;
    },
    [api, driveId],
  );
  const slots = usePager<SlotView>(api !== null && scheduled ? loadSlots : null);
  const invitations = usePager<InvitationRow>(api !== null && ready ? loadInvitations : null);

  // ---- Drive-level actions ----
  const [driveAsk, setDriveAsk] = useState<DriveAsk | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [revokeResult, setRevokeResult] = useState<string | null>(null);

  const runDriveAction = async (
    call: (client: ApiClient) => Promise<ApiResult<DriveDetail>>,
    reloadInvitations: boolean,
  ) => {
    if (api === null) return;
    setDriveBusy(true);
    setDriveError(null);
    setRevokeResult(null);
    const result = await call(api);
    setDriveBusy(false);
    setDriveAsk(null);
    if (result.ok) {
      setDrive({ kind: 'ready', drive: result.data });
      if (reloadInvitations) invitations.reset();
    } else {
      setDriveError(result.code);
    }
  };
  const answerYes = async () => {
    if (api === null || driveAsk === null) return;
    if (driveAsk === 'close') await runDriveAction((client) => closeDrive(client, driveId), false);
    else if (driveAsk === 'cancel') {
      await runDriveAction((client) => cancelDrive(client, driveId), true);
    } else {
      setDriveBusy(true);
      setDriveError(null);
      const result = await revokeNotStarted(api, driveId);
      setDriveBusy(false);
      setDriveAsk(null);
      if (result.ok) {
        setRevokeResult(
          `${String(result.data.revoked)} revoked, ${String(result.data.skipped)} skipped (a test may still start)`,
        );
        invitations.reset();
      } else {
        setDriveError(result.code);
      }
    }
  };

  // ---- Slots form ----
  const [slotForm, setSlotForm] = useState<SlotForm>(EMPTY_SLOT_FORM);
  const [slotProblems, setSlotProblems] = useState<readonly string[]>([]);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const [slotBusy, setSlotBusy] = useState(false);
  const createSlotsNow = async () => {
    const built = buildSlotsRequest(slotForm);
    setSlotError(null);
    setSlotNotice(null);
    if (!built.ok) {
      setSlotProblems(built.problems);
      return;
    }
    setSlotProblems([]);
    if (api === null) return;
    setSlotBusy(true);
    const result = await createSlots(api, driveId, built.request);
    setSlotBusy(false);
    if (result.ok) {
      const n = result.data.slots.length;
      setSlotNotice(`${String(n)} slot${n === 1 ? '' : 's'} created.`);
      setSlotForm((f) => ({ ...EMPTY_SLOT_FORM, how: f.how }));
      slots.reset();
    } else {
      setSlotError(result.code);
    }
  };

  // ---- Row actions: one invitation at a time ----
  const [ask, setAsk] = useState<RowAsk | null>(null);
  const [choice, setChoice] = useState('');
  const [targets, setTargets] = useState<readonly SlotView[] | null>(null);
  const [rowBusy, setRowBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  const askedId = useRef<string | null>(null);

  const replaceRow = (row: InvitationRow) => {
    invitations.patch((rows) => rows.map((r) => (r.invitationId === row.invitationId ? row : r)));
  };
  const onAsk = (kind: RowAsk['kind'], row: InvitationRow) => {
    setAsk({ kind, invitationId: row.invitationId });
    askedId.current = row.invitationId;
    setChoice('');
    setRowError(null);
    setRowNotice(null);
    setTargets(null);
    if (kind === 'move' && api !== null) {
      void allSlots(api, driveId).then((found) => {
        if (askedId.current !== row.invitationId) return;
        setTargets(movableSlots(found, row.slotStartsAt, Date.now()));
      });
    }
  };
  const onKeep = () => {
    askedId.current = null;
    setAsk(null);
  };
  const rowCall = async (
    call: (client: ApiClient) => Promise<ApiResult<InvitationRow>>,
    notice: string,
    refreshSlots: boolean,
  ) => {
    if (api === null) return;
    setRowBusy(true);
    setRowError(null);
    setRowNotice(null);
    const result = await call(api);
    setRowBusy(false);
    askedId.current = null;
    setAsk(null);
    if (result.ok) {
      replaceRow(result.data);
      setRowNotice(notice);
      if (refreshSlots && scheduled) slots.reset();
    } else {
      setRowError(result.code);
    }
  };

  // ---- The screen ----
  const heading = drive.kind === 'ready' ? drive.drive.name : 'Drive';
  return (
    <section className={ui.stack}>
      <p>
        <Link to="/drives">All drives</Link>
      </p>
      <h2 className={ui.title}>{heading}</h2>
      {drive.kind === 'loading' && <p role="status">Loading...</p>}
      {drive.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {driveErrorText(drive.code)}
        </p>
      )}
      {drive.kind === 'ready' && (
        <>
          <DriveDetailsPanel drive={drive.drive} />
          <PoolWarning drive={drive.drive} />
          <DriveActions
            drive={drive.drive}
            pending={driveAsk}
            busy={driveBusy}
            revokeResult={revokeResult}
            onPublish={() => {
              void runDriveAction((client) => publishDrive(client, driveId), false);
            }}
            onAsk={(next) => {
              setDriveError(null);
              setDriveAsk(next);
            }}
            onKeep={() => {
              setDriveAsk(null);
            }}
            onYes={() => void answerYes()}
          />
          {driveError !== null && (
            <p role="alert" className={ui.alert}>
              {driveErrorText(driveError)}
            </p>
          )}
          {drive.drive.mode === 'scheduled' ? (
            <SlotsPanel
              state={slots.state}
              hasPrevious={slots.hasPrevious}
              hasNext={slots.hasNext}
              onPrevious={slots.previous}
              onNext={slots.next}
              canCreate={drive.drive.status === 'draft' || drive.drive.status === 'scheduled'}
              form={slotForm}
              problems={slotProblems}
              error={slotError}
              notice={slotNotice}
              busy={slotBusy}
              onForm={(patch) => {
                setSlotForm((f) => ({ ...f, ...patch }));
              }}
              onCreate={() => void createSlotsNow()}
            />
          ) : (
            <p className={ui.note}>
              Candidates start any time between the opening time and the deadline.
            </p>
          )}
          <InvitationsPanel
            drive={drive.drive}
            state={invitations.state}
            hasPrevious={invitations.hasPrevious}
            hasNext={invitations.hasNext}
            onPrevious={invitations.previous}
            onNext={invitations.next}
            ask={ask}
            targets={targets}
            choice={choice}
            busy={rowBusy}
            error={rowError}
            notice={rowNotice}
            onAsk={onAsk}
            onKeep={onKeep}
            onChoice={setChoice}
            onMove={() => {
              if (ask !== null && choice !== '') {
                void rowCall(
                  (client) =>
                    moveInvitation(client, driveId, ask.invitationId, { toSlotId: choice }),
                  'Moved. A new invite is queued.',
                  true,
                );
              }
            }}
            onResend={(row) => {
              void rowCall(
                (client) => resendInvitation(client, driveId, row.invitationId),
                'A new invite is queued.',
                false,
              );
            }}
            onRevoke={() => {
              if (ask !== null) {
                void rowCall(
                  (client) => revokeInvitation(client, driveId, ask.invitationId),
                  'Invitation revoked.',
                  true,
                );
              }
            }}
          />
        </>
      )}
    </section>
  );
}
