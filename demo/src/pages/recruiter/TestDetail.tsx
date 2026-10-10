import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { AppShell, BandBadge, Card, ErrorNote, QualityScore } from '../../ui';
import type { CandidateStatus, Test, TriageRow } from '../../shared/types';
import LiveMonitor from './LiveMonitor';
import './recruiter.css';

const STATUS_LABEL: Record<CandidateStatus, string> = {
  invited: 'Invited',
  in_progress: 'Taking test',
  submitted: 'Submitted',
  shortlisted: 'Shortlisted',
  below_cutoff: 'Below cutoff',
  advanced: 'Advanced',
};

function StatusPill({ status }: { status: CandidateStatus }) {
  return (
    <span className={`rc-status s-${status}`}>
      {status === 'in_progress' && <span className="rc-live-dot" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Statuses whose Answer Quality cutoff can be (re)applied by bulk shortlist. */
const CUTOFF_ELIGIBLE: CandidateStatus[] = ['submitted', 'shortlisted', 'below_cutoff'];

export default function TestDetail() {
  const { testId = '' } = useParams();
  const [test, setTest] = useState<Test | null>(null);
  const [rows, setRows] = useState<TriageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.triage(testId);
      setRows(r);
      setLastRefresh(new Date());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [testId]);

  useEffect(() => {
    api.getTest(testId).then(setTest).catch((e: Error) => setError(e.message));
    void refresh();
    const t = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(t);
  }, [testId, refresh]);

  const scored = rows.filter((r) => r.qualityScore !== undefined);
  const avgQuality = scored.length ? Math.round(scored.reduce((a, r) => a + (r.qualityScore ?? 0), 0) / scored.length) : undefined;
  const submitted = rows.filter((r) => r.candidate.status !== 'invited' && r.candidate.status !== 'in_progress').length;
  const shortlisted = rows.filter((r) => r.candidate.status === 'shortlisted' || r.candidate.status === 'advanced').length;
  const live = rows.filter((r) => r.candidate.status === 'in_progress').length;

  return (
    <AppShell>
      <div className="caption" style={{ marginBottom: 8 }}><Link to="/recruiter">← All assessments</Link></div>
      <div className="rc-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="overline">{test?.role ?? 'Assessment'}</div>
          <h1>{test?.title ?? 'Loading…'}</h1>
          {test && (
            <div className="row gap8 wrap caption">
              <span className="tag">{Math.round(test.durationSec / 60)} min</span>
              <span className="tag">{test.mode === 'strict' ? 'Strict mode' : 'Standard mode'}</span>
              <span className="tag">{test.items.length} questions</span>
              <span className="muted">Ruleset</span><span className="mono">{test.rulesetVersion}</span>
              {test.rulesetFrozen && <span className="tag" title="Ruleset froze when the first candidate started">frozen</span>}
            </div>
          )}
        </div>
        <div className="caption muted">
          {live > 0 && <><span className="rc-live-dot" />{live} taking the test now · </>}
          Auto-refreshing every 5s{lastRefresh ? ` · updated ${lastRefresh.toLocaleTimeString()}` : ''}
        </div>
      </div>
      <ErrorNote error={error} />

      <div className="rc-stats">
        <Stat label="Invited" value={rows.length} />
        <Stat label="Submitted" value={submitted} />
        <div className="rc-stat">
          <div className="overline">Avg Answer Quality</div>
          <QualityScore score={avgQuality} size="lg" />
          <div className="caption muted hint">across {scored.length} scored</div>
        </div>
        <Stat label="Shortlisted" value={shortlisted} hint="includes advanced" />
      </div>

      <div className="col gap24" style={{ alignItems: 'stretch' }}>
        <InvitePanel testId={testId} nextN={rows.length + 1} onInvited={refresh} />
        <CutoffPanel testId={testId} rows={rows} onDone={refresh} />
        <LiveMonitor testId={testId} />
        <TriageTable rows={rows} onChanged={refresh} />
        {test && <ItemsList test={test} />}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rc-stat">
      <div className="overline">{label}</div>
      <div className="metric">{value}</div>
      {hint && <div className="caption muted hint">{hint}</div>}
    </div>
  );
}

function InvitePanel({ testId, nextN, onInvited }: { testId: string; nextN: number; onInvited: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (touched) return;
    setName(`Candidate ${nextN}`);
    setEmail(`candidate.${nextN}@example.com`);
  }, [nextN, touched]);

  async function invite() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const r = await api.invite(testId, { name: name.trim(), email: email.trim() });
      setLink(window.location.origin + r.link);
      setTouched(false);
      onInvited();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Could not copy automatically — select the link and copy it manually.');
    }
  }

  return (
    <Card title="Invite a candidate">
      <p className="caption muted" style={{ marginTop: 0 }}>Synthetic names and emails only in this demo.</p>
      <div className="row gap8 wrap" style={{ alignItems: 'flex-end' }}>
        <label style={{ flex: '1 1 200px' }}>Name
          <input value={name} onChange={(e) => { setTouched(true); setName(e.target.value); }} />
        </label>
        <label style={{ flex: '1 1 240px' }}>Email
          <input type="email" value={email} onChange={(e) => { setTouched(true); setEmail(e.target.value); }} />
        </label>
        <button className="primary" onClick={invite} disabled={busy || !name.trim() || !email.trim()}>
          {busy ? 'Creating…' : 'Create invite link'}
        </button>
      </div>
      <ErrorNote error={error} />
      {link && (
        <div className="rc-link-box">
          <code>{link}</code>
          <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <a className="btn" href={link} target="_blank" rel="noreferrer">Open as candidate (new tab)</a>
        </div>
      )}
      <p className="caption muted" style={{ marginBottom: 0, marginTop: 12 }}>
        Tip: <a href="/t/demo-candidate" target="_blank" rel="noreferrer" className="mono">/t/demo-candidate</a> is a ready-made demo invite.
      </p>
    </Card>
  );
}

