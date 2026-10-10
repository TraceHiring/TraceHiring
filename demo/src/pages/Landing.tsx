import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AppShell, BandBadge, ErrorNote } from '../ui';
import type { Band } from '../shared/types';
import './landing.css';

const PRINCIPLES: { title: string; body: string }[] = [
  {
    title: 'Two results, never blended',
    body: 'Answer Quality (0–100) and the Integrity band are computed, stored and shown separately. An integrity decision never changes a quality score.',
  },
  {
    title: 'No automatic rejection',
    body: 'No API, job or bulk action rejects anyone on integrity. Bulk actions work only on Answer Quality cutoffs, and a human confirms every flag.',
  },
  {
    title: 'Evidence or it didn’t happen',
    body: 'A deterministic, versioned band engine: same inputs, same band. Every flag links to the events behind it. Client-reported signals cap at Review.',
  },
  {
    title: 'Notice + 72 hours to respond',
    body: 'Before any integrity-based outcome the candidate gets a notice and 72 hours to respond. A different reviewer makes the final call.',
  },
  {
    title: 'Same report on both sides',
    body: 'The candidate reads the same report the reviewer sees, minus anyone else’s data, including the rationale for every confirmed flag.',
  },
  {
    title: 'Privacy by design',
    body: 'Only the start photo and random stills leave the device. No emotion, gaze or AI-likeness scoring. IP is never a flag in India. Under-18s are blocked.',
  },
];

const BANDS: { band: Band; meaning: string }[] = [
  { band: 'clear', meaning: 'No signal that needs a human look. Proceed on Answer Quality alone.' },
  { band: 'review', meaning: 'Something worth a look. A reviewer checks the evidence before anything happens.' },
  { band: 'strong_concern', meaning: 'Corroborated, high-trust evidence. Still needs human confirmation, notice and 72 h.' },
  { band: 'insufficient', meaning: 'Not enough coverage to judge (e.g. camera off). Never shown as Clear.' },
];

export default function Landing() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reset() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await api.reset();
      setMsg('Demo data reset to the starting state.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <section className="landing-hero">
        <div className="overline">Trace · India-first assessments for high-volume hiring</div>
        <h1>Online assessments where every integrity flag comes <span className="accent">with evidence</span>.</h1>
        <p className="lede">
          Run thousands of candidates through a fair test, shortlist by score, and review integrity only where it
          matters, with the timeline, stills and rationale a candidate can read and answer.
        </p>
      </section>

      <div className="overline">Guided demo · follow the three steps</div>
      <div className="cta-grid">
        <Link to="/recruiter" className="cta-card">
          <span className="cta-step">1</span>
          <h3>Recruiter</h3>
          <p>Build a test, invite candidates, and triage by Answer Quality score.</p>
          <span className="cta-go">Open recruiter →</span>
        </Link>
        <a href="/t/demo-candidate" target="_blank" rel="noopener noreferrer" className="cta-card">
          <span className="cta-step">2</span>
          <h3>Candidate</h3>
          <p>Take the demo test in a new tab. Try switching tabs or pasting to see signals appear.</p>
          <span className="cta-go">Take the demo test ↗</span>
        </a>
        <Link to="/reviewer" className="cta-card">
          <span className="cta-step">3</span>
          <h3>Reviewer</h3>
          <p>Review the evidence, send a notice, and let a different reviewer make the final call.</p>
          <span className="cta-go">Open reviewer →</span>
        </Link>
      </div>

      <h2 className="section-title">Our promises</h2>
      <div className="principles">
        {PRINCIPLES.map((p) => (
          <div key={p.title} className="principle">
            <h3>{p.title}</h3>
            <p>{p.body}</p>
          </div>
        ))}
      </div>

      <h2 className="section-title">How bands work</h2>
      <div className="bands-strip">
        {BANDS.map((b) => (
          <div key={b.band} className="band-cell">
            <BandBadge band={b.band} />
            <p>{b.meaning}</p>
          </div>
        ))}
      </div>

      <footer className="landing-footer">
        <span className="caption muted">Demo · synthetic data only</span>
        <div className="row gap8 wrap">
          {msg && <span className="caption" style={{ color: 'var(--clear-fg)' }}>{msg}</span>}
          <ErrorNote error={err} />
          <button onClick={reset} disabled={busy} className="caption">{busy ? 'Resetting…' : 'Reset demo data'}</button>
        </div>
      </footer>
    </AppShell>
  );
}
