// `/bank/approvals` (specs/m1-test-authoring.md §6.2, §6.4, M1-3; R5-22, R5-40): the queue of item versions in review
// for staff and reviewers. An approver opens an item, reads it with its key, and chooses "Approve" or "Send back".
// An AI draft is marked "AI draft — needs approval". This screen concerns items only: no candidate appears here.
import type { BankItemSummary } from '@trace/shared/contracts/m1';
import { useCallback, useMemo, useState } from 'react';
import type { ApiClient, ApiResult } from '../api/client';
import { getBankItem, listBankItems, reviewBankItemVersion } from '../api/endpoints';
import { useApi, useOrgInfo } from '../api/runtime';
import { formatTime } from '../common/format';
import ui from '../common/Ui.module.css';
import { useResource } from '../common/useResource';
import { OriginCell, toPage } from './BankRoute';
import { ItemContentView } from './ItemContentView';
import { APPROVAL_STALE, FORMAT_LABEL, bankErrorText, difficultyText } from './labels';
import { ReviewPanel } from './ReviewPanel';
import { usePages, type Page } from './use-pages';

export function ApprovalQueueTable({
  rows,
  openId,
  onOpen,
}: {
  rows: readonly BankItemSummary[];
  openId: string | null;
  onOpen(item: BankItemSummary): void;
}) {
  if (rows.length === 0) return <p>Nothing is waiting for approval.</p>;
  return (
    <table className={ui.table}>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Format</th>
          <th scope="col">Skill</th>
          <th scope="col">Difficulty</th>
          <th scope="col">Origin</th>
          <th scope="col">Created</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => (
          <tr key={item.itemVersionId}>
            <th scope="row">{item.stemPreview}</th>
            <td>{FORMAT_LABEL[item.format]}</td>
            <td>{item.skillKey}</td>
            <td>{difficultyText(item.difficulty)}</td>
            <td>
              <OriginCell item={item} />
            </td>
            <td>{formatTime(item.createdAt)}</td>
            <td>
              <button
                type="button"
                className={ui.button}
                aria-label={`Open: ${item.stemPreview}`}
                aria-pressed={openId === item.itemId}
                onClick={() => {
                  onOpen(item);
                }}
              >
                Open
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OpenItem({
  api,
  itemId,
  itemVersionId,
  userId,
  onDone,
}: {
  api: ApiClient;
  itemId: string;
  /** The version that was queued: only this version can be decided here. */
  itemVersionId: string;
  userId: string;
  onDone(message: string): void;
}) {
  const load = useCallback(() => getBankItem(api, itemId), [api, itemId]);
  const [state] = useResource(load);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (state.kind === 'loading') return <p role="status">Loading...</p>;
  if (state.kind === 'error') {
    return (
      <p role="alert" className={ui.alert}>
        {bankErrorText(state.code)}
      </p>
    );
  }
  const detail = state.data;
  if (detail.itemVersionId !== itemVersionId) {
    return (
      <p role="alert" className={ui.alert}>
        {APPROVAL_STALE}
      </p>
    );
  }
  const decide = (decision: 'approve' | 'not_approved') => {
    setBusy(true);
    setFailure(null);
    void reviewBankItemVersion(api, { itemVersionId: detail.itemVersionId, decision }).then(
      (result) => {
        setBusy(false);
        if (result.ok) onDone(decision === 'approve' ? 'Approved.' : 'Sent back.');
        else setFailure(result.code);
      },
    );
  };
  return (
    <div className={ui.stack}>
      <ItemContentView detail={detail} />
      {detail.status === 'in_review' ? (
        <ReviewPanel
          detail={detail}
          userId={userId}
          busy={busy}
          error={failure}
          onDecide={decide}
        />
      ) : (
        <p className={ui.note}>This version is no longer waiting for approval.</p>
      )}
    </div>
  );
}

export function ApprovalsRoute() {
  const api = useApi();
  const info = useOrgInfo();
  const [open, setOpen] = useState<{ itemId: string; itemVersionId: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadPage = useMemo(
    () =>
      api === null
        ? null
        : async (cursor: string | undefined): Promise<ApiResult<Page<BankItemSummary>>> =>
            toPage(
              await listBankItems(
                api,
                cursor === undefined ? { status: 'in_review' } : { status: 'in_review', cursor },
              ),
              (data) => data.items,
            ),
    [api],
  );
  const { state, loadMore, reload } = usePages(loadPage);

  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Item approvals</h2>
      <p className={ui.note}>
        Items waiting for approval. Nothing reaches a candidate before a person approves it.
      </p>
      {message !== null && <p role="status">{message}</p>}
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          <ApprovalQueueTable
            rows={state.rows}
            openId={open?.itemId ?? null}
            onOpen={(item) => {
              setMessage(null);
              setOpen({ itemId: item.itemId, itemVersionId: item.itemVersionId });
            }}
          />
          {state.moreError !== null && (
            <p role="alert" className={ui.alert}>
              {bankErrorText(state.moreError)}
            </p>
          )}
          {state.nextCursor !== null && (
            <p>
              <button type="button" className={ui.button} disabled={state.more} onClick={loadMore}>
                Load more
              </button>
            </p>
          )}
        </>
      )}
      {open !== null && api !== null && info !== null && (
        <OpenItem
          key={open.itemVersionId}
          api={api}
          itemId={open.itemId}
          itemVersionId={open.itemVersionId}
          userId={info.userId}
          onDone={(done) => {
            setOpen(null);
            setMessage(done);
            reload();
          }}
        />
      )}
    </section>
  );
}

export default ApprovalsRoute;
