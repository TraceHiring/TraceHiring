// `/bank` (specs/m1-test-authoring.md §6.2, §6.3, §6.11; R5-54 a): the item bank list with its filters, keyset paging,
// an exposure column and the ABH-7 share metric. Staff create and import; a reviewer only reads.
import type { BankItemSummary, BankStatsResponse } from '@trace/shared/contracts/m1';
import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ApiResult } from '../api/client';
import { bankStats, listBankItems } from '../api/endpoints';
import { useApi, useOrgInfo } from '../api/runtime';
import ui from '../common/Ui.module.css';
import { useResource } from '../common/useResource';
import { isStaff } from '../shell/nav';
import { FilterForm } from './FilterForm';
import { EMPTY_FILTERS, bankQuery, type Filters } from './filters';
import {
  AI_DRAFT_BADGE,
  FORMAT_LABEL,
  ORIGIN_LABEL,
  STATUS_LABEL,
  bankErrorText,
  difficultyText,
  percentText,
} from './labels';
import { usePages, type Page } from './use-pages';

/** The origin cell: the plain origin, and the approval badge on an AI draft that still waits (§6.4). */
export function OriginCell({ item }: { item: Pick<BankItemSummary, 'origin' | 'status'> }) {
  return (
    <>
      {ORIGIN_LABEL[item.origin]}
      {item.origin === 'ai_draft' && item.status === 'in_review' && (
        <>
          {' '}
          <strong>{AI_DRAFT_BADGE}</strong>
        </>
      )}
    </>
  );
}

export function BankTable({ rows }: { rows: readonly BankItemSummary[] }) {
  if (rows.length === 0) return <p>No items match.</p>;
  return (
    <table className={ui.table}>
      <thead>
        <tr>
          <th scope="col">Item</th>
          <th scope="col">Format</th>
          <th scope="col">Skill</th>
          <th scope="col">Difficulty</th>
          <th scope="col">Status</th>
          <th scope="col">Origin</th>
          <th scope="col">Version</th>
          <th scope="col">Variants</th>
          <th scope="col">Times served</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => (
          <tr key={item.itemVersionId}>
            <th scope="row">
              <Link to={`/bank/items/${item.itemId}`}>{item.stemPreview}</Link>
            </th>
            <td>{FORMAT_LABEL[item.format]}</td>
            <td>{item.skillKey}</td>
            <td>{difficultyText(item.difficulty)}</td>
            <td>{STATUS_LABEL[item.status]}</td>
            <td>
              <OriginCell item={item} />
            </td>
            <td>{`v${String(item.versionNo)}`}</td>
            <td>{item.isParameterised ? 'Parameterised' : 'Fixed'}</td>
            <td>{item.exposureCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The ABH-7 share metric: counts only (§6.3). */
export function StatsPanel({ stats }: { stats: BankStatsResponse }) {
  const { org, library } = stats;
  return (
    <section className={ui.panel} aria-label="Parameterised share">
      <p>
        {org.share === null
          ? 'No approved quant items yet.'
          : `${String(org.quantItemsParameterised)} of ${String(org.quantItemsApproved)} approved quant items are parameterised (${percentText(org.share)})`}
      </p>
      {library !== null && (
        <p>
          {library.share === null
            ? 'Trace library: no approved quant items yet.'
            : `Trace library: ${String(library.quantItemsParameterised)} of ${String(library.quantItemsApproved)} (${percentText(library.share)})`}
        </p>
      )}
      <p className={ui.note}>Target: at least 40% of quant items vary per candidate.</p>
    </section>
  );
}

/** Turns a list answer into a page for `usePages`. */
export function toPage<R extends { nextCursor: string | null }, T>(
  result: ApiResult<R>,
  rows: (data: R) => readonly T[],
): ApiResult<Page<T>> {
  return result.ok
    ? { ok: true, data: { rows: rows(result.data), nextCursor: result.data.nextCursor } }
    : result;
}

export function BankRoute() {
  const api = useApi();
  const info = useOrgInfo();
  const staff = info !== null && isStaff(info.roles);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [problem, setProblem] = useState<string | null>(null);

  const loadPage = useMemo(
    () =>
      api === null
        ? null
        : async (cursor: string | undefined): Promise<ApiResult<Page<BankItemSummary>>> => {
            const built = bankQuery(applied, cursor);
            if (!built.ok) return { ok: false, code: 'bad_request' };
            return toPage(await listBankItems(api, built.query), (data) => data.items);
          },
    [api, applied],
  );
  const { state, loadMore } = usePages(loadPage);

  const loadStats = useCallback(
    () =>
      api === null ? Promise.resolve({ ok: false as const, code: 'unauthorized' }) : bankStats(api),
    [api],
  );
  const [stats] = useResource(staff ? loadStats : null);

  const apply = () => {
    const built = bankQuery(draft);
    if (!built.ok) {
      setProblem(built.message);
      return;
    }
    setProblem(null);
    setApplied({ ...draft });
  };
  const reset = () => {
    setDraft(EMPTY_FILTERS);
    setApplied({ ...EMPTY_FILTERS });
    setProblem(null);
  };

  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Item bank</h2>
      <nav className={ui.row} aria-label="Bank">
        <Link to="/bank/approvals">Item approvals</Link>
        {staff && (
          <>
            <Link to="/bank/items/new">New item</Link>
            <Link to="/bank/import">Import items</Link>
            <Link to="/bank/ai-drafts">AI drafts</Link>
            <Link to="/bank/pools">Pools</Link>
            <Link to="/library">Library</Link>
          </>
        )}
      </nav>
      {staff && stats.kind === 'ready' && <StatsPanel stats={stats.data} />}
      {staff && stats.kind === 'error' && <p className={ui.note}>The share could not be read.</p>}
      <FilterForm
        kind="bank"
        value={draft}
        error={problem}
        onChange={setDraft}
        onApply={apply}
        onReset={reset}
      />
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          <BankTable rows={state.rows} />
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
    </section>
  );
}

export default BankRoute;
