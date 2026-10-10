// Candidate's own report: the same facts the reviewer sees about this candidate, own data only.
// Answer Quality and Integrity signals are two separate cards and are never combined.
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api';
import type { Band, CandidateReportView, EventType, FinalDecision, FlagStatus } from '../../shared/types';
import { BandBadge, Card, ErrorNote, QualityScore, fmtTime } from '../../ui';
import { CandidateHeader } from './CandidateHeader';
import './candidate.css';

const BAND_EXPLAIN: Record<Band | 'under_review', string> = {
  clear: 'No integrity concerns were found in your session.',
  review: 'Some events in your session will be looked at by a person. This is not a finding against you, and nothing is decided automatically.',
  strong_concern: 'A reviewer has confirmed signals that may matter. You will get a notice and 72 hours to respond before any integrity decision.',
  insufficient: 'There was not enough evidence to say anything either way (for example, the camera was off). This is not a penalty.',
  under_review: 'Your session has not been reviewed yet, or a reviewer is looking at it now. Nothing has been decided.',
};

const FLAG_STATUS: Record<FlagStatus, string> = {
  pending: 'Awaiting a human reviewer',
  confirmed: 'Confirmed by a reviewer',
  overturned: 'Overturned — not held against you',
  not_used: 'Not used in any decision, no response needed',
};

const EVENT_LABEL: Record<EventType, string> = {
  start: 'Test started',
  tab_hidden: 'Switched away from the test tab',
  tab_visible: 'Returned to the test tab',
  window_blur: 'Test window lost focus',
  fullscreen_exit: 'Left fullscreen',
  fullscreen_enter: 'Entered fullscreen',
  paste: 'Pasted text',
  copy_question: 'Copied question text',
  untrusted_input: 'Input not from a physical keyboard',
  burst_after_return: 'Fast typing right after returning',
  snapshot: 'Random still photo taken',
  camera_off: 'Camera turned off',
  diary: 'Your note to the reviewer',
  answer_saved: 'Answer saved',
  submit: 'Test submitted',
  shared_wrong_answers: 'Unusual matching wrong answers',
  grader_injection: 'Instructions to the grader found in an answer',
  face_absent: 'No face in view (seconds)',
  multiple_faces: 'More than one face in view (seconds)',
  face_present: 'Face back in view',
  mic_speech: 'Speech nearby (context only)',
  appeal: 'You disputed a flag',
};

const OUTCOME_LABEL: Record<FinalDecision['outcome'], string> = {
  uphold: 'The flag was upheld',
  partial: 'The flag was partly upheld',
  overturn: 'The flag was overturned — it will not be held against you',
  reattempt: 'You are offered a re-attempt',
};