function CutoffPanel({ testId, rows, onDone }: { testId: string; rows: TriageRow[]; onDone: () => void }) {
  const [cutoff, setCutoff] = useState(60);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const eligible = rows.filter((r) => r.qualityScore !== undefined && CUTOFF_ELIGIBLE.includes(r.candidate.status));
  const above = eligible.filter((r) => (r.qualityScore ?? 0) >= cutoff).length;
  const below = eligible.length - above;

  const buckets = useMemo(() => {
    const b = Array.from({ length: 10 }, () => 0);
    for (const r of rows) {
      if (r.qualityScore === undefined) continue;
      b[Math.min(9, Math.floor(r.qualityScore / 10))]++;
    }
    return b;
  }, [rows]);
  const maxB = Math.max(1, ...buckets);

  async function apply() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.shortlist(testId, cutoff);
      setResult(`Shortlisted ${r.shortlisted}; ${r.belowCutoff} marked below cutoff. Integrity flags on below-cutoff candidates are marked “not used”.`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Shortlist by Answer Quality">
      <div className="rc-note" style={{ marginBottom: 16 }}>
        <strong>Trace never rejects on integrity automatically.</strong> Integrity is reviewed only for shortlisted candidates.
        The cutoff below uses Answer Quality alone — Integrity Signals play no part in it.
      </div>
      <div className="rc-cutoff">
        <div>
          <label>Answer Quality cutoff
            <div className="row gap16">
              <input type="range" min={0} max={100} value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))} aria-label="Cutoff slider" />
              <input
                className="rc-num" type="number" min={0} max={100} value={cutoff}
                onChange={(e) => setCutoff(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} aria-label="Cutoff value"
              />
            </div>
          </label>
          <div className="rc-preview">
            <strong>{above}</strong> candidate{above === 1 ? '' : 's'} at or above cutoff will be shortlisted; <strong>{below}</strong> below
            cutoff will be marked ‘below cutoff’ — their integrity flags are marked ‘not used’ and need no review.
          </div>
          <ErrorNote error={error} />
          {result && <div className="ok-note">{result}</div>}
          <button className="primary" onClick={apply} disabled={busy || eligible.length === 0}>
            {busy ? 'Applying…' : 'Bulk shortlist by Answer Quality'}
          </button>
          {eligible.length === 0 && <div className="caption muted" style={{ marginTop: 6 }}>No submitted candidates to shortlist yet.</div>}
        </div>
        <div>
          <div className="overline" style={{ marginBottom: 20 }}>Answer Quality distribution</div>
          <div className="rc-hist">
            {buckets.map((n, i) => (
              <div key={i} className="rc-bar" title={`${i * 10}–${i === 9 ? 100 : i * 10 + 9}: ${n}`}>
                {n > 0 && <span className="n">{n}</span>}
                <div className={`fill ${i * 10 >= cutoff || (i * 10 + 9 >= cutoff && i * 10 < cutoff) ? 'above' : ''}`} style={{ height: `${(n / maxB) * 100}%` }} />
              </div>
            ))}
            <div className="rc-cut-line" style={{ left: `calc(${cutoff}% - 1px)` }}><span>{cutoff}</span></div>
          </div>
          <div className="rc-hist-axis">
            {buckets.map((_, i) => <span key={i}>{i * 10}</span>)}
          </div>
        </div>
      </div>
    </Card>
  );
}

