// The test screen (specs/d1-demo-slice.md §4.4, §4.6, §4.7; RT-1 to RT-5, RT-13): the lazy entry of the test chunk.
// One stream per mount (the view's `streamId`): the outbox sends every edit, choice, signal and heartbeat; the
// signals module listens only while this screen is up. Items are fetched once each and cached. The timer is the
// server's deadline through the server-clock offset (refreshed at every ack); at zero the screen flushes, submits and
// shows the receipt (the DO alarm is the backstop). 410 `closed` reads the receipt through `attach`; 401 `superseded`
// stops with "This test is open in another window". The receipt shows no score or band (rule 5).
import type { Receipt, ServedItem, SessionView } from '@trace/shared/contracts/candidate';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { ApiFailure, CandidateApi } from '../api';
import { COPY } from '../copy';
import { saveSession } from '../session-store';
import { ErrorSummary, Status, StepHeading, ui } from '../ui';
import { AnswerEditor } from './AnswerEditor';
import { remainingMs } from './clock';
import { McqItem } from './McqItem';
import { createOutbox, type EndReason, type Outbox } from './outbox';
import { installSignals, type Signals } from './signals';
import styles from './Test.module.css';
import { Timer } from './Timer';

/** The edge's limit for a written item without its own `maxChars` (§4.4). */
export const DEFAULT_MAX_CHARS = 10_000;
const SUBMIT_RETRY_MS = 5_000;

export type TestEnd = 'superseded' | 'invalid' | 'network';

interface Props {
  api: CandidateApi;
  sessionToken: string;
  view: SessionView;
  offsetMs: number;
  onReceipt(receipt: Receipt): void;
  onEnd(why: TestEnd): void;
}

type Phase = 'working' | 'confirm' | 'submitting' | 'timeup';

const textsOf = (view: SessionView): Record<number, string> =>
  Object.fromEntries(view.answers.flatMap((a) => ('text' in a ? [[a.position, a.text]] : [])));
const choicesOf = (view: SessionView): Record<number, string | null> =>
  Object.fromEntries(view.answers.flatMap((a) => ('choice' in a ? [[a.position, a.choice]] : [])));
const toMap = <V,>(record: Record<number, V>): Map<number, V> =>
  new Map(Object.entries(record).map(([k, v]) => [Number(k), v]));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const leaveFullscreen = () => {
  try {
    if (document.fullscreenElement !== null && typeof document.exitFullscreen === 'function') {
      void document.exitFullscreen().catch(() => undefined);
    }
  } catch {
    // tolerated
  }
};

