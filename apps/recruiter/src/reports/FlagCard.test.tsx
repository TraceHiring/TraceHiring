// AT-D19 (specs/d1-demo-slice.md §9): every flag shows its evidence (atMs, rule id, observed value, tier) and the
// status "Pending review" with no buttons; connectivity gaps are labelled "Connectivity", never "Focus".
import { IntegrityCard } from '@trace/shared/contracts/d1';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlagCard } from './FlagCard';
import { EvidenceTimeline } from './EvidenceTimeline';
import { INTEGRITY_READY } from './report.test-helpers';

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('fixture', () => {
  it('is a valid ready integrity card', () => {
    expect(IntegrityCard.safeParse(INTEGRITY_READY).success).toBe(true);
  });
});

describe('FlagCard (AT-D19)', () => {
  it('shows atMs, rule id, observed value, tier note and "Pending review" for every flag', () => {
    for (const [index, flag] of INTEGRITY_READY.flags.entries()) {
      const html = renderToString(<FlagCard flag={flag} index={index + 1} />);
      const plain = text(html);
      expect(plain).toContain(flag.ruleId);
      expect(plain).toContain(`${flag.atMs} ms`);
      expect(plain).toContain('Pending review');
      expect(plain).toMatch(/\d+:\d{2}/);
    }
  });

  it('paste flag: observed length and the T3 tier note', () => {
    const flag = INTEGRITY_READY.flags[0];
    if (flag === undefined) throw new Error('fixture');
    const plain = text(renderToString(<FlagCard flag={flag} index={1} />));
    expect(plain).toContain('38 characters');
    expect(plain).toContain('Client-reported (T3), can reach Review only');
  });

  it('untrusted-input flag: "Untrusted input, hard evidence"', () => {
    const flag = INTEGRITY_READY.flags[1];
    if (flag === undefined) throw new Error('fixture');
    const plain = text(renderToString(<FlagCard flag={flag} index={2} />));
    expect(plain).toContain('Untrusted input, hard evidence');
    expect(plain).not.toContain('can reach Review only');
  });

  it('has no button, link or form control (no actions on a flag)', () => {
    for (const [index, flag] of INTEGRITY_READY.flags.entries()) {
      const html = renderToString(<FlagCard flag={flag} index={index + 1} />);
      expect(html).not.toMatch(/<(button|a|input|select|textarea|form)\b/i);
    }
  });
});

describe('EvidenceTimeline labels (AT-D19)', () => {
  const html = renderToString(<EvidenceTimeline timeline={INTEGRITY_READY.timeline} />);

  it('labels a connectivity gap "Connectivity", never "Focus"', () => {
    const items = [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map((m) => text(m[1] ?? ''));
    const gap = items.find((item) => item.includes('Connection gap'));
    expect(gap).toBeDefined();
    expect(gap).toContain('Connectivity');
    expect(gap).not.toContain('Focus');
    const focus = items.find((item) => item.includes('Tab hidden'));
    expect(focus).toContain('Focus (context only)');
  });

  it('lists every entry with its time, and the list is keyboard reachable', () => {
    const items = [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)];
    expect(items).toHaveLength(INTEGRITY_READY.timeline.length);
    for (const entry of INTEGRITY_READY.timeline) {
      expect(text(html)).toContain(`${entry.atMs} ms`);
    }
    expect(html).toMatch(/<summary\b/i);
  });

  it('draws no inline style (the CSP forbids style attributes)', () => {
    expect(html).not.toMatch(/\sstyle=/);
  });
});