function fmtCountdown(ms: number) {
  if (ms <= 0) return 'time is up';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2, '0')}m left`;
}

function DisputeBox({ token, flagId, label, onSent }: { token: string; flagId: string; label: string; onSent: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.appeal(token, { flagId, text: text.trim() });
      setSentAt(res.appeal?.at ?? new Date().toISOString());
      setText('');
      setOpen(false);
      onSent();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="col gap8">
      {sentAt && <span className="caption">Dispute sent · {new Date(sentAt).toLocaleTimeString()}</span>}
      {!open ? (
        <div><button onClick={() => setOpen(true)}>{label}</button></div>
      ) : (
        <>
          <textarea className="c-textarea" style={{ minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Explain what happened — Hindi or English accepted" />
          <div className="row gap8">
            <button onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button className="primary" disabled={!text.trim() || busy} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
        </>
      )}
      <ErrorNote error={error} />
    </div>
  );
}

export default function CandidateReport() {
  const { token = '' } = useParams();
  const [r, setR] = useState<CandidateReportView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(() => {
    api.candidateReport(token).then((v) => { setR(v); setError(null); }).catch((e: Error) => setError(e.message));
  }, [token]);

  useEffect(() => {
    load();
    const h = setInterval(load, 10000);
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => { clearInterval(h); clearInterval(t); };
  }, [load]);

  const respond = async () => {
    setSending(true);
    try { await api.respond(token, text.trim()); setText(''); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setSending(false); }
  };

  return (
    <div className="c-shell">
      <CandidateHeader title={r?.testTitle} />
      <main className="c-main">
        <ErrorNote error={error} />
        {!r && !error && <p className="muted">Loading your report…</p>}
        {r && (
          <>
            <div className="col gap8">
              <span className="overline">Your report</span>
              <h1 style={{ margin: 0 }}>{r.candidateName}</h1>
              <span className="caption muted">
                {r.submittedAt ? `Submitted ${new Date(r.submittedAt).toLocaleString()}` : 'Not submitted yet'} · This is the same report the reviewer sees about you, without anyone else's data.
              </span>
            </div>

            {r.notice && (
              <Card className="c-notice" title="Notice: a confirmed flag may be used in a decision">
                <div className="col gap8">
                  <p style={{ margin: 0 }}>
                    You have until <strong>{new Date(r.notice.dueAt).toLocaleString()}</strong> (72 hours from the notice) to respond —{' '}
                    <strong>{fmtCountdown(Date.parse(r.notice.dueAt) - now)}</strong>. A different reviewer will make the final call after reading your response.
                  </p>
                  {r.notice.response ? (
                    <div className="ok-note">
                      <div className="caption">Your response{r.notice.respondedAt ? ` · sent ${new Date(r.notice.respondedAt).toLocaleString()}` : ''}</div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{r.notice.response}</div>
                    </div>
                  ) : (
                    <>
                      <textarea className="c-textarea" style={{ minHeight: 120 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Explain what happened in your own words." />
                      <span className="caption muted">Hindi or English accepted.</span>
                      <div><button className="primary" disabled={!text.trim() || sending} onClick={respond}>{sending ? 'Sending…' : 'Send response'}</button></div>
                    </>
                  )}
                </div>
              </Card>
            )}

            {r.finalDecision && (
              <Card title="Final decision">
                <div className="col gap8">
                  <strong>{OUTCOME_LABEL[r.finalDecision.outcome]}</strong>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{r.finalDecision.rationale}</div>
                  <span className="caption muted">Decided {new Date(r.finalDecision.at).toLocaleString()}</span>
                </div>
              </Card>
            )}

            <Card title="Answer Quality">
              {r.quality ? (
                <div className="col gap16">
                  <QualityScore score={r.quality.score} size="lg" />
                  <div className="col gap8">
                    {r.quality.perItem.map((p, i) => (
                      <div key={p.itemId} className="c-flag">
                        <div className="row between"><strong>Question {i + 1}</strong><span className="mono">{p.score}/{p.max}</span></div>
                        <span className="muted">{p.feedback}</span>
                      </div>
                    ))}
                  </div>
                  <span className="caption muted">Graded by {r.quality.graderVersion}. This score is about your answers only.</span>
                </div>
              ) : <p className="muted">Your answers have not been graded yet.</p>}
            </Card>

            <Card title="Integrity signals">
              {r.integrity ? (
                <div className="col gap16">
                  <div><BandBadge band={r.integrity.band} /></div>
                  <p style={{ margin: 0 }}>{BAND_EXPLAIN[r.integrity.band]}</p>
                  {r.integrity.band === 'under_review' && r.integrity.flags.length === 0 && (
                    <div className="col gap8">
                      <span>If anything in your session was unusual (power cut, network drop, someone walked in), you can add context.</span>
                      {(r.appeals ?? []).filter((a) => a.flagId === 'general').map((a, i) => (
                        <div key={i} className="c-appeal">
                          <span className="caption muted">Note sent · {new Date(a.at).toLocaleString()}</span>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{a.text}</div>
                        </div>
                      ))}
                      <DisputeBox token={token} flagId="general" label="Add context" onSent={load} />
                    </div>
                  )}
                  {r.integrity.flags.length === 0 ? <p className="muted">No flags.</p> : (
                    <div className="col gap8">
                      {r.integrity.flags.map((f) => (
                        <div key={f.id} className="c-flag">
                          <div className="row between c-wrap gap8"><strong>{f.label}</strong><span className="tag">{FLAG_STATUS[f.status]}</span></div>
                          <span className="muted">{f.summary}</span>
                          {f.status === 'confirmed' && f.rationale && <span><span className="caption">Reviewer's reason: </span>{f.rationale}</span>}
                          {f.status === 'overturned' && f.rationale && <span className="caption muted">Reviewer's note: {f.rationale}</span>}
                          {(r.appeals ?? []).filter((a) => a.flagId === f.id).map((a, i) => (
                            <div key={i} className="c-appeal">
                              <span className="caption muted">Dispute sent · {new Date(a.at).toLocaleString()}</span>
                              <div style={{ whiteSpace: 'pre-wrap' }}>{a.text}</div>
                            </div>
                          ))}
                          {f.status !== 'not_used' && <DisputeBox token={token} flagId={f.id} label="Dispute this flag" onSent={load} />}
                        </div>
                      ))}
                    </div>
                  )}
                  <span className="caption muted">Integrity signals never change your Answer Quality score, and nothing is decided automatically.</span>
                </div>
              ) : <p className="muted">Integrity signals are not available yet.</p>}
            </Card>

            <Card title="Your session timeline">
              {r.timeline.length === 0 ? <p className="muted">No events recorded.</p> : (
                <ul className="c-timeline">
                  {r.timeline.map((e) => (
                    <li key={e.seq}>
                      <span className="mono">{fmtTime(e.t)}</span>
                      <span>{EVENT_LABEL[e.type] ?? e.type}{e.detail ? <span className="muted"> — {e.detail}</span> : null}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
