import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { AppShell, BandBadge, Card, ErrorNote, QualityScore, fmtTime, useActingUser } from '../../ui';
import { DEMO_USERS } from '../../shared/types';
import type { DemoUserId, FinalDecision, Flag, IntegrityEvent, Item, Report } from '../../shared/types';
import { EVENT_LABEL, FAMILY_COLOR, FAMILY_LABEL, countdown, familyOf, fmtDateTime } from './eventMeta';
import type { Family } from './eventMeta';
import './reviewer.css';

const STATUS_LABEL: Record<string, string> = {
  invited: 'Invited', in_progress: 'In progress', submitted: 'Submitted', shortlisted: 'Shortlisted',
  below_cutoff: 'Below cutoff', advanced: 'Advanced',
};
const FLAG_STATUS_LABEL: Record<Flag['status'], string> = {
  pending: 'Pending review', confirmed: 'Confirmed', overturned: 'Overturned', not_used: 'Not used',
};
const OUTCOME_LABEL: Record<FinalDecision['outcome'], string> = {
  uphold: 'Uphold — integrity concern stands',
  partial: 'Partial — some flags stand',
  overturn: 'Overturn — no integrity concern',
  reattempt: 'Offer a supervised re-attempt',
};

function userName(id?: DemoUserId | string) {
  return DEMO_USERS.find((u) => u.id === id)?.name ?? id ?? '—';
}

function Watermarked({ src, viewer, caption, large }: { src: string; viewer: string; caption?: string; large?: boolean }) {
  return (
    <div className={`wm${large ? ' lg' : ''}`}>
      <img src={src} alt={caption ?? 'Evidence still'} draggable={false} />
      <div className="wm-text"><span>{viewer}<br />Trace · audited view</span></div>
      {caption && <div className="wm-foot">{caption}</div>}
    </div>
  );
}

