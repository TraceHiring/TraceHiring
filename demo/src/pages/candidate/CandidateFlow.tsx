// Candidate test flow: welcome -> transparency & consent -> camera check -> test.
// The server holds the timer; answers autosave; integrity events are batched.
// Only allow-listed stills leave the device (start photo, server-requested snapshots).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import type { CandidateTestView, EventType, IntegrityEvent, Item } from '../../shared/types';
import { Card, ErrorNote, fmtTime } from '../../ui';
import { CandidateHeader } from './CandidateHeader';
import './candidate.css';
import { useMicLevel, usePresence } from './presence';
import type { Presence } from './presence';

type Step = 'loading' | 'welcome' | 'consent' | 'camera' | 'test' | 'submitted';
type OutEvent = Omit<IntegrityEvent, 'seq' | 'tier'>;
type Answers = Record<string, string | number>;

function captureStill(video: HTMLVideoElement | null, w: number, h: number, q: number): string | undefined {
  if (!video || video.readyState < 2) return undefined;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(video, 0, 0, w, h);
  return c.toDataURL('image/jpeg', q);
}

function wordCount(s: string) {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Camera + mic, falling back to camera only, then nothing. */
async function getMedia(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try { return await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch { /* fall back */ }
  try { return await navigator.mediaDevices.getUserMedia({ video: true }); } catch { return null; }
}

const PRESENCE_LABEL: Record<Presence, string> = {
  present: 'Face detected ✓',
  absent: 'No face',
  multiple: '2+ faces',
  unknown: 'Face check unavailable',
};

function streamLive(s: MediaStream | null) {
  return !!s && s.getVideoTracks().some((t) => t.readyState === 'live');
}

export default function CandidateFlow() {
  const { token = '' } = useParams();
  const [step, setStep] = useState<Step>('loading');
  const [view, setView] = useState<CandidateTestView | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [age, setAge] = useState(false);
  const [consent, setConsent] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    let alive = true;
    api.candidateView(token).then((v) => {
      if (!alive) return;
      setView(v);
      setOffset(Date.parse(v.serverNow) - Date.now());
      if (v.session?.submittedAt) setStep('submitted');
      else if (v.session) {
        setStep('test');
        // Resume: try to bring the camera back quietly; continue without it if unavailable.
        void getMedia().then((s) => { if (!s) return; if (alive) setStream(s); else s.getTracks().forEach((t) => t.stop()); });
      } else setStep('welcome');
    }).catch((e: Error) => { if (alive) { setError(e.message); setStep('welcome'); } });
    return () => { alive = false; };
  }, [token]);

  // Stop camera on unmount.
  const streamRef = useRef<MediaStream | null>(null);
  streamRef.current = stream;
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const title = view?.test.title;

  return (
    <div className="c-shell">
      {step !== 'test' && <CandidateHeader title={title} />}
      {step === 'loading' && <main className="c-main"><p className="muted">Loading your test…</p></main>}
      {step === 'welcome' && (
        <main className="c-main">
          <ErrorNote error={error} />
          {view && (
            <Card>
              <div className="col gap16">
                <span className="overline">Welcome</span>
                <h1 style={{ margin: 0 }}>Hi {view.candidateName}</h1>
                <p>You have been invited to <strong>{view.test.title}</strong>.</p>
                <div className="row gap16 c-wrap">
                  <div><div className="caption muted">Duration</div><strong>{Math.round(view.test.durationSec / 60)} minutes</strong></div>
                  <div><div className="caption muted">Questions</div><strong>{view.test.items.length}</strong></div>
                </div>
                <p className="muted">Your answers save automatically. The timer is kept by our server, so a refresh or dropped connection will not lose time unfairly.</p>
                <div><button className="primary" onClick={() => setStep('consent')}>Continue</button></div>
              </div>
            </Card>
          )}
        </main>
      )}
      {step === 'consent' && (
        <main className="c-main">
          <Card title="Before you start: what we capture, and what we never do">
            <div className="col gap16">
              <div>
                <strong>What is captured</strong>
                <ul className="c-list">
                  <li>One start photo, so a reviewer can confirm it was you.</li>
                  <li>A few random still snapshots from your camera during the test (not video).</li>
                  <li>Events such as switching tabs, pasting text and leaving fullscreen, with the time they happened.</li>
                  <li>Your answers and when they were saved.</li>
                </ul>
              </div>
              <div>
                <strong>What is never captured or judged</strong>
                <ul className="c-list">
                  <li>No continuous video or audio leaves your device.</li>
                  <li>No judgement of your emotions, stress or where you are looking.</li>
                  <li>No “AI-likeness” score.</li>
                  <li>Your IP address or network is never treated as a flag.</li>
                </ul>
              </div>
              <div className="ok-note">
                A human reviews any flag. If a confirmed flag might be used in a decision, you will get a notice and 72 hours to respond before any integrity decision is made. You will see the same report the reviewer sees about you.
              </div>
              <label className="c-check"><input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} /> <span>I am 18 or older</span></label>
              <label className="c-check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> <span>I have read the above and I consent</span></label>
              <div className="row gap8">
                <button onClick={() => setStep('welcome')}>Back</button>
                <button className="primary" disabled={!age || !consent} onClick={() => setStep('camera')}>Start</button>
              </div>
            </div>
          </Card>
        </main>
      )}
      {step === 'camera' && view && (
        <CameraStep
          token={token}
          age={age}
          consent={consent}
          onStream={setStream}
          onStarted={(v) => { setView(v); setOffset(Date.parse(v.serverNow) - Date.now()); setStep('test'); }}
        />
      )}
      {step === 'test' && view && view.session && (
        <TestRunner token={token} view={view} offset={offset} stream={stream} />
      )}
      {step === 'submitted' && (
        <main className="c-main">
          <Card>
            <div className="col gap16">
              <span className="overline">Submitted</span>
              <h2 style={{ margin: 0 }}>Your test has been submitted</h2>
              <p className="muted">You can read your report, including every signal recorded about your session.</p>
              <div><Link className="btn primary" to={`/t/${token}/report`}>View your report</Link></div>
            </div>
          </Card>
        </main>
      )}
    </div>
  );
}

