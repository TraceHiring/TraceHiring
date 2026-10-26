// The test screen (specs/d1-demo-slice.md §4.4, §4.6, §4.7; RT-1 to RT-5, RT-13): the lazy entry of the test chunk.
// One stream at a time (the view's `streamId`): the outbox sends every edit, choice, signal and heartbeat; the
// signals module listens only while this screen is up. Items are fetched once each and cached. The timer is the
// server's deadline through the server-clock offset (refreshed at every ack); at zero the screen flushes, submits and
// shows the receipt (the DO alarm is the backstop). 410 `closed` reads the receipt through `attach`; 401 `superseded`
// stops with "This test is open in another window". The receipt shows no score or band (rule 5).
// M1 (package v2, R5-9, R5-20, R5-24, R5-45, R5-59, R5-66): sections with server states and deadlines, a section
// bar with its own timer and rules, forward-only navigation without "Previous", `afterSeq` on every item GET with the
// 409 flush-and-retry, closed sections read-only, and the section transition (useSectionTransition) that moves the
// screen to a new stream. A v1 view keeps the D1 screen: no section bar, no `afterSeq`, paste always prevented.
import type { Receipt } from '@trace/shared/contracts/candidate';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { isV2, type AnyItem, type AnyView, type ApiFailure, type CandidateApi } from '../api';
import { COPY } from '../copy';
import { saveSession } from '../session-store';
import { ErrorSummary, Status, StepHeading, ui } from '../ui';
import { remainingMs } from './clock';
import { DEFAULT_MAX_CHARS, ItemPane, type Missing } from './ItemPane';
import { createOutbox, type EndReason, type Held, type Outbox } from './outbox';
import { SectionBar } from './SectionBar';
import {
  canOpen,
  highestServed,
  isEditable,
  layoutOf,
  mayRequest,
  nextSectionDeadline,
  positionAfter,
  servedOf,
} from './sections';
import { installSignals, type Signals } from './signals';
import styles from './Test.module.css';
import { Timer } from './Timer';
import { useSectionTransition } from './useSectionTransition';

export { DEFAULT_MAX_CHARS };
const SUBMIT_RETRY_MS = 5_000;
/** A section deadline is acted on this long after it passes on the server clock (the DO's reads close at once). */
const SECTION_DEADLINE_SLACK_MS = 250;
/** Item GETs per position after a 409 `out_of_order` (each after a successful flush). */
const ITEM_TRIES = 3;

export type TestEnd = 'superseded' | 'invalid' | 'network';

interface Props {
  api: CandidateApi;
  sessionToken: string;
  view: AnyView;
  offsetMs: number;
  onReceipt(receipt: Receipt): void;
  onEnd(why: TestEnd): void;
}

type Phase = 'working' | 'confirm' | 'submitting' | 'timeup';

const textsOf = (view: AnyView): Record<number, string> =>
  Object.fromEntries(view.answers.flatMap((a) => ('text' in a ? [[a.position, a.text]] : [])));
const choicesOf = (view: AnyView): Record<number, string | null> =>
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

const startPosition = (view: AnyView): number => {
  const layout = layoutOf(view);
  if (!layout.v2) return layout.positions[0] ?? 1;
  return positionAfter(layout, null, servedOf(view, []));
};

