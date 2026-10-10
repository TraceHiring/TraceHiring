import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { Card, ErrorNote, fmtTime } from '../../ui';
import type { EventType, LiveSessionRow } from '../../shared/types';
import './recruiter.css';

type Presence = LiveSessionRow['presence'];

const PRESENCE: Record<Presence, { label: string; cls: string }> = {
  present: { label: 'Present ✓', cls: 'p-present' },
  absent: { label: 'Away', cls: 'p-absent' },
  multiple: { label: '2+ people', cls: 'p-multiple' },
  no_camera: { label: 'No camera', cls: 'p-grey' },
  unknown: { label: 'Checking…', cls: 'p-grey' },
};

/** Plain-English labels for the live event feed. Signals, not verdicts. */
function eventLabel(type: EventType, detail?: string): string | null {
  switch (type) {
    case 'start': return 'Started the test';
    case 'tab_hidden': return 'Switched away from the tab';
    case 'tab_visible': return 'Came back to the tab';
    case 'window_blur': return 'Window lost focus';
    case 'fullscreen_exit': return 'Left fullscreen';
    case 'fullscreen_enter': return 'Returned to fullscreen';
    case 'paste': return 'Pasted text';
    case 'copy_question': return 'Copied question text';
    case 'untrusted_input': return 'Untrusted (scripted) input';
    case 'burst_after_return': return 'Typing burst after returning';
    case 'snapshot': return 'Random still captured';
    case 'camera_off': return 'Camera turned off';
    case 'diary': return detail ? `Note from candidate: “${detail}”` : 'Note from candidate';
    case 'answer_saved': return 'Answer saved';
    case 'submit': return 'Submitted';
    case 'shared_wrong_answers': return 'Shared wrong answers (server check)';
    case 'grader_injection': return 'Instructions aimed at the grader';
    case 'face_absent': return detail ? `Face not visible ${detail}s` : 'Face not visible';
    case 'multiple_faces': return 'Second person detected';
    case 'face_present': return 'Face back in frame';
    case 'mic_speech': return 'Speech detected (context only)';
    case 'appeal': return 'Dispute raised by candidate';
    default: return null;
  }
}

export default function LiveMonitor({ testId }: { testId: string }) {
  const [rows, setRows] = useState<LiveSessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0); // serverNow - client now, so the countdown follows the server clock

  const poll = useCallback(async () => {
    try {
      const r = await api.live(testId);
      if (r.length) offset.current = Date.parse(r[0].serverNow) - Date.now();
      setRows(r);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [testId]);

  useEffect(() => {
    void poll();
    const p = window.setInterval(() => { void poll(); }, 3000);
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(p); window.clearInterval(t); };
  }, [poll]);

  const n = rows?.length ?? 0;

  return (
    <Card
      title={<span>{n > 0 && <span className="rc-live-dot" />}Live now ({n} taking the test)</span>}
      actions={<span className="caption muted">Updates every 3s</span>}
    >
      <div className="rc-note" style={{ marginBottom: 16 }}>
        <strong>Stills only — no live video leaves the candidate's device.</strong> Counts below are signals pending review, not verdicts — no flag is confirmed until a person reviews it.
      </div>
      <ErrorNote error={error} />
      {rows === null && !error && <p className="muted">Loading…</p>}
      {rows && rows.length === 0 && (
        <div className="rc-empty">
          No one is taking this test right now. Open the demo invite{' '}
          <a href="/t/demo-candidate" target="_blank" rel="noreferrer" className="mono">/t/demo-candidate</a> in another tab to see it live.
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="rc-live-grid">
          {rows.map((r) => <LiveTile key={r.candidate.id} row={r} serverNowMs={now + offset.current} />)}
        </div>
      )}
    </Card>
  );
}

function LiveTile({ row, serverNowMs }: { row: LiveSessionRow; serverNowMs: number }) {
  const remaining = Date.parse(row.deadline) - serverNowMs;
  const pct = row.totalItems ? Math.round((row.answered / row.totalItems) * 100) : 0;
  const p = PRESENCE[row.presence] ?? PRESENCE.unknown;
  const events = row.recentEvents
    .map((e) => ({ ...e, label: eventLabel(e.type, e.detail) }))
    .filter((e) => e.label !== null)
    .slice(-4)
    .reverse();

  return (
    <div className="rc-live-tile">
      <div className="rc-still">
        {row.lastStill ? <img src={row.lastStill} alt={`Latest still of ${row.candidate.name}`} /> : <div className="rc-still-empty caption">No still yet</div>}
        <span className={`rc-presence ${p.cls}`}>{p.label}</span>
      </div>
      <div className="caption muted" style={{ marginTop: 4 }}>
        {row.lastStill && row.lastStillAt !== undefined ? `Latest still · ${fmtTime(row.lastStillAt)}` : 'Latest still · —'}
      </div>
      <div className="row between gap8" style={{ marginTop: 8 }}>
        <strong>{row.candidate.name}</strong>
        <span className={`mono-strong ${remaining < 120000 ? 'rc-time-low' : ''}`} title="Time remaining (server clock)">{fmtTime(remaining)}</span>
      </div>
      <div className="rc-progress" title={`${row.answered} of ${row.totalItems} answered`}>
        <div style={{ width: `${pct}%` }} />
      </div>
      <div className="row between caption">
        <span className="muted">{row.answered}/{row.totalItems} answered</span>
        <span className={row.flagsSoFar > 0 ? 'rc-signals' : 'muted'}>
          {row.flagsSoFar} signal{row.flagsSoFar === 1 ? '' : 's'} pending review
        </span>
      </div>
      <ul className="rc-events">
        {events.length === 0 && <li className="muted">No events yet</li>}
        {events.map((e) => (
          <li key={e.seq}><span className="mono muted">{fmtTime(e.t)}</span> {e.label}</li>
        ))}
      </ul>
      <Link className="btn" to={`/reviewer/${row.candidate.id}`} style={{ marginTop: 8, alignSelf: 'flex-start' }}>Open report</Link>
    </div>
  );
}