function CameraStep({ token, age, consent, onStream, onStarted }: {
  token: string; age: boolean; consent: boolean;
  onStream: (s: MediaStream | null) => void;
  onStarted: (v: CandidateTestView) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<'asking' | 'on' | 'unavailable'>('asking');
  const [photo, setPhoto] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const presence = usePresence(videoRef, cam === 'on');
  const level = useMicLevel(local);
  const hasMic = !!local && local.getAudioTracks().length > 0;

  useEffect(() => {
    let alive = true;
    void getMedia().then((s) => {
      if (!s || s.getVideoTracks().length === 0) { s?.getTracks().forEach((t) => t.stop()); if (alive) setCam('unavailable'); return; }
      if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
      onStream(s);
      setLocal(s);
      setCam('on');
      if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play().catch(() => undefined); }
    });
    return () => { alive = false; };
  }, [onStream]);

  const begin = async () => {
    setBusy(true);
    setError(null);
    try { await document.documentElement.requestFullscreen?.(); } catch { /* ignore */ }
    try {
      const v = await api.start(token, { ageConfirmed: age, consent, startPhoto: photo });
      onStarted(v);
    } catch (e) {
      setError((e as Error).message);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } finally { setBusy(false); }
  };

  return (
    <main className="c-main">
      <Card title="Camera check and start photo">
        <div className="col gap16">
          {cam !== 'unavailable' && (
            <>
              <p className="muted">Only this start photo and a few random stills are saved. The live preview stays on your device.</p>
              <div className="row gap16 c-wrap" style={{ alignItems: 'flex-start' }}>
                <div className="c-videowrap">
                  <video ref={videoRef} className="c-video" muted playsInline autoPlay />
                  {cam === 'on' && <span className={`c-overlay p-${presence}`}>{PRESENCE_LABEL[presence]}</span>}
                </div>
                {photo && <div className="col gap8"><span className="caption muted">Your start photo</span><img className="c-photo" src={photo} alt="Your start photo" /></div>}
              </div>
              <div className="row gap8 c-wrap">
                <button disabled={cam !== 'on'} onClick={() => setPhoto(captureStill(videoRef.current, 240, 180, 0.6))}>{photo ? 'Retake start photo' : 'Take start photo'}</button>
                <button className="primary" disabled={!photo || busy} onClick={begin}>{busy ? 'Starting…' : 'Begin test'}</button>
              </div>
              {cam === 'on' && (
                <div className="col gap8">
                  <strong>Mic check: say your name</strong>
                  {hasMic ? (
                    <div className="c-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
                      <div style={{ width: `${Math.round(level * 100)}%` }} />
                    </div>
                  ) : <span className="caption muted">No microphone available. That is fine, you can continue.</span>}
                  <span className="caption muted">Audio never leaves your device. In Standard mode speech is not recorded as a signal. Face detection also runs only on your device; camera frames are not uploaded.</span>
                </div>
              )}
              {cam === 'asking' && <span className="caption muted">Waiting for camera permission…</span>}
            </>
          )}
          {cam === 'unavailable' && (
            <>
              <div className="ok-note">We could not use your camera. You can continue without it. This is not a penalty — it only means there is less evidence available, so a reviewer may have less to go on if anything needs checking.</div>
              <div><button className="primary" disabled={busy} onClick={begin}>{busy ? 'Starting…' : 'Continue without camera'}</button></div>
            </>
          )}
          {cam === 'on' && !photo && <span className="caption muted">Take a start photo to begin. Having trouble? <button onClick={() => setCam('unavailable')} style={{ padding: '2px 8px' }}>Continue without camera</button></span>}
          <span className="caption muted">The test opens in fullscreen. If fullscreen is not available, you can still continue.</span>
          <ErrorNote error={error} />
        </div>
      </Card>
    </main>
  );
}

