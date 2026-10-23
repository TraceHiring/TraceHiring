// `/library` (specs/m1-test-authoring.md M1-4, §6.2, E7, E8; I-M1-5, SEC-M1-1). Staff browse the Trace library as
// cards: stem, options, skill, difficulty. A card never has an answer key and never a parameter spec: the api sends
// neither and this screen has nowhere to show them. Staff build a copy list one click at a time (no row selection)
// and copy it into their bank; a copy is a frozen version in their own workspace. The daily cap and the rate limit
// show fixed sentences.
import type { LibraryItemCard } from '@trace/shared/contracts/m1';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ApiResult } from '../api/client';
import { browseLibrary, copyLibraryItems } from '../api/endpoints';
import { useApi } from '../api/runtime';
import { toPage } from '../bank/BankRoute';
import { FilterForm } from '../bank/FilterForm';
import { EMPTY_FILTERS, libraryQuery, type Filters } from '../bank/filters';
import { FORMAT_LABEL, bankErrorText, difficultyText } from '../bank/labels';
import { usePages, type Page } from '../bank/use-pages';
import ui from '../common/Ui.module.css';
import {
  COPY_LIMIT,
  addToCopyList,
  inCopyList,
  removeFromCopyList,
  toCopyRequest,
  type CopyEntry,
} from './copy-list';

/** The line after a copy: how many items reached the bank, and a link to it. */
export function CopyDoneLine({ copied }: { copied: number }) {
  return (
    <p role="status">
      {`Copied ${String(copied)} ${copied === 1 ? 'item' : 'items'} to your bank. `}
      <Link to="/bank">Open the item bank</Link>
    </p>
  );
}

export function LibraryCards({
  cards,
  list,
  onAdd,
}: {
  cards: readonly LibraryItemCard[];
  list: readonly CopyEntry[];
  onAdd(entry: CopyEntry): void;
}) {
  if (cards.length === 0) return <p>No library items match.</p>;
  return (
    <ul className={ui.items} aria-label="Library items">
      {cards.map((card) => {
        const chosen = inCopyList(list, card.libraryItemVersionId);
        return (
          <li key={card.libraryItemVersionId} className={ui.panel}>
            <p>{card.stem}</p>
            {card.options !== undefined && (
              <ul className={ui.items}>
                {card.options.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            )}
            <p className={ui.note}>
              {`${FORMAT_LABEL[card.format]} · Skill ${card.skillKey} · Difficulty ${difficultyText(card.difficulty)}${card.isParameterised ? ' · Parameterised' : ''}`}
            </p>
            <button
              type="button"
              className={ui.button}
              disabled={chosen || list.length >= COPY_LIMIT}
              aria-label={`${chosen ? 'In the copy list' : 'Add to copy list'}: ${card.stem}`}
              onClick={() => {
                onAdd({ id: card.libraryItemVersionId, stem: card.stem });
              }}
            >
              {chosen ? 'In the copy list' : 'Add to copy list'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function CopyListPanel({
  list,
  busy,
  onRemove,
  onCopy,
}: {
  list: readonly CopyEntry[];
  busy: boolean;
  onRemove(id: string): void;
  onCopy(): void;
}) {
  return (
    <section className={ui.panel} aria-label="Copy list">
      <h3 className={ui.subtitle}>Copy list</h3>
      {list.length === 0 ? (
        <p className={ui.note}>The copy list is empty.</p>
      ) : (
        <>
          <p
            className={ui.note}
          >{`${String(list.length)} ${list.length === 1 ? 'item' : 'items'}`}</p>
          <ul className={ui.items}>
            {list.map((entry) => (
              <li key={entry.id} className={ui.row}>
                <span>{entry.stem}</span>
                <button
                  type="button"
                  className={ui.button}
                  aria-label={`Remove from copy list: ${entry.stem}`}
                  onClick={() => {
                    onRemove(entry.id);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        className={`${ui.button} ${ui.primary}`}
        disabled={busy || list.length === 0}
        onClick={onCopy}
      >
        Copy to bank
      </button>
    </section>
  );
}

export function LibraryRoute() {
  const api = useApi();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [problem, setProblem] = useState<string | null>(null);
  const [list, setList] = useState<CopyEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const loadPage = useMemo(
    () =>
      api === null
        ? null
        : async (cursor: string | undefined): Promise<ApiResult<Page<LibraryItemCard>>> => {
            const built = libraryQuery(applied, cursor);
            if (!built.ok) return { ok: false, code: 'bad_request' };
            return toPage(await browseLibrary(api, built.query), (data) => data.items);
          },
    [api, applied],
  );
  const { state, loadMore } = usePages(loadPage);

  const apply = () => {
    const built = libraryQuery(draft);
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
  const copy = () => {
    const request = toCopyRequest(list);
    if (request === null || api === null) return;
    setBusy(true);
    setFailure(null);
    setCopied(null);
    void copyLibraryItems(api, request).then((result) => {
      setBusy(false);
      if (result.ok) {
        setCopied(result.data.itemVersionIds.length);
        setList([]);
      } else {
        setFailure(result.code);
      }
    });
  };

  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Library</h2>
      <p className={ui.note}>
        Approved items from Trace. Answer keys are never shown for library items. A copy is a frozen
        version in your own bank.
      </p>
      <FilterForm
        kind="library"
        value={draft}
        error={problem}
        onChange={setDraft}
        onApply={apply}
        onReset={reset}
      />
      <CopyListPanel
        list={list}
        busy={busy}
        onRemove={(id) => {
          setList((prev) => removeFromCopyList(prev, id));
        }}
        onCopy={copy}
      />
      {copied !== null && <CopyDoneLine copied={copied} />}
      {failure !== null && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(failure)}
        </p>
      )}
      {state.kind === 'loading' && <p role="status">Loading...</p>}
      {state.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(state.code)}
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          <LibraryCards
            cards={state.rows}
            list={list}
            onAdd={(entry) => {
              setList((prev) => addToCopyList(prev, entry));
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
    </section>
  );
}

export default LibraryRoute;
