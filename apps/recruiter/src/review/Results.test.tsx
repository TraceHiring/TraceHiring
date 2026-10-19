// Results and review queue (specs/d1-demo-slice.md §6.1, §6.3): Answer Quality only, sorted by score descending,
// "Scoring..." while pending, a plain "Below cutoff" mark, a read-only cutoff, no band, no selection, no export.
import type { ResultsListResponse, ReviewQueueResponse } from '@trace/shared/contracts/d1';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ResultsView, sortByScoreDesc } from './ResultsPage';
import { ReviewQueueView, sortNewestFirst } from './ReviewQueuePage';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (
  n: number,
  quality: ResultsListResponse['rows'][number]['quality'],
  submittedAt = '2026-10-19T10:00:00.000Z',
) => ({ reportId: ID(n), label: `Candidate ${n}`, submittedAt, quality });

const RESULTS: ResultsListResponse = {
  cutoff: 40,
  rows: [
    row(1, { state: 'ready', score: 35, belowCutoff: true }),
    row(2, { state: 'pending' }),
    row(3, { state: 'ready', score: 90, belowCutoff: false }),
    row(4, { state: 'ready', score: 60, belowCutoff: false }),
  ],
};

const html = (node: React.ReactNode) => renderToString(<MemoryRouter>{node}</MemoryRouter>);
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('sortByScoreDesc', () => {
  it('orders scores high to low and puts unscored rows last', () => {
    expect(sortByScoreDesc(RESULTS.rows).map((r) => r.label)).toEqual([
      'Candidate 3',
      'Candidate 4',
      'Candidate 1',
      'Candidate 2',
    ]);
  });
});

describe('ResultsView', () => {
  const out = html(<ResultsView data={RESULTS} />);

  it('shows scores in descending order, "Scoring..." and "Below cutoff" as plain text', () => {
    const t = text(out);
    expect(t.indexOf('Candidate 3')).toBeLessThan(t.indexOf('Candidate 4'));
    expect(t.indexOf('Candidate 4')).toBeLessThan(t.indexOf('Candidate 1'));
    expect(t).toContain('Scoring...');
    expect(t.match(/Below cutoff/g)).toHaveLength(1);
    expect(out).not.toMatch(/<(button|input|select)\b/);
  });

  it('shows the cutoff read-only and links each row to its report', () => {
    expect(text(out)).toContain('Answer Quality cutoff: 40');
    expect(out).toContain(`href="/reports/${ID(3)}"`);
  });

  it('has no band, selection, bulk bar or export', () => {
    expect(out).not.toMatch(/type="checkbox"|role="checkbox"|aria-selected/);
    expect(text(out)).not.toMatch(/band|integrity|export|download|bulk|select all/i);
  });
});

describe('ReviewQueueView', () => {
  const queue: ReviewQueueResponse = {
    reports: [
      {
        ...row(1, { state: 'ready', score: 80, belowCutoff: false }),
        testId: ID(90),
        testName: 'Test A',
      },
      {
        ...row(2, { state: 'pending' }, '2026-10-20T10:00:00.000Z'),
        testId: ID(91),
        testName: 'Test B',
      },
    ],
  };

  it('lists newest first with the test name and the same quality-only shape', () => {
    expect(sortNewestFirst(queue.reports).map((r) => r.label)).toEqual([
      'Candidate 2',
      'Candidate 1',
    ]);
    const out = html(<ReviewQueueView data={queue} />);
    const t = text(out);
    expect(t.indexOf('Candidate 2')).toBeLessThan(t.indexOf('Candidate 1'));
    expect(t).toContain('Test B');
    expect(t).toContain('Scoring...');
    expect(out).not.toMatch(/type="checkbox"/);
    expect(t).not.toMatch(/band|integrity/i);
  });
});
