// The candidate app (specs/d1-demo-slice.md §4.1, §4.7): a useReducer step machine from the link to the receipt.
// No router, no camera before consent (the photo step and its camera module are a lazy chunk loaded only after the
// consent call succeeded), no third-party telemetry and no error reporting (rule 8, build-notes Q17). A stored
// session token is attached once on load (a reload restores answers and the timer, AT-D36); the guard keeps a React
// StrictMode double effect from attaching twice (two attaches would supersede each other).
import type { Receipt, SessionView } from '@trace/shared/contracts/candidate';
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { createApi, isOffline } from './api';
import styles from './App.module.css';
import { EMPTY_BOOT, type Boot } from './boot';
import { COPY } from './copy';
import { initialState, offsetOf, reducer, type UnavailableWhy } from './flow';
import { log } from './log';
import { clearSession, saveSession } from './session-store';
import { AgeStep } from './steps/AgeStep';
import { ConsentStep } from './steps/ConsentStep';
import { BlockedStep, ErrorStep, ResolvingStep, UnavailableStep } from './steps/Message';
import { OtpStep } from './steps/OtpStep';
import { RulesStep } from './steps/RulesStep';
import { SubmittedStep } from './steps/SubmittedStep';
import type { TestEnd } from './test/Test';
import { ui } from './ui';
import { APP_VERSION } from './version';

export const PRODUCT_NAME = COPY.product;

/** The wait after a link-route 429 without a usable Retry-After: the edge limiter's 10 s period. */
const RATE_LIMIT_WAIT_SECONDS = 10;
/** The longest wait honoured, so a proxy's large Retry-After cannot keep "Try again" disabled for long. */
const RATE_LIMIT_MAX_WAIT_SECONDS = 60;

const PhotoStep = lazy(() => import('./photo/PhotoStep'));
const Test = lazy(() => import('./test/Test'));