export function Test({ api, sessionToken, view, offsetMs, onReceipt, onEnd }: Props) {
  const positions = view.items.map((i) => i.position).sort((a, b) => a - b);
  const [current, setCurrent] = useState<number>(positions[0] ?? 1);
  const [texts, setTexts] = useState(() => textsOf(view));
  const [choices, setChoices] = useState(() => choicesOf(view));
  const [items, setItems] = useState<Record<number, ServedItem>>({});
  const [itemFailed, setItemFailed] = useState<number | null>(null);
  const [itemAttempt, setItemAttempt] = useState(0);
  const [clock, setClock] = useState({ deadlineAtMs: Date.parse(view.deadlineAt), offsetMs });
  const [phase, setPhase] = useState<Phase>('working');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null);
  /** Set by the timer at zero; the auto-submit runs from this component, after the outbox exists (SR-2). */
  const [timeUp, setTimeUp] = useState(false);
  const clockRef = useRef(clock);

  const outboxRef = useRef<Outbox | null>(null);
  const signalsRef = useRef<Signals | null>(null);
  const currentRef = useRef<number | null>(positions[0] ?? null);
  const requested = useRef(new Set<number>());
  const alive = useRef(true);
  const finishing = useRef(false);
  const done = useRef(false);

  const finish = (receipt: Receipt) => {
    if (done.current) return;
    done.current = true;
    signalsRef.current?.dispose();
    outboxRef.current?.stop();
    leaveFullscreen();
    onReceipt(receipt);
  };

  /** The session is closed (submitted or past its deadline): read the receipt through attach. */
  const receiptFromAttach = async () => {
    if (done.current) return;
    setPhase('submitting');
    const res = await api.attach(sessionToken);
    if (!alive.current || done.current) return;
    if (res.ok && res.value.view.receipt !== undefined) {
      saveSession({ sessionToken, streamId: res.value.view.streamId, view: res.value.view });
      return finish(res.value.view.receipt);
    }
    if (!res.ok && res.code === 'superseded') return onEnd('superseded');
    onEnd(res.ok ? 'invalid' : 'network');
  };

  const streamEnded = useEffectEvent((reason: EndReason) => {
    if (reason === 'closed') return void receiptFromAttach();
    signalsRef.current?.dispose();
    onEnd(reason === 'superseded' ? 'superseded' : 'invalid');
  });

  // One outbox and one set of signal listeners for this stream; both stop when the screen goes.
  useEffect(() => {
    alive.current = true;
    const outbox = createOutbox({
      api,
      sessionToken,
      streamId: view.streamId,
      heartbeatSeconds: view.heartbeatSeconds,
      texts: toMap(textsOf(view)),
      choices: toMap(choicesOf(view)),
      on: {
        status: (s) => setStatus(s === 'offline' ? COPY.test.offline : COPY.test.backOnline),
        revert: (item, value) => {
          if ('text' in value) setTexts((t) => ({ ...t, [item]: value.text }));
          else setChoices((c) => ({ ...c, [item]: value.choice }));
        },
        ack: (info) => {
          const next = { deadlineAtMs: info.deadlineAtMs, offsetMs: info.offsetMs };
          clockRef.current = next;
          setClock(next);
        },
        end: (reason) => streamEnded(reason),
      },
    });
    const signals = installSignals({
      doc: document,
      currentItem: () => currentRef.current,
      emit: (signal) => outbox.signal(signal),
    });
    outboxRef.current = outbox;
    signalsRef.current = signals;
    const onFullscreen = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      alive.current = false;
      document.removeEventListener('fullscreenchange', onFullscreen);
      signals.dispose();
      outbox.stop();
      outboxRef.current = null;
      signalsRef.current = null;
    };
  }, [api, sessionToken, view]);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const itemRefused = useEffectEvent((res: ApiFailure, position: number) => {
    // SR-3: an item is 410 once the deadline passed, while the session may still run (the grace is for saves). An
    // attach now would open a new stream and supersede this one; submitting ends the session and returns the receipt.
    if (res.code === 'closed') return void submit(true);
    if (res.code === 'superseded') return onEnd('superseded');
    if (res.code === 'token_invalid' || res.code === 'token_expired') return onEnd('invalid');
    if (res.status === 429) {
      setTimeout(() => setItemAttempt((n) => n + 1), (res.retryAfterSeconds ?? 2) * 1000);
      return;
    }
    setItemFailed(position);
  });

  // Each item is fetched once and cached (the edge allows 60 item reads a minute).
  useEffect(() => {
    if (items[current] !== undefined || requested.current.has(current)) return;
    requested.current.add(current);
    const position = current;
    void api.item(sessionToken, position).then((res) => {
      requested.current.delete(position);
      if (!alive.current) return;
      if (res.ok) {
        setItems((m) => ({ ...m, [position]: res.value }));
        setItemFailed((f) => (f === position ? null : f));
        return;
      }
      itemRefused(res, position);
    });
  }, [api, sessionToken, current, items, itemAttempt]);

  const submit = async (automatic: boolean) => {
    if (finishing.current || done.current) return;
    if (outboxRef.current === null) return; // not mounted yet: the caller runs again once it is (SR-2)
    let auto = automatic;
    finishing.current = true;
    setError(null);
    setPhase(auto ? 'timeup' : 'submitting');
    signalsRef.current?.flush();
    for (;;) {
      const outbox = outboxRef.current;
      if (!alive.current || done.current) return;
      if (outbox === null) {
        finishing.current = false;
        return;
      }
      const flushed = await outbox.flush();
      if (!alive.current || done.current) return;
      if (flushed) {
        signalsRef.current?.markSubmitting();
        const res = await api.submit(sessionToken, {
          streamId: view.streamId,
          finalSeq: outbox.ackedSeq(),
        });
        if (!alive.current || done.current) return;
        if (res.ok) return finish(res.value);
        if (res.code === 'closed') return receiptFromAttach();
        if (res.code === 'superseded') return onEnd('superseded');
        if (res.code === 'token_invalid' || res.code === 'token_expired') return onEnd('invalid');
        signalsRef.current?.markSubmitting(false);
        if (res.code === 'out_of_order') continue;
      }
      if (!auto) {
        const { deadlineAtMs, offsetMs: offset } = clockRef.current;
        if (remainingMs(deadlineAtMs, offset, Date.now()) > 0) {
          finishing.current = false;
          setPhase('working');
          setError(COPY.test.submitOffline);
          return;
        }
        // SR-8: time ran out while this manual submit was in flight: keep the answers locked and keep trying.
        auto = true;
        setPhase('timeup');
      }
      await sleep(SUBMIT_RETRY_MS);
    }
  };

  // SR-2: the auto-submit runs here, after this component's own effects created the outbox (a child's effect runs
  // before its parent's, so the timer must not submit directly).
  const autoSubmit = useEffectEvent(() => void submit(true));
  useEffect(() => {
    if (timeUp) autoSubmit();
  }, [timeUp]);

  const index = positions.indexOf(current);
  const item = items[current];
  const locked = phase === 'submitting' || phase === 'timeup';
  const answered = (p: number) => (texts[p] ?? '') !== '' || (choices[p] ?? null) !== null;

  const onText = (next: string) => {
    if (item === undefined || item.kind !== 'written' || locked) return;
    const max = item.maxChars ?? DEFAULT_MAX_CHARS;
    if (outboxRef.current?.text(current, next, max) === true) {
      setTexts((t) => ({ ...t, [current]: next }));
    }
  };

  const onChoose = (option: string | null) => {
    if (locked || outboxRef.current === null) return;
    outboxRef.current.choice(current, option);
    setChoices((c) => ({ ...c, [current]: option }));
  };

  const go = (position: number | undefined) => {
    if (position !== undefined) setCurrent(position);
  };

  const backToFullscreen = () => {
    try {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    } catch {
      // tolerated
    }
  };

  const statusLine =
    phase === 'timeup' ? COPY.test.timeUp : phase === 'submitting' ? COPY.test.submitting : status;

  return (
    <section className={styles.test}>
      <div className={styles.bar}>
        <StepHeading>{view.title}</StepHeading>
        <Timer
          deadlineAtMs={clock.deadlineAtMs}
          offsetMs={clock.offsetMs}
          onExpire={() => setTimeUp(true)}
        />
      </div>
      <Status message={statusLine} />
      <ErrorSummary message={error} />
      {!fullscreen && typeof document.documentElement.requestFullscreen === 'function' ? (
        <div className={ui.actions}>
          <button type="button" className={ui.secondary} onClick={backToFullscreen}>
            {COPY.test.fullscreen}
          </button>
        </div>
      ) : null}

      <nav aria-label={COPY.test.questions}>
        <ol className={styles.nav}>
          {positions.map((p, k) => (
            <li key={p}>
              <button
                type="button"
                className={styles.navButton}
                aria-current={p === current ? 'step' : undefined}
                data-answered={answered(p) ? 'yes' : 'no'}
                onClick={() => go(p)}
              >
                <span className={ui.srOnly}>{COPY.test.question(k + 1, positions.length)}</span>
                <span aria-hidden="true">{k + 1}</span>
                {answered(p) ? (
                  <span className={ui.srOnly}>{`, ${COPY.test.answered}`}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className={styles.item}>
        <h2 className={ui.h2}>{COPY.test.question(index + 1, positions.length)}</h2>
        {item === undefined ? (
          itemFailed === current ? (
            <>
              <ErrorSummary message={COPY.test.itemFailed} />
              <button
                type="button"
                className={ui.secondary}
                onClick={() => {
                  setItemFailed(null);
                  setItemAttempt((n) => n + 1);
                }}
              >
                {COPY.test.retry}
              </button>
            </>
          ) : (
            <p className={ui.text}>{COPY.test.loadingItem}</p>
          )
        ) : (
          <>
            <p className={styles.prompt}>{item.prompt}</p>
            {item.kind === 'mcq' ? (
              <McqItem
                position={item.position}
                options={item.options ?? []}
                choice={choices[current] ?? null}
                disabled={locked}
                onChoose={onChoose}
              />
            ) : (
              <AnswerEditor
                value={texts[current] ?? ''}
                maxChars={item.maxChars ?? DEFAULT_MAX_CHARS}
                disabled={locked}
                onChange={onText}
              />
            )}
          </>
        )}
        <div className={ui.actions}>
          <button
            type="button"
            className={ui.secondary}
            onClick={() => go(positions[index - 1])}
            disabled={index <= 0}
          >
            {COPY.test.previous}
          </button>
          <button
            type="button"
            className={ui.secondary}
            onClick={() => go(positions[index + 1])}
            disabled={index >= positions.length - 1}
          >
            {COPY.test.next}
          </button>
        </div>
      </div>

      <div className={styles.submitArea}>
        {phase === 'confirm' ? (
          <div className={styles.confirm}>
            <h2 className={ui.h2}>{COPY.test.confirmTitle}</h2>
            <p className={ui.text}>{COPY.test.confirmBody}</p>
            <div className={ui.actions}>
              <button type="button" className={ui.button} onClick={() => void submit(false)}>
                {COPY.test.confirm}
              </button>
              <button type="button" className={ui.secondary} onClick={() => setPhase('working')}>
                {COPY.test.keepWorking}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={ui.button}
            onClick={() => setPhase('confirm')}
            disabled={locked}
          >
            {COPY.test.submit}
          </button>
        )}
      </div>
    </section>
  );
}

export default Test;
