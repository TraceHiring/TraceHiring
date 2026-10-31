// Step 2 (specs/d1-demo-slice.md §4.1): the candidate asks for a code (nothing is sent before), then enters it. The
// code goes to the address on the invitation, which this app never sees. The code is never logged or stored.
import type { LobbyNext } from '@trace/shared/contracts/candidate';
import { useId, useState, type FormEvent } from 'react';
import { isOffline, type ApiFailure, type CandidateApi } from '../api';
import { COPY } from '../copy';
import type { UnavailableWhy } from '../flow';
import { ErrorSummary, Status, StepHeading, ui } from '../ui';

interface Props {
  api: CandidateApi;
  linkToken: string;
  title: string | undefined;
  durationMinutes: number | undefined;
  onVerified(lobbyToken: string, next: LobbyNext): void;
  onBlocked(): void;
  onUnavailable(why: UnavailableWhy): void;
}

const LINK_DEAD: Partial<Record<ApiFailure['code'], UnavailableWhy>> = {
  link_expired: 'expired',
  link_revoked: 'revoked',
  invalid_link: 'invalid',
};

export function OtpStep(props: Props) {
  const { api, linkToken } = props;
  const inputId = useId();
  const hintId = useId();
  const [sent, setSent] = useState<number | null>(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Common refusals of both calls; returns the message to show, or null when the step moved on. */
  const refusal = (f: ApiFailure): string | null => {
    const dead = LINK_DEAD[f.code];
    if (dead !== undefined) {
      props.onUnavailable(dead);
      return null;
    }
    if (f.code === 'not_eligible') {
      props.onBlocked();
      return null;
    }
    if (f.code === 'otp_locked') return COPY.otp.locked(f.retryAfterSeconds);
    if (f.code === 'resend_too_soon') return COPY.otp.tooSoon(f.retryAfterSeconds);
    if (f.code === 'rate_limited') return COPY.rules.wait(f.retryAfterSeconds);
    if (isOffline(f)) return COPY.error.network;
    return COPY.error.generic;
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    const res = await api.otpRequest(linkToken);
    setBusy(false);
    if (res.ok) {
      setSent(res.value.expiresInSeconds);
      return;
    }
    setError(refusal(res));
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    const code = otp.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      setError(COPY.otp.needSixDigits);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api.otpVerify(linkToken, code);
    setBusy(false);
    if (res.ok) {
      props.onVerified(res.value.lobbyToken, res.value.next);
      return;
    }
    if (res.code === 'otp_wrong') {
      setError(COPY.otp.wrong);
      return;
    }
    if (res.code === 'token_expired') {
      setError(COPY.otp.expired);
      return;
    }
    setError(refusal(res));
  };

  return (
    <section>
      <StepHeading>{COPY.otp.title}</StepHeading>
      <p className={ui.text}>{COPY.otp.intro(props.title, props.durationMinutes)}</p>
      <ErrorSummary message={error} />
      <p className={ui.text}>{COPY.otp.explain}</p>
      <Status message={sent === null ? '' : COPY.otp.sent(sent)} />
      {sent === null ? (
        <div className={ui.actions}>
          <button type="button" className={ui.button} onClick={() => void send()} disabled={busy}>
            {COPY.otp.send}
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void verify(e)} noValidate>
          <div className={ui.field}>
            <label htmlFor={inputId} className={ui.label}>
              {COPY.otp.label}
            </label>
            <input
              id={inputId}
              className={ui.input}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
              aria-describedby={hintId}
              aria-invalid={error === COPY.otp.wrong || error === COPY.otp.needSixDigits}
            />
            <span id={hintId} className={ui.muted}>
              {COPY.otp.hint}
            </span>
          </div>
          <div className={ui.actions}>
            <button type="submit" className={ui.button} disabled={busy}>
              {COPY.otp.verify}
            </button>
            <button
              type="button"
              className={ui.secondary}
              onClick={() => void send()}
              disabled={busy}
            >
              {COPY.otp.resend}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