function TestRunner({ token, view, offset, stream }: { token: string; view: CandidateTestView; offset: number; stream: MediaStream | null }) {
  const navigate = useNavigate();
  const session = view.session!;
  const items: Item[] = view.test.items;
  const startedAtMs = Date.parse(session.startedAt);
  const deadlineMs = Date.parse(session.deadline);
  const serverNow = useCallback(() => Date.now() + offset, [offset]);
  const relT = useCallback(() => Math.max(0, serverNow() - startedAtMs), [serverNow, startedAtMs]);

  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Answers>(() => {
    const a: Answers = {};
    for (const [k, v] of Object.entries(session.answers ?? {})) a[k] = v.value;
    return a;
  });
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const [remaining, setRemaining] = useState(deadlineMs - serverNow());
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'offline'; at?: string }>({ kind: 'idle' });
  const [scratchOpen, setScratchOpen] = useState(false);
  const [scratch, setScratch] = useState('');
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [diary, setDiary] = useState('');
  const [diarySent, setDiarySent] = useState(false);
  const [fsNudge, setFsNudge] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- autosave ----
  const seqRef = useRef(Math.max(0, ...Object.values(session.answers ?? {}).map((a) => a.seq)));
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingRef = useRef<Record<string, string | number>>({});
  const inflightRef = useRef(0);

  const saveItem = useCallback(async (itemId: string) => {
    if (!(itemId in pendingRef.current)) return;
    const value = pendingRef.current[itemId];
    seqRef.current += 1;
    const seq = seqRef.current;
    inflightRef.current += 1;
    setSaveState({ kind: 'saving' });
    try {
      const r = await api.saveAnswer(token, { itemId, value, seq });
      if (pendingRef.current[itemId] === value) delete pendingRef.current[itemId];
      setSaveState({ kind: 'saved', at: new Date(r.savedAt).toLocaleTimeString('en-GB', { hour12: false }) });
    } catch {
      setSaveState({ kind: 'offline' });
    } finally { inflightRef.current -= 1; }
  }, [token]);

  const setAnswer = (itemId: string, value: string | number) => {
    setAnswers((a) => ({ ...a, [itemId]: value }));
    pendingRef.current[itemId] = value;
    clearTimeout(timersRef.current[itemId]);
    timersRef.current[itemId] = setTimeout(() => void saveItem(itemId), 800);
  };

  const flushSaves = useCallback(async () => {
    for (const t of Object.values(timersRef.current)) clearTimeout(t);
    await Promise.all(Object.keys(pendingRef.current).map((id) => saveItem(id)));
  }, [saveItem]);

  // Retry failed saves.
  useEffect(() => {
    const h = setInterval(() => {
      if (inflightRef.current === 0 && Object.keys(pendingRef.current).length > 0) {
        for (const id of Object.keys(pendingRef.current)) if (!timersRef.current[id] || saveState.kind === 'offline') void saveItem(id);
      }
    }, 4000);
    return () => clearInterval(h);
  }, [saveItem, saveState.kind]);

  // ---- integrity events ----
  const queueRef = useRef<OutEvent[]>([]);
  const curItemRef = useRef<string | undefined>(items[0]?.id);
  curItemRef.current = items[idx]?.id;
  const push = useCallback((type: EventType, detail?: string, media?: string) => {
    queueRef.current.push({ t: relT(), type, itemId: curItemRef.current, detail, media });
  }, [relT]);

  const camVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef(stream);
  streamRef.current = stream;

  const inflightFlushRef = useRef<Promise<void> | null>(null);
  const flushEvents = useCallback(async (force = false): Promise<void> => {
    if (inflightFlushRef.current) return inflightFlushRef.current;
    if (!force && queueRef.current.length === 0) return;
    const batch = queueRef.current.splice(0);
    const run = (async () => {
    try {
      const r = await api.sendEvents(token, batch);
      if (r.requestSnapshot && streamLive(streamRef.current)) {
        const media = captureStill(camVideoRef.current, 160, 120, 0.6);
        if (media) push('snapshot', 'server-requested random still', media);
      }
    } catch {
      queueRef.current.unshift(...batch); // retry next tick
    }
    })();
    inflightFlushRef.current = run;
    try { await run; } finally { inflightFlushRef.current = null; }
  }, [token, push]);

  useEffect(() => {
    let tick = 0;
    const h = setInterval(() => { tick += 1; void flushEvents(tick % 5 === 0); }, 3000);
    return () => clearInterval(h);
  }, [flushEvents]);

  // Camera corner preview + camera_off.
  useEffect(() => {
    if (!stream) return;
    if (camVideoRef.current) { camVideoRef.current.srcObject = stream; void camVideoRef.current.play().catch(() => undefined); }
    const track = stream.getVideoTracks()[0];
    const onEnd = () => push('camera_off', 'camera stopped');
    track?.addEventListener('ended', onEnd);
    return () => track?.removeEventListener('ended', onEnd);
  }, [stream, push]);

  // On-device face presence + (Strict mode only) speech context. Only counts are computed here;
  // the one upload is the allow-listed still around a multiple_faces event.
  const presence = usePresence(camVideoRef, streamLive(stream), {
    onAbsent: (secs) => push('face_absent', String(secs)),
    onPresent: () => push('face_present'),
    onMultiple: (secs) => {
      const media = captureStill(camVideoRef.current, 160, 120, 0.6);
      push('multiple_faces', String(secs), media);
    },
  });
  useMicLevel(view.test.mode === 'strict' ? stream : null, () => push('mic_speech', 'speech detected (context only)'));

  // Visibility, blur, fullscreen, paste, copy, untrusted input.
  const hiddenAtRef = useRef<number | null>(null);
  const returnAtRef = useRef<number | null>(null);
  const typedSinceReturnRef = useRef(0);
  const burstSentRef = useRef(false);
  const justPastedRef = useRef(false);
  const questionRef = useRef<HTMLDivElement>(null);
  const untrustedAtRef = useRef(0);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        push('tab_hidden');
      } else {
        const away = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
        hiddenAtRef.current = null;
        const secs = Math.round(away / 1000);
        push('tab_visible', away < 3000 ? `away ${secs}s (short absence, under 3s)` : `away ${secs}s`);
        returnAtRef.current = Date.now();
        typedSinceReturnRef.current = 0;
      }
    };
    const onBlur = () => push('window_blur');
    const onFs = () => {
      if (document.fullscreenElement) { push('fullscreen_enter'); setFsNudge(false); }
      else { push('fullscreen_exit'); setFsNudge(true); }
    };
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text') ?? '';
      if (!text) return;
      justPastedRef.current = true;
      const own = Object.values(answersRef.current).some((v) => typeof v === 'string' && v.includes(text));
      if (own) return; // moving your own text around is not a signal
      push('paste', text.length >= 40 ? `external: ${text.length} chars pasted` : `${text.length} chars pasted`);
    };
    const onCopy = () => {
      const sel = document.getSelection();
      const q = questionRef.current;
      if (sel && q && sel.toString().length > 0 && sel.anchorNode && q.contains(sel.anchorNode)) push('copy_question', `${sel.toString().length} chars of question text copied`);
    };
    const onUntrusted = (e: Event) => {
      if (e.isTrusted) return;
      const now = Date.now();
      if (now - untrustedAtRef.current < 2000) return;
      untrustedAtRef.current = now;
      push('untrusted_input', 'isTrusted=false');
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('copy', onCopy, true);
    document.addEventListener('keydown', onUntrusted, true);
    document.addEventListener('input', onUntrusted, true);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('paste', onPaste, true);
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('keydown', onUntrusted, true);
      document.removeEventListener('input', onUntrusted, true);
    };
  }, [push]);

  const onWrittenChange = (itemId: string, next: string) => {
    const prev = String(answersRef.current[itemId] ?? '');
    const delta = next.length - prev.length;
    if (justPastedRef.current) justPastedRef.current = false;
    else if (delta > 0 && returnAtRef.current && !burstSentRef.current) {
      if (Date.now() - returnAtRef.current <= 20000) {
        typedSinceReturnRef.current += delta;
        if (typedSinceReturnRef.current >= 40) {
          burstSentRef.current = true;
          push('burst_after_return', `${typedSinceReturnRef.current} chars typed within 20s of returning`);
        }
      } else returnAtRef.current = null;
    }
    setAnswer(itemId, next);
  };

  // ---- submit & timer ----
  const submittedRef = useRef(false);
  const doSubmit = useCallback(async (auto: boolean) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await flushSaves();
      // Wait for any in-flight batch, then flush everything including the submit event.
      if (inflightFlushRef.current) await inflightFlushRef.current;
      push('submit', auto ? 'auto-submitted when time ran out' : undefined);
      await flushEvents(true);
      if (queueRef.current.length > 0) await flushEvents(true);
      await api.submit(token);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      navigate(`/t/${token}/report`);
    } catch (e) {
      submittedRef.current = false;
      setSubmitting(false);
      setError(`Could not submit: ${(e as Error).message}. Your answers are saved; please try again.`);
    }
  }, [flushSaves, flushEvents, push, token, navigate]);

  useEffect(() => {
    const h = setInterval(() => {
      const r = deadlineMs - serverNow();
      setRemaining(r);
      if (r <= 0) void doSubmit(true);
    }, 500);
    return () => clearInterval(h);
  }, [deadlineMs, serverNow, doSubmit]);

  const item = items[idx];
  const answeredCount = items.filter((it) => answers[it.id] !== undefined && String(answers[it.id]).trim() !== '').length;
  const unanswered = items.length - answeredCount;

  const sendDiary = () => {
    if (!diary.trim()) return;
    push('diary', diary.trim().slice(0, 500));
    void flushEvents();
    setDiary('');
    setDiaryOpen(false);
    setDiarySent(true);
  };

  const saveLabel = saveState.kind === 'saving' ? 'Saving…'
    : saveState.kind === 'saved' ? `Saved · ${saveState.at}`
    : saveState.kind === 'offline' ? 'Offline — will retry' : 'All changes save automatically';

  return (
    <>
      {fsNudge && (
        <div className="c-nudge" role="status">
          <span>You left fullscreen — please return. This is recorded as an event, not a penalty.</span>
          <button onClick={() => { void document.documentElement.requestFullscreen?.()?.catch(() => undefined); }}>Return to fullscreen</button>
        </div>
      )}
      <CandidateHeader
        title={view.test.title}
        right={<span className={`c-timer${remaining < 60000 ? ' low' : ''}`} aria-label="Time remaining">{fmtTime(remaining)}</span>}
      />
      <main className="c-main">
        <div className="row between c-wrap gap8">
          <nav className="c-nav" aria-label="Questions">
            {items.map((it, i) => {
              const done = answers[it.id] !== undefined && String(answers[it.id]).trim() !== '';
              return (
                <button key={it.id} className={`c-pill${done ? ' answered' : ''}${i === idx ? ' current' : ''}`} onClick={() => setIdx(i)} aria-label={`Question ${i + 1}${done ? ', answered' : ''}`}>{i + 1}</button>
              );
            })}
          </nav>
          <span className={`caption ${saveState.kind === 'offline' ? '' : 'muted'}`} aria-live="polite">{saveLabel}</span>
        </div>

        {item && (
          <Card>
            <div className="col gap16">
              <div className="row between"><span className="overline">Question {idx + 1} of {items.length}</span><span className="caption muted">{item.points} points</span></div>
              <div ref={questionRef} style={{ whiteSpace: 'pre-wrap', fontSize: 17 }}>{item.prompt}</div>
              {item.kind === 'mcq' ? (
                <div className="col gap8" role="radiogroup">
                  {item.options.map((opt, oi) => (
                    <label key={oi} className={`c-option${answers[item.id] === oi ? ' sel' : ''}`}>
                      <input type="radio" name={item.id} checked={answers[item.id] === oi} onChange={() => setAnswer(item.id, oi)} />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="col gap8">
                  <textarea
                    className="c-textarea"
                    value={String(answers[item.id] ?? '')}
                    onChange={(e) => onWrittenChange(item.id, e.target.value)}
                    placeholder="Type your answer here"
                  />
                  {(() => {
                    const wc = wordCount(String(answers[item.id] ?? ''));
                    return <span className="caption muted">{wc} words{wc < item.minWords ? ` · aim for at least ${item.minWords}` : ' · minimum reached'}</span>;
                  })()}
                </div>
              )}
              <div className="row between">
                <button disabled={idx === 0} onClick={() => setIdx(idx - 1)}>← Prev</button>
                <button disabled={idx >= items.length - 1} onClick={() => setIdx(idx + 1)}>Next →</button>
              </div>
            </div>
          </Card>
        )}

        <div className="row gap8 c-wrap">
          <button onClick={() => setScratchOpen((o) => !o)}>{scratchOpen ? 'Hide scratchpad' : 'Scratchpad'}</button>
          <button onClick={() => setDiaryOpen((o) => !o)}>Add a note for the reviewer</button>
          {diarySent && <span className="caption muted">Note sent to the reviewer.</span>}
        </div>
        {scratchOpen && (
          <Card title="Scratchpad">
            <textarea className="c-textarea" style={{ minHeight: 100 }} value={scratch} onChange={(e) => setScratch(e.target.value)} placeholder="Rough work. This stays on your device and is never sent." />
          </Card>
        )}
        {diaryOpen && (
          <Card title="Note for the reviewer">
            <div className="col gap8">
              <span className="caption muted">For example: “My internet dropped for a minute” or “Someone knocked on the door”. The reviewer sees this next to your session events.</span>
              <textarea className="c-textarea" style={{ minHeight: 80 }} value={diary} onChange={(e) => setDiary(e.target.value)} />
              <div><button className="primary" disabled={!diary.trim()} onClick={sendDiary}>Send note</button></div>
            </div>
          </Card>
        )}

        <Card>
          <div className="col gap8">
            {!confirmSubmit ? (
              <div className="row between c-wrap gap8">
                <span className="muted">{answeredCount} of {items.length} answered</span>
                <button className="primary" onClick={() => setConfirmSubmit(true)}>Submit test</button>
              </div>
            ) : (
              <>
                <strong>Submit now?</strong>
                <span>{unanswered > 0 ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}.` : 'All questions are answered.'} You cannot change answers after submitting.</span>
                <div className="row gap8">
                  <button onClick={() => setConfirmSubmit(false)} disabled={submitting}>Keep working</button>
                  <button className="primary" onClick={() => void doSubmit(false)} disabled={submitting}>{submitting ? 'Submitting…' : 'Yes, submit'}</button>
                </div>
              </>
            )}
            <ErrorNote error={error} />
          </div>
        </Card>
      </main>
      {streamLive(stream) && (
        <div className="c-cam" aria-label="Camera preview">
          <video ref={camVideoRef} muted playsInline autoPlay />
          <span className="caption muted"><span className={`c-dot p-${presence}`} title={PRESENCE_LABEL[presence]} aria-label={PRESENCE_LABEL[presence]} /> Camera on · only random stills are saved</span>
        </div>
      )}
    </>
  );
}