export default function ReviewerReport() {
  const { candidateId = '' } = useParams();
  const user = useActingUser();
  const viewer = userName(user);
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selFlag, setSelFlag] = useState<string | null>(null);
  const [hlSeq, setHlSeq] = useState<number | null>(null);
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<FinalDecision['outcome']>('uphold');
  const [finalRationale, setFinalRationale] = useState('');
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setErr(null);
      setR(await api.report(candidateId));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [candidateId]);

  useEffect(() => { void load(); }, [load, user]);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setActionErr(null);
    try {
      await fn();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setBusy(false);
      await load();
    }
  }

  const events: IntegrityEvent[] = useMemo(() => r?.session?.events ?? [], [r]);
  const flags = r?.integrity?.flags ?? [];
  const selected = flags.find((f) => f.id === selFlag);
  const selSeqs = new Set(selected?.evidenceSeqs ?? []);
  const sessionLen = useMemo(() => {
    const last = events.reduce((m, e) => Math.max(m, e.t), 0);
    const dur = (r?.test.durationSec ?? 0) * 1000;
    return Math.max(last, dur, 1);
  }, [events, r]);
  const families = useMemo(() => {
    const s = new Set<Family>();
    events.forEach((e) => s.add(familyOf(e.type, e.tier)));
    return [...s];
  }, [events]);

  if (err) return <AppShell><ErrorNote error={err} /><Link to="/reviewer">← Back to inbox</Link></AppShell>;
  if (!r) return <AppShell><p className="muted">Loading report…</p></AppShell>;

  const { candidate, test, session, quality, integrity, notice, finalDecision } = r;
  const anyConfirmed = flags.some((f) => f.status === 'confirmed');
  const anyPending = flags.some((f) => f.status === 'pending');
  const itemById = new Map<string, Item>(test.items.map((i) => [i.id, i]));
  const noticeOpen = notice && !notice.response && new Date(notice.dueAt).getTime() > Date.now();
  const isFinalDifferentProblem = actionErr && /different reviewer/i.test(actionErr);

  return (
    <AppShell>
      <Link to="/reviewer" className="caption">← Action items</Link>
      <div className="rv-head" style={{ marginTop: 8 }}>
        <div>
          <div className="overline">Evidence report</div>
          <h1>{candidate.name}</h1>
          <div className="row gap8 wrap">
            <span className="muted">{test.title} · {test.role}</span>
            <span className="tag">{STATUS_LABEL[candidate.status] ?? candidate.status}</span>
            <span className="tag">{test.mode === 'strict' ? 'Strict mode' : 'Standard mode'}</span>
          </div>
        </div>
        <div className="col gap8" style={{ alignItems: 'flex-end' }}>
          <span className="caption muted mono">Ruleset {integrity?.rulesetVersion ?? test.rulesetVersion}{test.rulesetFrozen ? ' (frozen)' : ''}</span>
          <span className="caption muted mono">Grader {quality?.graderVersion ?? '—'}</span>
          <span className="caption muted">Viewing as {viewer}</span>
        </div>
      </div>

      {/* Two separate results */}
      <div className="rv-results">
        <Card title="Answer Quality" actions={<QualityScore score={quality?.score} size="lg" />}>
          {!quality ? <p className="muted">Not graded yet.</p> : quality.perItem.map((pi, idx) => {
            const item = itemById.get(pi.itemId);
            const ans = session?.answers[pi.itemId];
            return (
              <div key={pi.itemId} className="rv-item">
                <div className="row between gap8">
                  <span className="rv-item-prompt">Q{idx + 1}. {item?.prompt ?? pi.itemId}</span>
                  <span className="mono-strong">{pi.score}/{pi.max}</span>
                </div>
                <div className="rv-bar"><span style={{ width: `${pi.max ? (pi.score / pi.max) * 100 : 0}%` }} /></div>
                {item?.kind === 'mcq' ? (
                  <div style={{ marginTop: 6 }}>
                    {item.options.map((o, i) => {
                      const chosen = ans?.value === i || ans?.value === String(i);
                      const correct = item.correctIndex === i;
                      return (
                        <div key={i} className={`rv-opt${correct ? ' correct' : chosen ? ' wrong' : ''}`}>
                          {chosen ? '●' : '○'} {o}
                          {chosen && <span className="caption"> — chosen</span>}
                          {correct && <span className="caption"> — correct</span>}
                        </div>
                      );
                    })}
                    {ans === undefined && <div className="caption muted">No answer</div>}
                  </div>
                ) : (
                  <div className="rv-answer">{ans ? String(ans.value) : <span className="muted">No answer</span>}</div>
                )}
                <div className="caption muted" style={{ marginTop: 4 }}>{pi.feedback}</div>
              </div>
            );
          })}
        </Card>

        <Card title="Integrity signals" actions={<BandBadge band={integrity?.band} />}>
          {!integrity ? <p className="muted">No integrity result yet.</p> : (
            <>
              <div className="row gap24 wrap">
                <div><div className="overline">Coverage</div><div className="metric">{Math.round(integrity.coverage * 100)}%</div></div>
                <div><div className="overline">Flags</div><div className="metric">{flags.length}</div></div>
                <div><div className="overline">Events</div><div className="metric">{events.length}</div></div>
              </div>
              <div className="overline" style={{ marginTop: 12 }}>Why this band</div>
              <ul className="rv-reasons">
                {integrity.reasons.length ? integrity.reasons.map((x, i) => <li key={i}>{x}</li>) : <li className="muted">No reasons recorded.</li>}
              </ul>
              {session?.startPhoto && (
                <div style={{ marginTop: 12 }}>
                  <div className="overline" style={{ marginBottom: 6 }}>Start photo</div>
                  <Watermarked src={session.startPhoto} viewer={viewer} caption="Start photo" large />
                </div>
              )}
            </>
          )}
        </Card>
      </div>
      <div className="rv-sep-note">
        These are separate results. Integrity decisions never change the Answer Quality score.
      </div>

      <div className="rv-console">
        {/* Evidence timeline */}
        <Card title="Evidence timeline" actions={selected ? <button onClick={() => setSelFlag(null)} className="caption">Clear highlight</button> : undefined}>
          {events.length === 0 ? <p className="muted">No events recorded.</p> : (
            <>
              <div className="tl-track">
                <div className="tl-line" />
                {events.map((e) => {
                  const fam = familyOf(e.type, e.tier);
                  const hl = selSeqs.has(e.seq) || hlSeq === e.seq;
                  const dim = selected !== undefined && !selSeqs.has(e.seq);
                  return (
                    <button
                      key={e.seq}
                      className={`tl-dot${hl ? ' hl' : ''}${dim ? ' dim' : ''}`}
                      style={{ left: `${(e.t / sessionLen) * 100}%`, background: FAMILY_COLOR[fam] }}
                      title={`${fmtTime(e.t)} · ${EVENT_LABEL[e.type]}`}
                      aria-label={`${fmtTime(e.t)} ${EVENT_LABEL[e.type]}`}
                      onClick={() => {
                        setHlSeq(e.seq);
                        document.getElementById(`ev-${e.seq}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                      }}
                    />
                  );
                })}
              </div>
              <div className="tl-axis"><span>00:00</span><span>{fmtTime(sessionLen / 2)}</span><span>{fmtTime(sessionLen)}</span></div>
              <div className="tl-legend">
                {families.map((f) => <span key={f}><i style={{ background: FAMILY_COLOR[f] }} />{FAMILY_LABEL[f]}</span>)}
              </div>
              <div className="tl-list">
                {events.map((e) => {
                  const fam = familyOf(e.type, e.tier);
                  const hl = selSeqs.has(e.seq) || hlSeq === e.seq;
                  const item = e.itemId ? itemById.get(e.itemId) : undefined;
                  const qn = item ? test.items.indexOf(item) + 1 : undefined;
                  return (
                    <div key={e.seq} id={`ev-${e.seq}`} className={`tl-ev${hl ? ' hl' : ''}`}>
                      <span className="t">{fmtTime(e.t)}</span>
                      <span className="sw" style={{ background: FAMILY_COLOR[fam] }} />
                      <div>
                        <div className="row gap8 wrap">
                          <span className="lbl">{EVENT_LABEL[e.type] ?? e.type}</span>
                          <span className={`tag${e.tier === 'T1' ? ' t1' : ''}`}>{e.tier}</span>
                          {qn && <span className="caption muted">Q{qn}</span>}
                        </div>
                        {e.detail && <div className="caption muted">{e.detail}</div>}
                        {e.media && (
                          <div style={{ marginTop: 6 }}>
                            <Watermarked src={e.media} viewer={viewer} caption={`${e.type === 'snapshot' ? 'Random still' : 'Still'} · ${fmtTime(e.t)}`} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        <div className="rv-side">
          {/* Flags */}
          <Card title={`Flags (${flags.length})`}>
            {flags.length === 0 && <p className="muted">No flags raised.</p>}
            <div className="col gap8" style={{ alignItems: 'stretch' }}>
              {flags.map((f) => (
                <div key={f.id} className={`flag${selFlag === f.id ? ' sel' : ''}`} onClick={() => setSelFlag(selFlag === f.id ? null : f.id)}>
                  <div className="row between gap8" style={{ alignItems: 'flex-start' }}>
                    <strong>{f.label}</strong>
                    <span className={`badge st-${f.status}`}>{FLAG_STATUS_LABEL[f.status]}</span>
                  </div>
                  <div className="row gap8 wrap" style={{ margin: '6px 0' }}>
                    <span className={`tag${f.tier === 'T1' ? ' t1' : ''}`}>{f.tier}</span>
                    {f.capsAtReview && <span className="tag cap">Capped at Review</span>}
                    <span className="caption muted">{f.evidenceSeqs.length} evidence event{f.evidenceSeqs.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="caption" style={{ color: 'var(--text-2)' }}>{f.summary}</div>

                  {f.status === 'not_used' && (
                    <div className="caption muted" style={{ marginTop: 6 }}>Not used in decision (below cutoff) — not appealable.</div>
                  )}
                  {f.status === 'pending' && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <textarea
                        placeholder="Rationale (required to confirm)"
                        value={rationale[f.id] ?? ''}
                        onChange={(e) => setRationale({ ...rationale, [f.id]: e.target.value })}
                      />
                      <div className="caption muted">The candidate will see this rationale.</div>
                      <div className="row gap8" style={{ marginTop: 8 }}>
                        <button
                          className="danger"
                          disabled={busy || !(rationale[f.id] ?? '').trim()}
                          onClick={() => act(() => api.decideFlag(candidate.id, f.id, { action: 'confirm', rationale: (rationale[f.id] ?? '').trim() }))}
                        >Confirm</button>
                        <button
                          disabled={busy}
                          onClick={() => act(() => api.decideFlag(candidate.id, f.id, { action: 'overturn', rationale: (rationale[f.id] ?? '').trim() }))}
                        >Overturn</button>
                      </div>
                    </div>
                  )}
                  {(f.status === 'confirmed' || f.status === 'overturned') && (
                    <div style={{ marginTop: 8 }}>
                      {f.rationale && <div className="rv-quote">{f.rationale}</div>}
                      <div className="caption muted" style={{ marginTop: 4 }}>
                        {f.status === 'confirmed' ? 'Confirmed' : 'Overturned'} by {userName(f.decidedBy)} · {fmtDateTime(f.decidedAt)}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {actionErr && !isFinalDifferentProblem && <ErrorNote error={actionErr} />}
          </Card>

          {/* Notice */}
          <Card title="Notice to candidate">
            {!notice ? (
              anyConfirmed ? (
                <>
                  <p className="caption" style={{ marginTop: 0 }}>
                    A confirmed flag needs a notice before any integrity-based outcome. The candidate gets 72 hours to respond.
                  </p>
                  <button className="primary" disabled={busy} onClick={() => act(() => api.sendNotice(candidate.id))}>
                    Send notice (72h response window)
                  </button>
                </>
              ) : (
                <p className="caption muted" style={{ margin: 0 }}>
                  {anyPending ? 'Decide pending flags first. A notice is needed only if a flag is confirmed.' : 'No confirmed flags — no notice needed.'}
                </p>
              )
            ) : (
              <div className="col gap8" style={{ alignItems: 'stretch' }}>
                <div className="row between"><span className="caption muted">Sent</span><span className="caption">{fmtDateTime(notice.sentAt)} by {userName(notice.sentBy)}</span></div>
                <div className="row between"><span className="caption muted">Due</span><span className="caption">{fmtDateTime(notice.dueAt)}</span></div>
                {!notice.response && <div className="big-countdown">{countdown(notice.dueAt)}</div>}
                <div className="overline">Candidate response</div>
                {notice.response
                  ? <><div className="rv-quote">{notice.response}</div><div className="caption muted">Received {fmtDateTime(notice.respondedAt)}</div></>
                  : <div className="caption muted">Awaiting response…</div>}
                {noticeOpen && (
                  <button disabled={busy} onClick={() => act(() => api.fastForward(candidate.id))}>⏩ Fast-forward 72h (demo)</button>
                )}
              </div>
            )}
          </Card>

          {/* Final decision */}
          <Card title="Final decision">
            {finalDecision ? (
              <div className="col gap8" style={{ alignItems: 'stretch' }}>
                <span className="badge st-confirmed" style={{ alignSelf: 'flex-start' }}>{OUTCOME_LABEL[finalDecision.outcome]}</span>
                <div className="rv-quote">{finalDecision.rationale}</div>
                <div className="caption muted">By {userName(finalDecision.by)} · {fmtDateTime(finalDecision.at)}</div>
              </div>
            ) : !notice ? (
              <p className="caption muted" style={{ margin: 0 }}>Available after a notice is sent and the 72-hour window closes or the candidate responds.</p>
            ) : (
              <div className="col gap8" style={{ alignItems: 'stretch' }}>
                <p className="caption muted" style={{ margin: 0 }}>A different reviewer from the one who confirmed the flags must make the final call.</p>
                <label>Outcome
                  <select value={outcome} onChange={(e) => setOutcome(e.target.value as FinalDecision['outcome'])}>
                    {(Object.keys(OUTCOME_LABEL) as FinalDecision['outcome'][]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
                  </select>
                </label>
                <label>Rationale
                  <textarea style={{ minHeight: 80 }} value={finalRationale} onChange={(e) => setFinalRationale(e.target.value)} placeholder="Explain the decision. The candidate will see it." />
                </label>
                <button
                  className="primary"
                  disabled={busy || !finalRationale.trim()}
                  onClick={() => act(async () => { await api.finalDecision(candidate.id, { outcome, rationale: finalRationale.trim() }); setFinalRationale(''); })}
                >Record final decision</button>
                {isFinalDifferentProblem && (
                  <div className="error-note">
                    <strong>{actionErr}</strong>
                    <div className="caption">Switch “Acting as” to the other reviewer in the header.</div>
                  </div>
                )}
                {actionErr && !isFinalDifferentProblem && <ErrorNote error={actionErr} />}
              </div>
            )}
          </Card>
        </div>
      </div>

      <p className="caption muted" style={{ marginTop: 16, textAlign: 'center' }}>
        Every view of this evidence is audited. Stills are watermarked with the viewer’s name.
      </p>
    </AppShell>
  );
}
