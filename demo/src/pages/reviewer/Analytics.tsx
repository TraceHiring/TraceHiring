import { useEffect, useState } from 'react';
import { api } from '../../api';
import { AppShell, BAND_LABEL, Card, ErrorNote, useActingUser } from '../../ui';
import { DEMO_USERS, RULESET_VERSION } from '../../shared/types';
import type { AuditEntry, Analytics as AnalyticsData, Band } from '../../shared/types';
import { fmtDateTime } from './eventMeta';
import './reviewer.css';

const BAND_ORDER: Band[] = ['clear', 'review', 'strong_concern', 'insufficient'];
const BAND_FILL: Record<Band, string> = {
  clear: 'var(--clear-fg)', review: '#C58A1A', strong_concern: 'var(--concern-fg)', insufficient: 'var(--text-3)',
};

const DETECTORS: { name: string; tier: string; status: 'validated' | 'context'; note?: string }[] = [
  { name: 'Shared unusual wrong answers (server)', tier: 'T1', status: 'validated' },
  { name: 'Instructions to the grader in an answer', tier: 'T2', status: 'validated' },
  { name: 'Tab / window focus loss', tier: 'T3', status: 'context' },
  { name: 'Paste into answer', tier: 'T3', status: 'context' },
  { name: 'Scripted (untrusted) input', tier: 'T3', status: 'validated' },
  { name: 'Typing burst after returning', tier: 'T3', status: 'context' },
  { name: 'Camera off / random stills', tier: 'T3', status: 'context' },
  { name: 'Face absent ≥20s', tier: 'T3', status: 'validated', note: 'Capped at Review' },
  { name: 'Second face ≥10s', tier: 'T3', status: 'validated', note: 'Can exceed Review only with a viewable still' },
  { name: 'Speech during test', tier: 'T3', status: 'context', note: 'Strict mode only' },
];

function actorName(a: string) {
  return DEMO_USERS.find((u) => u.id === a)?.name ?? a;
}

export default function Analytics() {
  const user = useActingUser();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    Promise.all([api.analytics(), api.audit()])
      .then(([a, l]) => { if (alive) { setData(a); setAudit(l); } })
      .catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [user]);

  const bandTotal = data ? BAND_ORDER.reduce((s, b) => s + (data.bands[b] ?? 0), 0) : 0;
  const auditRows = [...audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);

  return (
    <AppShell>
      <div className="rv-head">
        <div>
          <div className="overline">Trust &amp; analytics</div>
          <h1>How the system is behaving</h1>
          <p className="muted" style={{ margin: 0 }}>Answer Quality and Integrity are reported separately here too.</p>
        </div>
      </div>
      <ErrorNote error={err} />
      {!data ? (!err && <p className="muted">Loading…</p>) : (
        <div className="col gap16" style={{ alignItems: 'stretch' }}>
          <div className="grid3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
            <div className="stat"><div className="overline">Tests</div><div className="metric">{data.tests}</div></div>
            <div className="stat"><div className="overline">Invited</div><div className="metric">{data.invited}</div></div>
            <div className="stat"><div className="overline">Submitted</div><div className="metric">{data.submitted}</div></div>
            <div className="stat"><div className="overline">Avg Answer Quality</div><div className="metric">{Math.round(data.avgQuality)}<span className="muted" style={{ fontSize: 16 }}>/100</span></div></div>
          </div>

          <div className="grid2">
            <Card title="Integrity bands">
              {BAND_ORDER.map((b) => {
                const n = data.bands[b] ?? 0;
                const pct = bandTotal ? (n / bandTotal) * 100 : 0;
                return (
                  <div key={b} className="hbar">
                    <span className={`badge band-${b}`} style={{ justifySelf: 'start' }}>{BAND_LABEL[b]}</span>
                    <div className="hbar-track"><div className="hbar-fill" style={{ width: `${pct}%`, background: BAND_FILL[b] }} /></div>
                    <span className="mono" style={{ textAlign: 'right' }}>{n}</span>
                  </div>
                );
              })}
              <p className="caption muted" style={{ marginBottom: 0 }}>Insufficient evidence is never counted as Clear.</p>
            </Card>

            <Card title="Flag outcomes">
              <div className="pill-grid">
                <div className="pill st-confirmed"><div className="overline">Confirmed</div><div className="metric">{data.flagOutcomes.confirmed}</div></div>
                <div className="pill st-overturned"><div className="overline">Overturned</div><div className="metric">{data.flagOutcomes.overturned}</div></div>
                <div className="pill st-pending"><div className="overline">Pending</div><div className="metric">{data.flagOutcomes.pending}</div></div>
                <div className="pill st-not_used"><div className="overline">Not used</div><div className="metric">{data.flagOutcomes.not_used}</div></div>
              </div>
              <p className="caption muted" style={{ marginBottom: 0 }}>“Not used” = flags on candidates below the score cutoff. They never reach a decision.</p>
            </Card>
          </div>

          <div className="grid2">
            <Card title="Overturn rate by signal">
              {data.overturnRateBySignal.length === 0 ? <p className="muted">No decided flags yet.</p> : (
                <div className="rv-table-wrap">
                  <table>
                    <thead><tr><th>Signal</th><th>Confirmed</th><th>Overturned</th><th>Overturn %</th></tr></thead>
                    <tbody>
                      {data.overturnRateBySignal.map((s) => {
                        const tot = s.confirmed + s.overturned;
                        const pct = tot ? Math.round((s.overturned / tot) * 100) : 0;
                        return (
                          <tr key={s.signal}>
                            <td>{s.label}</td>
                            <td className="mono">{s.confirmed}</td>
                            <td className="mono">{s.overturned}</td>
                            <td>{tot ? <span className={`badge ${pct > 30 ? 'st-confirmed' : 'st-overturned'}`}>{pct}%</span> : <span className="muted">—</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="caption muted" style={{ marginBottom: 0 }}>Detectors with &gt;30% overturn are sent for retuning.</p>
            </Card>

            <Card title="Trust page">
              <div className="row between" style={{ marginBottom: 8 }}>
                <span className="caption muted">Active ruleset</span>
                <span className="mono">{RULESET_VERSION}</span>
              </div>
              <table>
                <thead><tr><th>Detector</th><th>Tier</th><th>Status</th></tr></thead>
                <tbody>
                  {DETECTORS.map((d) => (
                    <tr key={d.name}>
                      <td>{d.name}{d.note && <div className="caption muted">{d.note}</div>}</td>
                      <td><span className={`tag${d.tier === 'T1' ? ' t1' : ''}`}>{d.tier}</span></td>
                      <td>{d.status === 'validated'
                        ? <span className="badge band-clear">Can raise a flag</span>
                        : <span className="badge band-insufficient">Context only</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="caption muted" style={{ marginBottom: 0 }}>
                Context only until validated: precision ≥90%, honest-session FPR &lt;5%. Client-reported (T3) signals cap at Review.
                IP/ASN is never a flag in India.
              </p>
            </Card>
          </div>

          <Card title="Audit log" actions={<span className="caption muted">{audit.length} entries</span>}>
            {auditRows.length === 0 ? <p className="muted">No audit entries yet.</p> : (
              <div className="rv-table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Candidate</th></tr></thead>
                  <tbody>
                    {auditRows.map((a, i) => (
                      <tr key={`${a.at}-${i}`}>
                        <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.at)}</td>
                        <td>{actorName(a.actor)}</td>
                        <td>{a.action}</td>
                        <td className="mono caption">{a.candidateId ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}
