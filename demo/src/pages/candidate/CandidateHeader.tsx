import type { ReactNode } from 'react';
import './candidate.css';

/** Candidate-only header: no recruiter nav, no role switcher. */
export function CandidateHeader({ title, right }: { title?: string; right?: ReactNode }) {
  return (
    <header className="c-head">
      <div className="row gap16" style={{ minWidth: 0 }}>
        <span className="brand">trace<span className="dot">.</span></span>
        {title && <span className="c-title">{title}</span>}
      </div>
      <div className="row gap8">
        {right}
        <span className="tag">Demo · synthetic data</span>
      </div>
    </header>
  );
}