export function Test({ api, sessionToken, view: initialView, offsetMs, onReceipt, onEnd }: Props) {
  const [view, setView] = useState(initialView);
  const [current, setCurrent] = useState<number>(() => startPosition(initialView));
  const [texts, setTexts] = useState(() => textsOf(initialView));
  const [choices, setChoices] = useState(() => choicesOf(initialView));
  const [items, setItems] = useState<Record<number, AnyItem>>({});
  const [itemFailed, setItemFailed] = useState<number | null>(null);
  const [itemAttempt, setItemAttempt] = useState(0);
  const [clock, setClock] = useState({
    deadlineAtMs: Date.parse(initialView.deadlineAt),
    offsetMs,
  });
  const [phase, setPhase] = useState<Phase>('working');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(() => document.fullscreenElement !== null);
  /** Set by the timer at zero; the auto-submit runs from this component, after the outbox exists (SR-2). */
  const [timeUp, setTimeUp] = useState(false);
  /** Sections this screen treats as closed until the next view arrives (deadline passed, finished, 410). */
  const [closedHere, setClosedHere] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmFinish, setConfirmFinish] = useState(false);
  const clockRef = useRef(clock);

  const outboxRef = useRef<Outbox | null>(null);
  const signalsRef = useRef<Signals | null>(null);
  /**
   * Signals raised while no stream is open (between two streams), and what a stopped stream handed over (R5-68 b):
   * sent first on the next one, each with the `t` of the moment it was raised.
   */
  const waitingSignals = useRef<Held[]>([]);
  /** The monotonic origin of every stream's `t` on this screen, so a held event keeps its `t` (R5-68 b). */
  const originMono = useRef<number | null>(null);
  const currentRef = useRef<number | null>(current);
  const pasteAllowedRef = useRef(false);
  const requested = useRef(new Set<number>());
  const alive = useRef(true);
  const finishing = useRef(false);
  const done = useRef(false);
  const streamOver = useRef(false);

  const v2 = isV2(view);
  const layout = useMemo(() => layoutOf(view, closedHere), [view, closedHere]);
  const served = useMemo(() => servedOf(view, Object.keys(items).map(Number)), [view, items]);
  const section = layout.sectionOf.get(current);

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
    streamOver.current = true;
    if (reason === 'closed') return void receiptFromAttach();
    signalsRef.current?.dispose();
    onEnd(reason === 'superseded' ? 'superseded' : 'invalid');
  });

  /** A new view on a new stream (R5-66 b): the server's answers, states and deadlines replace the screen's. */
  const applyView = (next: AnyView, nextOffsetMs: number) => {
    const nextClock = { deadlineAtMs: Date.parse(next.deadlineAt), offsetMs: nextOffsetMs };
    clockRef.current = nextClock;
    setClock(nextClock);
    setTexts(textsOf(next));
    setChoices(choicesOf(next));
    setClosedHere(new Set());
    setConfirmFinish(false);
    setItemFailed(null);
    setView(next);
    setCurrent((c) =>
      positionAfter(layoutOf(next), c, servedOf(next, Object.keys(items).map(Number))),
    );
  };

  const { moving, transition } = useSectionTransition({
    api,
    sessionToken,
    outboxRef,
    mayRun: () => alive.current && !done.current && !finishing.current && !streamOver.current,
    apply: applyView,
    receipt: finish,
    hold: (held) => {
      waitingSignals.current = [...held, ...waitingSignals.current];
    },
    end: (why) => onEnd(why),
  });

  /** Treats a section as closed now and moves the screen on (deadline, finish, 410 `section_closed`). */
  const closeHere = (sectionId: string) => {
    setClosedHere((s) => new Set(s).add(sectionId));
    void transition();
  };
  const closeAndMove = useEffectEvent((sectionId: string) => closeHere(sectionId));

  // The signal listeners live as long as the screen; between two streams their signals wait (R5-66 b).
  useEffect(() => {
    const signals = installSignals({
      doc: document,
      currentItem: () => currentRef.current,
      pasteAllowed: () => pasteAllowedRef.current,
      emit: (signal) => {
        const outbox = outboxRef.current;
        if (outbox === null) {
          waitingSignals.current.push({ kind: 'signal', signal, raisedAt: performance.now() });
        } else outbox.signal(signal);
      },
    });
    signalsRef.current = signals;
    const onFullscreen = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen);
      signals.dispose();
      signalsRef.current = null;
    };
  }, []);

  // One outbox per stream; a new view (after attach) brings a new stream.
  useEffect(() => {
    alive.current = true;
    streamOver.current = false;
    originMono.current ??= performance.now();
    const outbox = createOutbox({
      api,
      sessionToken,
      streamId: view.streamId,
      heartbeatSeconds: view.heartbeatSeconds,
      originMono: originMono.current,
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
    outbox.hold(waitingSignals.current.splice(0));
    outboxRef.current = outbox;
    return () => {
      alive.current = false;
      outbox.stop();
      if (outboxRef.current === outbox) outboxRef.current = null;
    };
  }, [api, sessionToken, view]);

  useEffect(() => {
    currentRef.current = current;
    pasteAllowedRef.current =
      v2 && section?.state === 'open' && section.pasteRule === 'allowed_logged';
  }, [current, v2, section]);

  // A section deadline passing on the server-offset clock closes it here and moves on (the client clock never
  // decides a state: the next view does).
  useEffect(() => {
    const deadline = nextSectionDeadline(layout);
    if (deadline === null) return;
    const wait = Math.max(0, deadline - (Date.now() + clock.offsetMs)) + SECTION_DEADLINE_SLACK_MS;
    const timer = setTimeout(() => {
      const ended = layout.sections.find((s) => s.state === 'open' && s.deadlineAtMs === deadline);
      if (ended !== undefined) closeAndMove(ended.id);
    }, wait);
    return () => clearTimeout(timer);
  }, [layout, clock.offsetMs]);

  const itemRefused = useEffectEvent((res: ApiFailure, position: number) => {
    // SR-3: an item is 410 once the deadline passed, while the session may still run (the grace is for saves). An
    // attach now would open a new stream and supersede this one; submitting ends the session and returns the receipt.
    if (res.code === 'closed') return void submit(true);
    if (res.code === 'superseded') return onEnd('superseded');
    if (res.code === 'token_invalid' || res.code === 'token_expired') return onEnd('invalid');
    // R5-20: the section closed (or the position was passed): move on, never retry this GET.
    const owner = layout.sectionOf.get(position);
    if (res.code === 'section_closed' && owner !== undefined) return closeAndMove(owner.id);
    if (res.status === 429) {
      setTimeout(() => setItemAttempt((n) => n + 1), (res.retryAfterSeconds ?? 2) * 1000);
      return;
    }
    setItemFailed(position);
  });

  /** v2 (R5-45, R5-59 d): `afterSeq` is the highest enqueued seq; on 409 flush, then ask again. */
  const fetchItem = async (position: number) => {
    const outbox = outboxRef.current;
    if (!v2) return api.item(sessionToken, position);
    if (outbox === null) return null;
    let afterSeq = outbox.enqueuedSeq();
    for (let attempt = 1; ; attempt += 1) {
      const res = await api.item(sessionToken, position, afterSeq);
      if (res.ok || res.code !== 'out_of_order' || attempt >= ITEM_TRIES) return res;
      if (!(await outbox.flush())) return res;
      // Everything enqueued before the first GET is acknowledged now.
      afterSeq = outbox.ackedSeq();
    }
  };

  const loadItem = useEffectEvent((position: number) => {
    requested.current.add(position);
    void fetchItem(position).then((res) => {
      requested.current.delete(position);
      if (!alive.current || res === null) return;
      if (res.ok) {
        setItems((m) => ({ ...m, [position]: res.value }));
        setItemFailed((f) => (f === position ? null : f));
        return;
      }
      itemRefused(res, position);
    });
  });

  // Each item is fetched once and cached (the edge allows 60 item reads a minute). A v2 item is requested only in an
  // open section, at a position the DO would serve (never a not_entered or closed section, R5-66 b).
  useEffect(() => {
    if (moving || items[current] !== undefined || requested.current.has(current)) return;
    if (v2 && !mayRequest(layout, current, served)) return;
    loadItem(current);
  }, [current, items, itemAttempt, moving, layout, served, v2]);

  const submit = async (automatic: boolean) => {
    if (finishing.current || done.current) return;
    if (outboxRef.current === null) return; // no stream yet: the caller runs again once it is (SR-2)
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
  // before its parent's, so the timer must not submit directly). A new stream (after a transition) runs it again.
  const autoSubmit = useEffectEvent(() => void submit(true));
  useEffect(() => {
    if (timeUp) autoSubmit();
  }, [timeUp, view]);

  const { positions } = layout;
  const index = positions.indexOf(current);
  const item = items[current];
  const locked = phase === 'submitting' || phase === 'timeup' || moving;
  const editable = !locked && (!v2 || isEditable(layout, current, served));
  const answered = (p: number) => (texts[p] ?? '') !== '' || (choices[p] ?? null) !== null;
  const reachable = (p: number | undefined): p is number =>
    p !== undefined && (!v2 || canOpen(layout, p, served));
  const prev = positions[index - 1];
  const next = positions[index + 1];

  const missing: Missing = (() => {
    if (itemFailed === current) return 'failed';
    if (!v2 || section === undefined) return 'loading';
    if (section.state !== 'open') return 'unavailable';
    const h = highestServed(section, served);
    if (section.navigation === 'forward_only' && h !== null && current < h) return 'passed';
    return 'loading';
  })();

  const onText = (value: string) => {
    if (item === undefined || item.kind !== 'written' || !editable) return;
    const max = item.maxChars ?? DEFAULT_MAX_CHARS;
    if (outboxRef.current?.text(current, value, max) === true) {
      setTexts((t) => ({ ...t, [current]: value }));
    }
  };

  const onChoose = (option: string | null) => {
    if (!editable || outboxRef.current === null) return;
    outboxRef.current.choice(current, option);
    setChoices((c) => ({ ...c, [current]: option }));
  };

  const go = (position: number | undefined) => {
    if (reachable(position)) setCurrent(position);
  };

  /** R5-59 e: `section.finish` is queued on this stream, then the screen moves on. */
  const finishSection = () => {
    const outbox = outboxRef.current;
    if (section === undefined || outbox === null || locked) return;
    outbox.finish(section.id);
    setConfirmFinish(false);
    closeHere(section.id);
  };

  const backToFullscreen = () => {
    try {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    } catch {
      // tolerated
    }
  };

  const statusLine =
    phase === 'timeup'
      ? COPY.test.timeUp
      : phase === 'submitting'
        ? COPY.test.submitting
        : moving
          ? COPY.test.moving
          : status;

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

      {v2 && section !== undefined ? (
        <SectionBar
          section={section}
          of={layout.sections.length}
          offsetMs={clock.offsetMs}
          canFinish={layout.sections.length > 1 && !locked}
          confirming={confirmFinish}
          onAsk={() => setConfirmFinish(true)}
          onConfirm={finishSection}
          onCancel={() => setConfirmFinish(false)}
        />
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
                disabled={!reachable(p)}
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
        <ItemPane
          api={api}
          sessionToken={sessionToken}
          item={item}
          missing={missing}
          editable={editable}
          text={texts[current] ?? ''}
          choice={choices[current] ?? null}
          onText={onText}
          onChoose={onChoose}
          onRetry={() => {
            setItemFailed(null);
            setItemAttempt((n) => n + 1);
          }}
        />
        <div className={ui.actions}>
          {section?.navigation === 'forward_only' ? null : (
            <button
              type="button"
              className={ui.secondary}
              onClick={() => go(prev)}
              disabled={!reachable(prev)}
            >
              {COPY.test.previous}
            </button>
          )}
          <button
            type="button"
            className={ui.secondary}
            onClick={() => go(next)}
            disabled={!reachable(next) || moving}
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
