// `/bank/pools` (specs/m1-test-authoring.md §3.2, §6.2, §6.5, E3, E4; R5-54 a). Pools are working sets of approved
// items of one format. Staff create a pool, add approved items and remove items one click at a time (no row
// selection, no bulk bar), and see which tests draw from a pool and how far it is from 10 times its largest draw,
// the size a drive needs (ABH-10). A published test keeps the snapshot it was published with.
import {
  PoolRequest,
  SkillKey,
  type BankItemSummary,
  type ItemFormat,
  type PoolDetail,
} from '@trace/shared/contracts/m1';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { ApiClient, ApiResult } from '../api/client';
import {
  addPoolItems,
  createPool,
  getPool,
  listBankItems,
  listPools,
  removePoolItems,
} from '../api/endpoints';
import { useApi } from '../api/runtime';
import ui from '../common/Ui.module.css';
import { toPage } from './BankRoute';
import { FORMAT_LABEL, bankErrorText } from './labels';
import { usePages, type Page, type PagesState } from './use-pages';

const DRIVE_RATIO = 10;

/** How far a pool is from `DRIVE_RATIO` times the largest draw of the tests that use it (E3). */
export function driveGapText(pool: PoolDetail): string | null {
  if (pool.usedByDraws.length === 0) return null;
  const largest = Math.max(...pool.usedByDraws.map((d) => d.drawCount));
  const need = largest * DRIVE_RATIO;
  const basis = `${String(DRIVE_RATIO)} times the largest draw, ${String(largest)}`;
  const shown = pool.usedByDraws.length;
  const hidden = pool.usedByDrawsTotal - shown;
  const cutOff = hidden > 0;
  if (pool.approvedCount >= need) {
    if (!cutOff) return `Large enough for drives (${basis})`;
    // The tests that are not listed may draw more, so a complete claim would be wrong.
    const noun = hidden === 1 ? 'test is' : 'tests are';
    return `Large enough for the ${String(shown)} ${shown === 1 ? 'test' : 'tests'} shown (${basis}); ${String(hidden)} more ${noun} not shown and may need more`;
  }
  const missing = String(need - pool.approvedCount);
  return `Needs ${cutOff ? 'at least ' : ''}${missing} more approved items for drives (${basis})`;
}

function UsedBy({ pool }: { pool: PoolDetail }) {
  if (pool.usedByDrawsTotal === 0) return <p className={ui.note}>Not used by any test yet.</p>;
  const noun = pool.usedByDrawsTotal === 1 ? 'test' : 'tests';
  return (
    <div>
      <p>{`Used by ${String(pool.usedByDrawsTotal)} ${noun}`}</p>
      <ul className={ui.items}>
        {pool.usedByDraws.map((d) => (
          <li key={d.testId}>
            <Link to={`/tests/${d.testId}`}>{`Test …${d.testId.slice(-4)}`}</Link>
            {` draws ${String(d.drawCount)}`}
          </li>
        ))}
      </ul>
      {pool.usedByDraws.length < pool.usedByDrawsTotal && (
        <p className={ui.note}>
          {`Showing ${String(pool.usedByDraws.length)} of ${String(pool.usedByDrawsTotal)}`}
        </p>
      )}
      <p className={ui.note}>{driveGapText(pool)}</p>
    </div>
  );
}

