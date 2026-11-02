// Step 6 (specs/d1-demo-slice.md §4.1): the rules, then "Start test", which asks for fullscreen (inside the click,
// tolerated silently if refused, RT-14) and calls `session/start` with the photo choice. The DO stamps the start time;
// the session token, stream id and a view snapshot go to sessionStorage for a reload.
import type { Receipt, SessionView } from '@trace/shared/contracts/candidate';
import { useId, useState } from 'react';
import { isOffline, type CandidateApi } from '../api';
import { COPY } from '../copy';
import { offsetOf, type PhotoChoice, type UnavailableWhy } from '../flow';
import { saveSession } from '../session-store';
import { ErrorSummary, StepHeading, ui } from '../ui';

interface Props {
  api: CandidateApi;
  lobbyToken: string;
  photo: PhotoChoice;
  onSession(sessionToken: string, view: SessionView, offsetMs: number): void;
  onReceipt(receipt: Receipt): void;
  onBlocked(): void;
  onUnavailable(why: UnavailableWhy): void;
  onStepError(): void;
}

/** Fullscreen is asked for, never required (RT-14): a refusal or a missing API changes nothing. */
const askFullscreen = () => {
  try {
    const el = document.documentElement;
    if (document.fullscreenElement === null && typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen().catch(() => undefined);
    }
  } catch {
    // tolerated
  }
};

export function RulesStep(props: Props) {
  const { api, lobbyToken, photo } = props;
  const checkId = useId();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!ack) {
      setError(COPY.rules.mustAck);
      return;
    }
    askFullscreen();
    setBusy(true);
    setError(null);
    const sentAt = Date.now();
    const res = await api.start(lobbyToken, { rulesAcknowledged: true, photo });
    const receivedAt = Date.now();
    setBusy(false);
    if (res.ok) {
      const value = res.value;
      if ('receipt' in value) return props.onReceipt(value.receipt);
      saveSession({
        sessionToken: value.sessionToken,
        streamId: value.view.streamId,
        view: value.view,
      });
      return props.onSession(
        value.sessionToken,
        value.view,
        offsetOf(value.view.serverNow, sentAt, receivedAt),
      );
    }
    if (res.code === 'not_eligible') return props.onBlocked();
    if (res.code === 'closed') return props.onUnavailable('closed');
    if (res.code === 'link_expired') return props.onUnavailable('expired');
    if (res.code === 'link_revoked') return props.onUnavailable('revoked');
    if (
      res.code === 'step_required' ||
      res.code === 'superseded' ||
      res.code === 'token_invalid' ||
      res.code === 'token_expired'
    )
      return props.onStepError();
    if (res.status === 429) return setError(COPY.rules.wait(res.retryAfterSeconds));
    setError(isOffline(res) ? COPY.error.network : COPY.error.generic);
  };

  return (
    <section>
      <StepHeading>{COPY.rules.title}</StepHeading>
      <p className={ui.text}>{COPY.rules.intro}</p>
      <ErrorSummary message={error} />
      <ul className={ui.list}>
        {COPY.rules.items.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
      <div className={ui.check}>
        <input
          id={checkId}
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        <label htmlFor={checkId}>{COPY.rules.ackLabel}</label>
      </div>
      <div className={ui.actions}>
        <button type="button" className={ui.button} onClick={() => void start()} disabled={busy}>
          {COPY.rules.start}
        </button>
      </div>
    </section>
  );
}
