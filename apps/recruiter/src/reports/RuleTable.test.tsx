// "How the band is set" shows the bundled rule table (specs/d1-demo-slice.md §6.1; ADR-026): the rows come from
// the @trace/band-engine table whose version equals the card's ruleTableVersion, and only for a `ready` card.
// If no bundled table has that version, the card says so; it never shows a different table.
import ruleTableJson from '@trace/band-engine/rules/d1-v1.json';
import type { IntegrityCard } from '@trace/shared/contracts/d1';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PollSnapshot } from '../common/poller';
import { IntegrityCardView } from './Cards';
import { INTEGRITY_READY } from './report.test-helpers';

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const value = (card: IntegrityCard): PollSnapshot<IntegrityCard> => ({
  state: { kind: 'value', value: card },
  slow: false,
});
const render = (snapshot: PollSnapshot<IntegrityCard>): string =>
  renderToString(<IntegrityCardView snapshot={snapshot} />);

/** The cells of the rule row whose first cell is `id`. */
function ruleRow(html: string, id: string): string[] {
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...(row[1] ?? '').matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) =>
      text(m[1] ?? '').trim(),
    );
    if (cells[0] === id) return cells;
  }
  throw new Error(`no row for ${id}`);
}

describe('How the band is set: the bundled rule table', () => {
  const html = render(value(INTEGRITY_READY));

  it('lists every rule of the matching table with its id, kinds, family, tier, severity and status', () => {
    expect(INTEGRITY_READY.ruleTableVersion).toBe(ruleTableJson.version);
    for (const rule of ruleTableJson.rules) {
      const cells = ruleRow(html, rule.id);
      expect(cells[1]).toBe(rule.kinds.join(', '));
      expect(cells[2]).toBe(rule.family);
      expect(cells[3]).toBe(rule.tier);
      expect(cells[4]).toBe(rule.severity);
      expect(cells[5]).toBe(rule.validated ? 'Validated' : 'Context only');
    }
  });

  it('marks the unvalidated rules context only and the validated ones validated', () => {
    expect(ruleRow(html, 'D1-PASTE')[5]).toBe('Validated');
    expect(ruleRow(html, 'D1-UNTRUSTED-INPUT')[5]).toBe('Validated');
    expect(ruleRow(html, 'D1-TAB-HIDDEN')[5]).toBe('Context only');
    expect(ruleRow(html, 'D1-FULLSCREEN-EXIT')[5]).toBe('Context only');
  });

  it('shows the families, the coverage floor and the photo factor as percentages', () => {
    const plain = text(html);
    for (const family of ruleTableJson.families) expect(plain).toContain(family);
    expect(plain).toContain(`Coverage floor ${ruleTableJson.coverageFloorPermille / 10}%`);
    expect(plain).toContain(
      `Photo missing factor ${ruleTableJson.coveragePhotoMissingFactorPermille / 10}%`,
    );
    expect(plain).toContain(`Rule table ${ruleTableJson.version}`);
  });

  it('shows the fallback and no rows when no bundled table has the card version', () => {
    const other = render(value({ ...INTEGRITY_READY, ruleTableVersion: 'd9-unknown' }));
    const plain = text(other);
    expect(plain).toContain('Rule table not available in this build');
    expect(plain).toContain('d9-unknown');
    expect(plain).toContain(INTEGRITY_READY.engineVersion);
    for (const rule of ruleTableJson.rules) expect(() => ruleRow(other, rule.id)).toThrow();
    expect(other).not.toContain('<table');
    expect(plain).not.toContain('Coverage floor');
  });

  it.each<[string, IntegrityCard]>([
    ['pending', { state: 'pending' }],
    ['not used below cutoff', { state: 'not_used_below_cutoff' }],
  ])('shows no rule rows for a %s card', (_name, card) => {
    const plain = text(render(value(card)));
    expect(plain).not.toContain('D1-PASTE');
    expect(plain).not.toContain('Coverage floor');
    expect(plain).not.toContain('How the band is set');
  });

  it('shows no rule rows while loading or unavailable', () => {
    for (const state of [{ kind: 'loading' }, { kind: 'unavailable' }] as const) {
      const plain = text(render({ state, slow: false }));
      expect(plain).not.toContain('D1-PASTE');
      expect(plain).not.toContain('Rule table');
    }
  });
});
