// Step 3 (rule 9, RT-8): 18 or older, or under 18. Under 18 is blocked whatever the network does: the answer is sent
// (the edge stores only the boolean and answers 403 `not_eligible`), and the app shows the neutral blocked screen
// with no consent and no camera.
import { useState } from 'react';
import { isOffline, type CandidateApi } from '../api';
import { COPY } from '../copy';
import { ErrorSummary, StepHeading, ui } from '../ui';

interface Props {
  api: CandidateApi;
  lobbyToken: string;
  onAdult(): void;
  onBlocked(): void;
  onStepError(): void;
}

export function AgeStep({ api, lobbyToken, onAdult, onBlocked, onStepError }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (adult: boolean) => {
    setBusy(true);
    setError(null);
    const res = await api.age(lobbyToken, adult);
    if (!adult) {
      onBlocked();
      return;
    }
    setBusy(false);
    if (res.ok) return onAdult();
    if (res.code === 'not_eligible') return onBlocked();
    if (res.code === 'step_required' || res.code === 'token_invalid' || res.code === 'superseded')
      return onStepError();
    if (res.code === 'rate_limited') return setError(COPY.rules.wait(res.retryAfterSeconds));
    setError(isOffline(res) ? COPY.error.network : COPY.error.generic);
  };

  return (
    <section>
      <StepHeading>{COPY.age.title}</StepHeading>
      <ErrorSummary message={error} />
      <p className={ui.text}>{COPY.age.question}</p>
      <div className={ui.actions}>
        <button
          type="button"
          className={ui.button}
          onClick={() => void answer(true)}
          disabled={busy}
        >
          {COPY.age.adult}
        </button>
        <button
          type="button"
          className={ui.secondary}
          onClick={() => void answer(false)}
          disabled={busy}
        >
          {COPY.age.minor}
        </button>
      </div>
    </section>
  );
}
