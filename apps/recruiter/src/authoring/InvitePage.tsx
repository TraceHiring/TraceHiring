// Invite a candidate (specs/d1-demo-slice.md §6.1, rule 9, D1-1, D1-12). The contact is a synthetic
// `...@example.test` address; the inviter's age answer is Yes / No / Not sure (default none, which is "unknown").
// The api returns the invite link once: it is held in this screen's memory only (never stored) and shown with Copy.
// "No" blocks the invitation: the label and "Blocked: under 18", and no link.
import { CreateInvitationRequest, type CreateInvitationResponse } from '@trace/shared/contracts/d1';
import { useCallback, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import type { ApiClient, ApiResult } from '../api/client';
import { createInvitation, listInvitations } from '../api/endpoints';
import { useApi } from '../api/runtime';
import { formatTime } from '../common/format';
import { errorText } from '../common/messages';
import { useResource } from '../common/useResource';
import ui from '../common/Ui.module.css';

export type AgeAnswer = 'yes' | 'no' | 'unsure' | '';

export const ageToRequest = (answer: AgeAnswer): boolean | null =>
  answer === 'yes' ? true : answer === 'no' ? false : null;

export async function submitInvitation(
  api: ApiClient,
  testId: string,
  input: { email: string; age: AgeAnswer },
): Promise<ApiResult<CreateInvitationResponse>> {
  const request = CreateInvitationRequest.safeParse({
    contactEmail: input.email.trim(),
    adultConfirmedByInviter: ageToRequest(input.age),
  });
  if (!request.success) return { ok: false, code: 'invalid_email' };
  return createInvitation(api, testId, request.data);
}

const INVITE_ERRORS: Readonly<Record<string, string>> = {
  invalid_email: 'Use an email address that ends in @example.test.',
};
const inviteErrorText = (code: string): string => INVITE_ERRORS[code] ?? errorText(code);

export function InviteFormView({
  busy,
  error,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onSubmit(input: { email: string; age: AgeAnswer }): void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = data.get('contactEmail');
    const age = data.get('age');
    onSubmit({
      email: typeof email === 'string' ? email : '',
      age: age === 'yes' || age === 'no' || age === 'unsure' ? age : '',
    });
  };
  return (
    <form className={ui.form} onSubmit={submit}>
      <label className={ui.field}>
        <span className={ui.label}>Contact email</span>
        <input
          className={ui.input}
          name="contactEmail"
          type="email"
          autoComplete="off"
          maxLength={80}
          required
          aria-describedby="invite-email-help"
        />
        <span id="invite-email-help" className={ui.note}>
          Demo only: use an address that ends in @example.test.
        </span>
      </label>
      <fieldset className={ui.fieldset}>
        <legend className={ui.label}>This candidate is 18 or older</legend>
        <label className={ui.choice}>
          <input type="radio" name="age" value="yes" />
          <span>Yes</span>
        </label>
        <label className={ui.choice}>
          <input type="radio" name="age" value="no" />
          <span>No</span>
        </label>
        <label className={ui.choice}>
          <input type="radio" name="age" value="unsure" />
          <span>Not sure</span>
        </label>
      </fieldset>
      {error !== null && (
        <p role="alert" className={ui.alert}>
          {inviteErrorText(error)}
        </p>
      )}
      <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy}>
        Create invitation
      </button>
    </form>
  );
}

export function InviteResultView({
  result,
  onCopy,
  onAnother,
}: {
  result: CreateInvitationResponse;
  onCopy(): void;
  onAnother(): void;
}) {
  return (
    <section className={ui.panel} aria-label="Invitation created">
      <h3 className={ui.subtitle}>{result.label}</h3>
      {result.inviteUrl === null ? (
        <p role="status">Blocked: under 18</p>
      ) : (
        <>
          <p className={ui.note}>
            The invite link is shown only once. Copy it now; Trace stores only a hash of it.
          </p>
          <p className={ui.mono}>{result.inviteUrl}</p>
          <button type="button" className={ui.button} onClick={onCopy}>
            Copy link
          </button>
        </>
      )}
      <p>
        <button type="button" className={ui.button} onClick={onAnother}>
          Invite another candidate
        </button>
      </p>
    </section>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route `/tests/:testId/invite`. */
export function InviteRoute() {
  const { testId } = useParams();
  const api = useApi();
  const valid = testId !== undefined && UUID.test(testId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateInvitationResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(
    () =>
      api !== null && valid
        ? listInvitations(api, testId)
        : Promise.resolve({ ok: false as const, code: 'not_found' }),
    [api, testId, valid],
  );
  const [list, reload] = useResource(load);

  if (api === null || !valid) return <p role="alert">Test not found.</p>;

  const submit = async (input: { email: string; age: AgeAnswer }) => {
    setBusy(true);
    setError(null);
    const res = await submitInvitation(api, testId, input);
    setBusy(false);
    if (res.ok) {
      setResult(res.data);
      setCopied(false);
      reload();
    } else {
      setError(res.code);
    }
  };
  const copy = () => {
    const url = result?.inviteUrl;
    if (url === null || url === undefined) return;
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
      },
      () => {
        setCopied(false);
      },
    );
  };

  return (
    <section className={ui.stack}>
      <h2 className={ui.title}>Invite a candidate</h2>
      {result === null ? (
        <InviteFormView
          busy={busy}
          error={error}
          onSubmit={(input) => {
            void submit(input);
          }}
        />
      ) : (
        <InviteResultView
          result={result}
          onCopy={copy}
          onAnother={() => {
            setResult(null);
          }}
        />
      )}
      {copied && <p role="status">Link copied.</p>}
      <h3 className={ui.subtitle}>Invitations</h3>
      {list.kind === 'ready' &&
        (list.data.invitations.length === 0 ? (
          <p>No invitations yet.</p>
        ) : (
          <table className={ui.table}>
            <thead>
              <tr>
                <th scope="col">Candidate</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {list.data.invitations.map((inv) => (
                <tr key={inv.id}>
                  <th scope="row">{inv.label}</th>
                  <td>{inv.status === 'blocked_age' ? 'Blocked: under 18' : inv.status}</td>
                  <td>{formatTime(inv.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      {list.kind === 'error' && (
        <p role="alert" className={ui.alert}>
          {errorText(list.code)}
        </p>
      )}
    </section>
  );
}