export function PoolTable({
  pools,
  openId,
  onManage,
}: {
  pools: readonly PoolDetail[];
  openId: string | null;
  onManage(pool: PoolDetail): void;
}) {
  if (pools.length === 0) return <p>No pools yet.</p>;
  return (
    <table className={ui.table}>
      <thead>
        <tr>
          <th scope="col">Pool</th>
          <th scope="col">Format</th>
          <th scope="col">Skill</th>
          <th scope="col">Status</th>
          <th scope="col">Items</th>
          <th scope="col">Used by</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {pools.map((pool) => (
          <tr key={pool.id}>
            <th scope="row">{pool.name}</th>
            <td>{FORMAT_LABEL[pool.format]}</td>
            <td>{pool.skillKey ?? '–'}</td>
            <td>{pool.status === 'active' ? 'Active' : 'Archived'}</td>
            <td>{`${String(pool.approvedCount)} of ${String(pool.itemCount)} items approved`}</td>
            <td>
              <UsedBy pool={pool} />
            </td>
            <td>
              <button
                type="button"
                className={ui.button}
                aria-label={`Manage pool: ${pool.name}`}
                aria-pressed={openId === pool.id}
                onClick={() => {
                  onManage(pool);
                }}
              >
                Manage
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function NewPoolForm({
  busy,
  failure,
  onCreate,
}: {
  busy: boolean;
  failure: string | null;
  onCreate(request: PoolRequest): void;
}) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<ItemFormat>('mcq');
  const [skill, setSkill] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: string[] = [];
    const trimmed = skill.trim();
    const request = PoolRequest.safeParse({
      name,
      format,
      ...(trimmed === '' ? {} : { skillKey: trimmed }),
    });
    if (!request.success) {
      if (name.length < 1 || name.length > 120) {
        found.push('Give the pool a name (1 to 120 characters).');
      }
      if (trimmed !== '' && !SkillKey.safeParse(trimmed).success) {
        found.push('A skill is lower-case letters, digits and underscores.');
      }
      if (found.length === 0) found.push('Some values were not accepted. Check the form.');
      setProblems(found);
      return;
    }
    setProblems([]);
    onCreate(request.data);
  };
  return (
    <form className={ui.form} onSubmit={submit} aria-label="New pool">
      <label className={ui.field}>
        <span className={ui.label}>Pool name</span>
        <input
          className={ui.input}
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
      </label>
      <fieldset className={ui.fieldset}>
        <legend>Pool format</legend>
        <div className={ui.row}>
          {(['mcq', 'written'] as const).map((f) => (
            <label key={f} className={ui.choice}>
              <input
                type="radio"
                name="pool-format"
                checked={format === f}
                onChange={() => {
                  setFormat(f);
                }}
              />
              <span>{FORMAT_LABEL[f]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className={ui.field}>
        <span className={ui.label}>Skill</span>
        <input
          className={ui.input}
          type="text"
          placeholder="Optional"
          value={skill}
          onChange={(e) => {
            setSkill(e.target.value);
          }}
        />
      </label>
      {problems.map((p) => (
        <p key={p} role="alert" className={ui.alert}>
          {p}
        </p>
      ))}
      {failure !== null && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(failure)}
        </p>
      )}
      <div className={ui.row}>
        <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy}>
          Create pool
        </button>
      </div>
    </form>
  );
}

function ItemList({
  rows,
  actionLabel,
  verb,
  busy,
  onAct,
}: {
  rows: readonly BankItemSummary[];
  actionLabel: string;
  verb: 'Add to pool' | 'Remove from pool';
  busy: boolean;
  onAct(item: BankItemSummary): void;
}) {
  if (rows.length === 0) return <p className={ui.note}>None.</p>;
  return (
    <ul className={ui.items}>
      {rows.map((item) => (
        <li key={item.itemVersionId} className={ui.row}>
          <span>{item.stemPreview}</span>
          <span
            className={ui.note}
          >{`${item.skillKey} · ${item.difficulty?.toFixed(2) ?? '–'}`}</span>
          <button
            type="button"
            className={ui.button}
            disabled={busy}
            aria-label={`${verb}: ${item.stemPreview}`}
            onClick={() => {
              onAct(item);
            }}
          >
            {actionLabel}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PoolManager({
  api,
  pool,
  onChange,
}: {
  api: ApiClient;
  pool: PoolDetail;
  onChange(pool: PoolDetail): void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getPool(api, pool.id).then((result) => {
      if (live && result.ok) onChange(result.data);
    });
    return () => {
      live = false;
    };
    // Refresh once when the pool is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, pool.id]);

  const loadInPool = useMemo(
    () =>
      async (cursor: string | undefined): Promise<ApiResult<Page<BankItemSummary>>> =>
        toPage(
          await listBankItems(
            api,
            cursor === undefined ? { poolId: pool.id } : { poolId: pool.id, cursor },
          ),
          (data) => data.items,
        ),
    [api, pool.id],
  );
  const loadCandidates = useMemo(
    () =>
      async (cursor: string | undefined): Promise<ApiResult<Page<BankItemSummary>>> =>
        toPage(
          await listBankItems(api, {
            status: 'approved',
            format: pool.format,
            ...(pool.skillKey === null ? {} : { skillKey: pool.skillKey }),
            ...(cursor === undefined ? {} : { cursor }),
          }),
          (data) => data.items,
        ),
    [api, pool.format, pool.skillKey],
  );
  const inPool = usePages(loadInPool);
  const candidates = usePages(loadCandidates);

  const change = (call: () => Promise<ApiResult<PoolDetail>>) => {
    setBusy(true);
    setFailure(null);
    void call().then((result) => {
      setBusy(false);
      if (result.ok) {
        onChange(result.data);
        inPool.reload();
        candidates.reload();
      } else {
        setFailure(result.code);
      }
    });
  };

  return (
    <PoolManagerView
      pool={pool}
      busy={busy}
      failure={failure}
      inPool={inPool.state}
      candidates={candidates.state}
      onRemove={(item) => {
        change(() => removePoolItems(api, pool.id, { itemVersionIds: [item.itemVersionId] }));
      }}
      onAdd={(item) => {
        change(() => addPoolItems(api, pool.id, { itemVersionIds: [item.itemVersionId] }));
      }}
      onMoreInPool={inPool.loadMore}
      onMoreCandidates={candidates.loadMore}
    />
  );
}

/** The open pool: the items in it and the approved items that could be added, one click each. */
export function PoolManagerView({
  pool,
  busy,
  failure,
  inPool,
  candidates,
  onRemove,
  onAdd,
  onMoreInPool,
  onMoreCandidates,
}: {
  pool: PoolDetail;
  busy: boolean;
  failure: string | null;
  inPool: PagesState<BankItemSummary>;
  candidates: PagesState<BankItemSummary>;
  onRemove(item: BankItemSummary): void;
  onAdd(item: BankItemSummary): void;
  onMoreInPool(): void;
  onMoreCandidates(): void;
}) {
  const inPoolIds = new Set(inPool.kind === 'ready' ? inPool.rows.map((r) => r.itemVersionId) : []);
  const offered =
    candidates.kind === 'ready'
      ? candidates.rows.filter((r) => !inPoolIds.has(r.itemVersionId))
      : [];
  return (
    <section className={ui.stack} aria-label={`Pool: ${pool.name}`}>
      <h3 className={ui.subtitle}>{pool.name}</h3>
      <p
        className={ui.note}
      >{`${String(pool.approvedCount)} of ${String(pool.itemCount)} items approved`}</p>
      {failure !== null && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(failure)}
        </p>
      )}
      <h4 className={ui.subtitle}>Items in this pool</h4>
      {inPool.kind === 'loading' && <p role="status">Loading...</p>}
      {inPool.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(inPool.code)}
        </p>
      )}
      {inPool.kind === 'ready' && (
        <>
          <ItemList
            rows={inPool.rows}
            actionLabel="Remove"
            verb="Remove from pool"
            busy={busy}
            onAct={onRemove}
          />
          {inPool.nextCursor !== null && (
            <button type="button" className={ui.button} onClick={onMoreInPool}>
              Load more items in the pool
            </button>
          )}
        </>
      )}
      <h4 className={ui.subtitle}>Approved items that could be added</h4>
      {candidates.kind === 'loading' && <p role="status">Loading...</p>}
      {candidates.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(candidates.code)}
        </p>
      )}
      {candidates.kind === 'ready' && (
        <>
          <ItemList rows={offered} actionLabel="Add" verb="Add to pool" busy={busy} onAct={onAdd} />
          {candidates.nextCursor !== null && (
            <button type="button" className={ui.button} onClick={onMoreCandidates}>
              Load more approved items
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function PoolsRoute() {
  const api = useApi();
  const [openId, setOpenId] = useState<string | null>(null);
  const [updated, setUpdated] = useState<Readonly<Record<string, PoolDetail>>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const loadPage = useMemo(
    () =>
      api === null
        ? null
        : async (cursor: string | undefined): Promise<ApiResult<Page<PoolDetail>>> =>
            toPage(
              await listPools(api, cursor === undefined ? {} : { cursor }),
              (data) => data.pools,
            ),
    [api],
  );
  const { state, loadMore, reload } = usePages(loadPage);

  const remember = useCallback((pool: PoolDetail) => {
    setUpdated((prev) => ({ ...prev, [pool.id]: pool }));
  }, []);
  const create = (request: PoolRequest) => {
    if (api === null) return;
    setBusy(true);
    setFailure(null);
    void createPool(api, request).then((result) => {
      setBusy(false);
      if (result.ok) {
        remember(result.data);
        reload();
      } else {
        setFailure(result.code);
      }
    });
  };

  const pools = state.kind === 'ready' ? state.rows.map((p) => updated[p.id] ?? p) : [];
  const open = pools.find((p) => p.id === openId);

  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Pools</h2>
      <p className={ui.note}>
        A pool is a set of approved items. A test section draws from one pool; a published test
        keeps the items it was published with.
      </p>
      <NewPoolForm busy={busy} failure={failure} onCreate={create} />
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          <PoolTable
            pools={pools}
            openId={openId}
            onManage={(p) => {
              setOpenId(p.id);
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
      {open !== undefined && api !== null && (
        <PoolManager key={open.id} api={api} pool={open} onChange={remember} />
      )}
    </section>
  );
}

export default PoolsRoute;
