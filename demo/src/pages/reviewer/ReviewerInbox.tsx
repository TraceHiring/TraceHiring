import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { AppShell, BandBadge, Card, ErrorNote, QualityScore, useActingUser } from '../../ui';
import { DEMO_USERS } from '../../shared/types';
import type { ReviewerInboxRow } from '../../shared/types';
import { countdown } from './eventMeta';
import './reviewer.css';

export default function ReviewerInbox() {
  const user = useActingUser();
  const nav = useNavigate();
  const [rows, setRows] = useState<ReviewerInboxRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api.inbox().then((r) => { if (alive) setRows(r); }).catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [user]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const me = DEMO_USERS.find((u) => u.id === user);

  return (
    <AppShell>
      <div className="rv-head">
        <div>
          <div className="overline">Reviewer</div>
          <h1>Action items</h1>
          <div className="rv-count">{rows ? `${rows.length} item${rows.length === 1 ? '' : 's'} left` : 'Loading…'}</div>
        </div>
        <div className="rv-hint">
          You are acting as <strong>{me?.name ?? user}</strong> — switch in the header.
          {me?.role !== 'reviewer' && <> Pick a reviewer to confirm flags.</>}
        </div>
      </div>
      <ErrorNote error={err} />

      <Card>
        {rows && rows.length === 0 ? (
          <div className="rv-empty">
            <h3>Nothing to review</h3>
            <p style={{ maxWidth: 520, margin: '0 auto' }}>
              Only shortlisted candidates in <strong>Review</strong> or <strong>Strong concern</strong> come here — go to{' '}
              <Link to="/recruiter">Recruiter</Link> and bulk-shortlist by score first. Integrity is reviewed only for
              shortlisted candidates; flags on everyone else are not used.
            </p>
          </div>
        ) : (
          <div className="rv-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Test</th>
                  <th>Answer Quality</th>
                  <th>Integrity</th>
                  <th>Pending flags</th>
                  <th>Notice</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((r) => (
                  <tr key={r.candidate.id} className="rv-row" onClick={() => nav(`/reviewer/${r.candidate.id}`)}>
                    <td>
                      <Link to={`/reviewer/${r.candidate.id}`} onClick={(e) => e.stopPropagation()}>
                        <strong>{r.candidate.name}</strong>
                      </Link>
                    </td>
                    <td className="muted">{r.testTitle}</td>
                    <td><QualityScore score={r.qualityScore} /></td>
                    <td><BandBadge band={r.band} /></td>
                    <td>{r.pendingFlags > 0 ? <span className="badge st-pending">{r.pendingFlags} pending</span> : <span className="muted">0</span>}</td>
                    <td>
                      {!r.notice ? <span className="muted caption">Not sent</span>
                        : r.notice.response ? <span className="badge st-overturned">Response received</span>
                        : <span className="mono">{countdown(r.notice.dueAt)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="caption muted" style={{ marginTop: 12 }}>
        Answer Quality and Integrity are separate columns and separate results. Nothing here rejects a candidate automatically.
      </p>
    </AppShell>
  );
}
