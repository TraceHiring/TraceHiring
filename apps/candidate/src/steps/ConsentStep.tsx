// Step 4 (specs/d1-demo-slice.md §4.1, Q36): the notice exactly as the server rendered it (its text is hashed
// there), then the candidate agrees. The camera may not be asked for until this call answered success; the photo step
// (and its camera module) is loaded only after it.
import type { NoticeRes } from '@trace/shared/contracts/candidate';
import { useEffect, useEffectEvent, useId, useState } from 'react';
import { isOffline, type CandidateApi } from '../api';
import { COPY } from '../copy';
import { ErrorSummary, StepHeading, ui } from '../ui';

interface Props {
  api: CandidateApi;
  lobbyToken: string;
  onConsented(): void;
  onStepError(): void;
}

export function ConsentStep({ api, lobbyToken, onConsented, onStepError }: Props) {
  const checkId = useId();
  const [notice, setNotice] = useState<NoticeRes | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stepError = useEffectEvent(() => onStepError());

  useEffect(() => {
    let live = true;
    void api.notice(lobbyToken).then((res) => {
      if (!live) return;
      if (res.ok) {
        setNotice(res.value);
        setError(null);
      } else if (res.code === 'step_required' || res.code === 'superseded') {
        stepError();
      } else {
        setError(isOffline(res) ? COPY.error.network : COPY.error.generic);
      }
    });
    return () => {
      live = false;
    };
  }, [api, lobbyToken, attempt]);

  const agree = async () => {
    if (notice === null) return;
    if (!agreed) {
      setError(COPY.consent.mustAgree);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api.consent(lobbyToken, {
      noticeVersionId: notice.noticeVersionId,
      renderedSha256: notice.renderedSha256,
      accepted: true,
    });
    setBusy(false);
    if (res.ok) return onConsented();
    if (res.code === 'step_required' || res.code === 'superseded') return onStepError();
    if (res.code === 'rate_limited') return setError(COPY.rules.wait(res.retryAfterSeconds));
    setError(isOffline(res) ? COPY.error.network : COPY.error.generic);
  };

  return (
    <section>
      <StepHeading>{COPY.consent.title}</StepHeading>
      <p className={ui.text}>{COPY.consent.intro}</p>
      <ErrorSummary message={error} />
      {notice === null ? (
        <>
          <p className={ui.text}>{COPY.loading}</p>
          {error === null ? null : (
            <div className={ui.actions}>
              <button type="button" className={ui.button} onClick={() => setAttempt((n) => n + 1)}>
                {COPY.error.retry}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={ui.notice} data-testid="notice-text">
            {notice.bodyText}
          </div>
          <div className={ui.check}>
            <input
              id={checkId}
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            <label htmlFor={checkId}>{COPY.consent.agreeLabel}</label>
          </div>
          <div className={ui.actions}>
            <button
              type="button"
              className={ui.button}
              onClick={() => void agree()}
              disabled={busy}
            >
              {COPY.consent.agree}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