function TriageTable({ rows, onChanged }: { rows: TriageRow[]; onChanged: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Score-first: ordered by Answer Quality only. Integrity never enters the sort key.
  const sorted = [...rows].sort((a, b) => (b.qualityScore ?? -1) - (a.qualityScore ?? -1));

  async function advance(id: string) {
    setBusy(id);
    setErrors((e) => { const n = { ...e }; delete n[id]; return n; });
    try {
      await api.advance(id);
      onChanged();
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: (e as Error).message }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Score-first triage" actions={<span className="caption muted">Sorted by Answer Quality</span>}>
      <p className="caption muted" style={{ marginTop: 0 }}>
        Answer Quality and Integrity Signals are two separate results, shown in separate columns and never combined. Integrity appears only for shortlisted candidates, and only human-confirmed flags are counted.
      </p>
      {rows.length === 0 ? (
        <div className="rc-empty">No candidates yet. Create an invite link above.</div>
      ) : (
        <div className="rc-table-wrap">
          <table className="rc-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Status</th>
                <th className="sep">Answer Quality</th>
                <th className="sep">Integrity Signals</th>
                <th title="Only human-confirmed flags are counted">Confirmed flags</th>
                <th className="sep">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const c = r.candidate;
                const canAdvance = c.status === 'shortlisted';
                // Integrity is reviewed only for the shortlist (score-first triage).
                const reviewed = c.status === 'shortlisted' || c.status === 'advanced';
                return (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{c.name}</div>
                      <div className="caption muted">{c.email}</div>
                    </td>
                    <td><StatusPill status={c.status} /></td>
                    <td className="sep"><QualityScore score={r.qualityScore} /></td>
                    <td className="sep">
                      {reviewed
                        ? (r.band ? <BandBadge band={r.band} /> : <span className="muted">—</span>)
                        : <span className="caption muted">Not reviewed (score-first)</span>}
                      {c.status === 'below_cutoff' && <div className="caption muted">flags not used</div>}
                    </td>
                    <td>{reviewed ? <span className="mono">{r.flagCount}</span> : <span className="muted">—</span>}</td>
                    <td className="sep">
                      <div className="row gap8 wrap">
                        {r.qualityScore !== undefined && <Link className="btn" to={`/reviewer/${c.id}`}>Open report</Link>}
                        {canAdvance && (
                          <button className="primary" onClick={() => advance(c.id)} disabled={busy === c.id}>
                            {busy === c.id ? 'Advancing…' : 'Advance'}
                          </button>
                        )}
                      </div>
                      {errors[c.id] && <div className="rc-row-err">{errors[c.id]}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ItemsList({ test }: { test: Test }) {
  return (
    <details className="card rc-items">
      <summary>Test items ({test.items.length}) <span className="caption muted" style={{ fontWeight: 400, marginLeft: 8, marginRight: 'auto' }}>answer keys visible to recruiters only</span></summary>
      <div style={{ marginTop: 12 }}>
        {test.items.map((it, i) => (
          <div key={it.id} className="rc-q">
            <div className="row gap8 wrap">
              <strong>Q{i + 1}</strong>
              <span className="tag">{it.kind === 'mcq' ? 'Multiple choice' : 'Written'}</span>
              <span className="caption muted">{it.points} pts</span>
            </div>
            <div style={{ marginTop: 4 }}>{it.prompt}</div>
            {it.kind === 'mcq' ? (
              <ol type="A">
                {it.options.map((o, oi) => (
                  <li key={oi} className={oi === it.correctIndex ? 'correct' : ''}>
                    {o}{oi === it.correctIndex && ' ✓ correct'}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="caption" style={{ marginTop: 6 }}>
                <span className="muted">Min words:</span> {it.minWords} · <span className="muted">Rubric keywords:</span>{' '}
                {(it.rubric ?? []).length ? (it.rubric ?? []).map((k) => <span key={k} className="tag" style={{ marginRight: 4 }}>{k}</span>) : '—'}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}
