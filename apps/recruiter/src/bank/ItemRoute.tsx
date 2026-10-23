// `/bank/items/new` and `/bank/items/:itemId` (specs/m1-test-authoring.md §3.3, §4.1, §6.2, §6.11; R5-22, R5-40).
// Create and edit a draft (staff), submit it for review, approve or send back (staff and reviewers), retire, and
// start a new version of an approved item. A reviewer reads and approves but never edits. A library-sourced item
// shows no key and no parameter spec. Item review concerns the item only, never a candidate.
import type { BankItemDetail } from '@trace/shared/contracts/m1';
import { useCallback, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { ApiClient, ApiResult } from '../api/client';
import {
  createBankItem,
  createBankItemVersion,
  getBankItem,
  retireBankItemVersion,
  reviewBankItemVersion,
  submitBankItemVersion,
  updateBankItem,
} from '../api/endpoints';
import { useApi, useOrgInfo } from '../api/runtime';
import ui from '../common/Ui.module.css';
import { useResource } from '../common/useResource';
import { isStaff } from '../shell/nav';
import { ItemContentView } from './ItemContentView';
import { ItemFormView } from './ItemFormView';
import {
  emptyItemForm,
  formFromDetail,
  toDraft,
  type FieldError,
  type ItemForm,
} from './item-form';
import { bankErrorText } from './labels';
import { ReviewPanel } from './ReviewPanel';

function CreateItem({ api }: { api: ApiClient | null }) {
  const navigate = useNavigate();
  const [form, setForm] = useState<ItemForm>(() => emptyItemForm('mcq'));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = toDraft(form);
    if (!draft.ok) {
      setErrors(draft.errors);
      return;
    }
    setErrors([]);
    if (api === null) {
      setFailure('unauthorized');
      return;
    }
    setBusy(true);
    setFailure(null);
    void createBankItem(api, draft.draft).then((result) => {
      setBusy(false);
      if (result.ok) void navigate(`/bank/items/${result.data.itemId}`);
      else setFailure(result.code);
    });
  };

  return (
    <form className={ui.stack} onSubmit={submit} aria-label="New item">
      <ItemFormView form={form} errors={errors} formatLocked={false} onChange={setForm} />
      {failure !== null && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(failure)}
        </p>
      )}
      <div className={ui.row}>
        <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy}>
          Create draft
        </button>
      </div>
    </form>
  );
}

function ItemDetailScreen({
  api,
  initial,
  roles,
  userId,
}: {
  api: ApiClient;
  initial: BankItemDetail;
  roles: readonly string[];
  userId: string;
}) {
  const [detail, setDetail] = useState(initial);
  const [form, setForm] = useState<ItemForm>(() => formFromDetail(initial));
  const [saved, setSaved] = useState(() => JSON.stringify(formFromDetail(initial)));
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const staff = isStaff(roles);
  const dirty = JSON.stringify(form) !== saved;
  const canEdit = staff && detail.status === 'draft' && !detail.librarySourced;
  const canReview = detail.status === 'in_review';
  const canRetire = staff && detail.status === 'approved';
  const canNewVersion =
    staff &&
    !detail.librarySourced &&
    (detail.status === 'approved' || detail.status === 'not_approved');

  const adopt = (next: BankItemDetail, message: string | null) => {
    const nextForm = formFromDetail(next);
    setDetail(next);
    setForm(nextForm);
    setSaved(JSON.stringify(nextForm));
    setErrors([]);
    setNote(message);
  };
  const run = (call: () => Promise<ApiResult<BankItemDetail>>, message: string | null) => {
    setBusy(true);
    setFailure(null);
    setNote(null);
    void call().then((result) => {
      setBusy(false);
      if (result.ok) adopt(result.data, message);
      else setFailure(result.code);
    });
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const draft = toDraft(form);
    if (!draft.ok) {
      setErrors(draft.errors);
      return;
    }
    run(() => updateBankItem(api, detail.itemId, draft.draft), 'Saved.');
  };

  return (
    <div className={ui.stack}>
      {canEdit ? (
        <form className={ui.stack} onSubmit={save} aria-label="Edit item">
          <p className={ui.note}>{`Draft · Version ${String(detail.versionNo)}`}</p>
          <ItemFormView form={form} errors={errors} formatLocked onChange={setForm} />
          <div className={ui.row}>
            <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy}>
              Save draft
            </button>
            <button
              type="button"
              className={ui.button}
              disabled={busy || dirty}
              onClick={() => {
                run(() => submitBankItemVersion(api, detail.itemVersionId), null);
              }}
            >
              Submit for review
            </button>
          </div>
          {dirty && <p className={ui.note}>Save your changes before submitting.</p>}
        </form>
      ) : (
        <ItemContentView detail={detail} />
      )}
      {canReview && (
        <ReviewPanel
          detail={detail}
          userId={userId}
          busy={busy}
          error={null}
          onDecide={(decision) => {
            run(
              () => reviewBankItemVersion(api, { itemVersionId: detail.itemVersionId, decision }),
              null,
            );
          }}
        />
      )}
      {(canRetire || canNewVersion) && (
        <div className={ui.row}>
          {canNewVersion && (
            <button
              type="button"
              className={ui.button}
              disabled={busy}
              onClick={() => {
                run(() => createBankItemVersion(api, detail.itemId), null);
              }}
            >
              Edit as new version
            </button>
          )}
          {canRetire && (
            <button
              type="button"
              className={ui.button}
              disabled={busy}
              onClick={() => {
                run(() => retireBankItemVersion(api, detail.itemVersionId), null);
              }}
            >
              Retire
            </button>
          )}
        </div>
      )}
      {note !== null && <p role="status">{note}</p>}
      {failure !== null && (
        <p role="alert" className={ui.alert}>
          {bankErrorText(failure)}
        </p>
      )}
    </div>
  );
}

function ItemLoader({ api, itemId }: { api: ApiClient | null; itemId: string }) {
  const info = useOrgInfo();
  const load = useCallback(
    () =>
      api === null
        ? Promise.resolve({ ok: false as const, code: 'unauthorized' })
        : getBankItem(api, itemId),
    [api, itemId],
  );
  const [state] = useResource(load);
  if (state.kind === 'loading') return <p role="status">Loading...</p>;
  if (state.kind === 'error' || api === null || info === null) {
    return (
      <p role="alert" className={ui.alert}>
        {bankErrorText(state.kind === 'error' ? state.code : 'unauthorized')}
      </p>
    );
  }
  return (
    <ItemDetailScreen api={api} initial={state.data} roles={info.roles} userId={info.userId} />
  );
}

export function ItemRoute() {
  const { itemId } = useParams();
  const api = useApi();
  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Item</h2>
      {itemId === undefined ? (
        <CreateItem key="new" api={api} />
      ) : (
        <ItemLoader key={itemId} api={api} itemId={itemId} />
      )}
    </section>
  );
}

export default ItemRoute;
