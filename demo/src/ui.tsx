// Small shared UI kit. Pages may add their own components in their own folders.
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { Band, DemoUserId } from './shared/types';
import { DEMO_USERS } from './shared/types';
import { getActingUser, setActingUser } from './api';

export const BAND_LABEL: Record<Band | 'under_review', string> = {
  clear: 'Clear',
  review: 'Review',
  strong_concern: 'Strong concern',
  insufficient: 'Insufficient evidence',
  under_review: 'Under review',
};

export function BandBadge({ band }: { band?: Band | 'under_review' }) {
  if (!band) return <span className="badge band-insufficient">—</span>;
  return <span className={`badge band-${band}`}>{BAND_LABEL[band]}</span>;
}

export function QualityScore({ score, size = 'md' }: { score?: number; size?: 'md' | 'lg' }) {
  if (score === undefined) return <span className="muted">—</span>;
  return <span className={size === 'lg' ? 'metric' : 'mono-strong'}>{score}<span className="muted">/100</span></span>;
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="row gap8">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function useActingUser(): DemoUserId {
  const [u, setU] = useState(getActingUser());
  useEffect(() => {
    const h = () => setU(getActingUser());
    window.addEventListener('trace-user-changed', h);
    return () => window.removeEventListener('trace-user-changed', h);
  }, []);
  return u;
}

export function AppShell({ children }: { children: ReactNode }) {
  const user = useActingUser();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">trace<span className="dot">.</span></Link>
        <nav className="row gap16">
          <NavLink to="/recruiter">Recruiter</NavLink>
          <NavLink to="/reviewer">Reviewer</NavLink>
          <NavLink to="/analytics">Trust &amp; analytics</NavLink>
        </nav>
        <div className="row gap8">
          <span className="caption muted">Acting as</span>
          <select value={user} onChange={(e) => setActingUser(e.target.value as DemoUserId)}>
            {DEMO_USERS.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </header>
      <div className="demo-banner">Demo environment · synthetic data only · staging</div>
      <main className="page">{children}</main>
    </div>
  );
}

export function ErrorNote({ error }: { error?: string | null }) {
  if (!error) return null;
  return <div className="error-note">{error}</div>;
}

export function fmtTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