export function App({ boot = EMPTY_BOOT }: { boot?: Boot }) {
  const [state, dispatch] = useReducer(reducer, boot, initialState);
  const api = useMemo(() => (boot.origin === null ? null : createApi(boot.origin)), [boot.origin]);
  const started = useRef(false);
  const { step, lobbyToken } = state;

  /** From the link (or a stored session) to the first interactive step. */
  const kickoff = useCallback(async () => {
    if (api === null) return;
    if (boot.stored !== null) {
      const sentAt = Date.now();
      const res = await api.attach(boot.stored.sessionToken);
      const receivedAt = Date.now();
      if (res.ok) {
        const { view } = res.value;
        saveSession({ sessionToken: boot.stored.sessionToken, streamId: view.streamId, view });
        return dispatch({
          type: 'session',
          sessionToken: boot.stored.sessionToken,
          view,
          offsetMs: offsetOf(view.serverNow, sentAt, receivedAt),
        });
      }
      log.info('candidate.attach_refused', { status: res.status });
      if (res.code === 'superseded') return dispatch({ type: 'error', why: 'superseded' });
      if (isOffline(res) || res.status === 429)
        return dispatch({ type: 'error', why: 'network', retry: true });
      // The stored token no longer works (expired or invalid): forget it and use the link, if any.
      clearSession();
    }
    if (boot.linkToken === null) {
      return dispatch({ type: 'unavailable', why: boot.badLink ? 'invalid' : 'no_link' });
    }
    const res = await api.resolve(boot.linkToken);
    if (res.ok) return dispatch({ type: 'resolved', res: res.value });
    if (res.code === 'invalid_link' || res.code === 'bad_request')
      return dispatch({ type: 'unavailable', why: 'invalid' });
    // The edge's coarse link limit (OPEN-13): wait for Retry-After (10 s when missing, at most 60 s) before "Try again".
    if (res.code === 'rate_limited') {
      const wait = res.retryAfterSeconds;
      return dispatch({
        type: 'error',
        why: 'rate_limited',
        retry: true,
        waitSeconds:
          wait !== undefined && wait >= 1
            ? Math.min(wait, RATE_LIMIT_MAX_WAIT_SECONDS)
            : RATE_LIMIT_WAIT_SECONDS,
      });
    }
    dispatch({ type: 'error', why: isOffline(res) ? 'network' : 'generic', retry: true });
  }, [api, boot]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void kickoff();
  }, [kickoff]);

  const retry = useCallback(() => {
    dispatch({ type: 'resolving' });
    void kickoff();
  }, [kickoff]);

  const toUnavailable = useCallback(
    (why: UnavailableWhy) => dispatch({ type: 'unavailable', why }),
    [],
  );
  const toBlocked = useCallback(() => dispatch({ type: 'blocked' }), []);
  const toStepError = useCallback(() => dispatch({ type: 'error', why: 'step' }), []);
  const toReceipt = useCallback((receipt: Receipt) => dispatch({ type: 'receipt', receipt }), []);
  const toSession = useCallback(
    (sessionToken: string, view: SessionView, offsetMs: number) =>
      dispatch({ type: 'session', sessionToken, view, offsetMs }),
    [],
  );
  const testEnded = useCallback((why: TestEnd) => {
    if (why === 'invalid') clearSession();
    dispatch({ type: 'error', why });
  }, []);

  useEffect(() => {
    log.info('candidate.step', { step: step.name });
  }, [step.name]);

  const body = (() => {
    if (api === null) return <UnavailableStep why="config" />;
    switch (step.name) {
      case 'resolving':
        return <ResolvingStep />;
      case 'unavailable':
        return <UnavailableStep why={step.why} />;
      case 'blocked':
        return <BlockedStep />;
      case 'error':
        return (
          <ErrorStep
            why={step.why}
            onRetry={step.retry ? retry : null}
            waitSeconds={step.waitSeconds}
          />
        );
      case 'submitted':
        return <SubmittedStep receipt={step.receipt} />;
      case 'otp':
        return boot.linkToken === null ? (
          <UnavailableStep why="no_link" />
        ) : (
          <OtpStep
            api={api}
            linkToken={boot.linkToken}
            title={step.title}
            durationMinutes={step.durationMinutes}
            onVerified={(token, next) => dispatch({ type: 'lobby', lobbyToken: token, next })}
            onBlocked={toBlocked}
            onUnavailable={toUnavailable}
          />
        );
      case 'test':
        return (
          <Suspense fallback={<p className={ui.text}>{COPY.loading}</p>}>
            <Test
              api={api}
              sessionToken={step.sessionToken}
              view={step.view}
              offsetMs={step.offsetMs}
              onReceipt={toReceipt}
              onEnd={testEnded}
            />
          </Suspense>
        );
      default:
        break;
    }
    // The lobby steps need the lobby token (memory only); without it, the link starts over.
    if (lobbyToken === null) return <ErrorStep why="step" onRetry={null} />;
    switch (step.name) {
      case 'age':
        return (
          <AgeStep
            api={api}
            lobbyToken={lobbyToken}
            onAdult={() => dispatch({ type: 'adult' })}
            onBlocked={toBlocked}
            onStepError={toStepError}
          />
        );
      case 'consent':
        return (
          <ConsentStep
            api={api}
            lobbyToken={lobbyToken}
            onConsented={() => dispatch({ type: 'consented' })}
            onStepError={toStepError}
          />
        );
      case 'photo':
        return (
          <Suspense fallback={<p className={ui.text}>{COPY.loading}</p>}>
            <PhotoStep
              api={api}
              lobbyToken={lobbyToken}
              onDone={(photo) => dispatch({ type: 'photo', photo })}
              onStepError={toStepError}
            />
          </Suspense>
        );
      case 'rules':
        return (
          <RulesStep
            api={api}
            lobbyToken={lobbyToken}
            photo={step.photo}
            onSession={toSession}
            onReceipt={toReceipt}
            onBlocked={toBlocked}
            onUnavailable={toUnavailable}
            onStepError={toStepError}
          />
        );
    }
  })();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <p className={styles.brand}>{PRODUCT_NAME}</p>
      </header>
      <main className={styles.page}>{body}</main>
      <footer className={styles.footer}>
        <p className={styles.version}>{COPY.version(APP_VERSION)}</p>
      </footer>
    </div>
  );
}
