// AT-D3 (two equal cards, never blended), AT-D14 (below cutoff renders no band, flags or timeline) and AT-D17
// (polling states, fake timers) for the report page. Effects do not run under renderToString, so the controller
// is started by the test and the page is rendered from the pollers' snapshots.
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api/client';
import { errorText } from '../common/messages';
import { ReportPage } from './ReportPage';
import { ReportController } from './report-controller';
import {
  API_ORIGIN,
  INTEGRITY_READY,
  META,
  ORG_ID,
  QUALITY_READY,
  REPORT_ID,
  fakeApiFetch,
  json,
  type RouteTable,
} from './report.test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(table: RouteTable) {
  const fake = fakeApiFetch(table);
  const api = new ApiClient({
    origin: API_ORIGIN,
    orgId: ORG_ID,
    getAccessToken: () => Promise.resolve('tok'),
    fetch: fake.fetch,
  });
  const controller = new ReportController(api, REPORT_ID);
  return { controller, urls: fake.urls };
}

const render = (controller: ReportController): string =>
  renderToString(<ReportPage controller={controller} />);
const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/** The `<section ... data-region="x">` element's opening tag and text. */
function region(html: string, name: string): { open: string; text: string } {
  const match = new RegExp(`<section([^>]*data-region="${name}"[^>]*)>([\\s\\S]*?)</section>`).exec(
    html,
  );
  if (match === null) throw new Error(`region ${name} not found`);
  return { open: match[1] ?? '', text: plain(match[2] ?? '') };
}
const classOf = (open: string): string => /class="([^"]*)"/.exec(open)?.[1] ?? '';

const allReady: RouteTable = {
  meta: () => json(META),
  quality: () => json(QUALITY_READY),
  integrity: () => json(INTEGRITY_READY),
};

describe('ReportPage (AT-D3)', () => {
  it('makes exactly three calls: meta, quality, integrity', async () => {
    const { controller, urls } = setup(allReady);
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const paths = urls.map((u) => new URL(u).pathname).sort();
    expect(paths).toEqual(
      [
        `/v1/orgs/${ORG_ID}/reports/${REPORT_ID}`,
        `/v1/orgs/${ORG_ID}/reports/${REPORT_ID}/integrity`,
        `/v1/orgs/${ORG_ID}/reports/${REPORT_ID}/quality`,
      ].sort(),
    );
    controller.stop();
  });

  it('renders the header, the info line and each card from its own response', async () => {
    const { controller } = setup(allReady);
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html = render(controller);
    const text = plain(html);
    expect(text).toContain('Candidate 3');
    expect(text).toContain('Synthetic backend test');
    expect(text).toContain('ABCD1234');
    expect(text).toContain('a1b2c3d4');
    expect(text).toContain(
      'Nothing is decided automatically. Signals are observations, not proof of misconduct. A person makes every decision.',
    );
    expect(region(html, 'quality-card').text).toContain('78');
    expect(region(html, 'quality-card').text).toContain('not affected by integrity signals');
    expect(region(html, 'integrity-card').text).toContain('Review suggested');
    controller.stop();
  });

  it('the two cards share the same width and height classes and the same order', async () => {
    const { controller } = setup(allReady);
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html = render(controller);
    const quality = region(html, 'quality-card');
    const integrity = region(html, 'integrity-card');
    expect(classOf(quality.open)).not.toBe('');
    expect(classOf(quality.open)).toBe(classOf(integrity.open));
    expect(html.indexOf('data-region="quality-card"')).toBeLessThan(
      html.indexOf('data-region="integrity-card"'),
    );
    controller.stop();
  });

  it('each card has one headline and the score never appears in the integrity card', async () => {
    const { controller } = setup(allReady);
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html = render(controller);
    for (const name of ['quality-card', 'integrity-card']) {
      const open = new RegExp(`data-region="${name}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? '';
      expect(open.match(/data-headline/g) ?? []).toHaveLength(1);
    }
    expect(region(html, 'integrity-card').text).not.toMatch(/\/\s*100/);
    expect(region(html, 'quality-card').text).not.toMatch(/Review suggested|Strong concern|Clear/);
    controller.stop();
  });

  it('a failing integrity call leaves the quality card unchanged, and the reverse', async () => {
    const good = setup(allReady);
    good.controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const baseline = region(render(good.controller), 'quality-card').text;
    good.controller.stop();

    const brokenIntegrity = setup({ ...allReady, integrity: () => json({ junk: true }, 200) });
    brokenIntegrity.controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html = render(brokenIntegrity.controller);
    expect(region(html, 'quality-card').text).toBe(baseline);
    expect(region(html, 'integrity-card').text).not.toMatch(/Review suggested/);
    expect(region(html, 'integrity-card').text).toContain('Not available right now');
    brokenIntegrity.controller.stop();

    const brokenQuality = setup({ ...allReady, quality: () => json({}, 500) });
    brokenQuality.controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html2 = render(brokenQuality.controller);
    expect(region(html2, 'quality-card').text).not.toContain('78');
    expect(region(html2, 'integrity-card').text).toContain('Review suggested');
    brokenQuality.controller.stop();
  });

  it("a pending card never shows another card's value", async () => {
    const { controller } = setup({
      ...allReady,
      quality: () => json({ state: 'pending' }),
      integrity: () => json({ state: 'pending' }),
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html = render(controller);
    expect(region(html, 'quality-card').text).toContain('Scoring...');
    expect(region(html, 'integrity-card').text).toContain('Pending');
    expect(html).not.toContain('data-region="integrity-evidence"');
    controller.stop();
  });

  it('shows the evidence sections only for a ready integrity card', async () => {
    const { controller } = setup(allReady);
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html = render(controller);
    expect(html).toContain('data-region="integrity-evidence"');
    expect(plain(html)).toContain('Signals by family');
    expect(plain(html)).toContain('Evidence timeline');
    expect(plain(html)).toContain('View start photo');
    expect(plain(html)).toContain('Viewing is logged.');
    expect(plain(html)).toContain('Pending review');
    controller.stop();
  });

  it('shows "No start photo" when the card says the photo is missing', async () => {
    const { controller } = setup({
      ...allReady,
      integrity: () => json({ ...INTEGRITY_READY, photoMissing: true }),
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const text = plain(render(controller));
    expect(text).toContain('No start photo');
    expect(text).not.toContain('View start photo');
    controller.stop();
  });
});

describe('ReportPage terminal errors', () => {
  it.each(['not_found', 'aal2_required', 'unauthorized'] as const)(
    'a %s answer for the header shows the fixed text and stops all three pollers',
    async (code) => {
      const status = code === 'not_found' ? 404 : code === 'unauthorized' ? 401 : 403;
      const { controller, urls } = setup({
        meta: () => json({ error: { code } }, status),
        quality: () => json({ state: 'pending' }),
        integrity: () => json({ state: 'pending' }),
      });
      controller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(urls).toHaveLength(3);
      const html = render(controller);
      expect(plain(html)).toContain(errorText(code));
      expect(plain(html)).not.toContain('Loading...');
      expect(html).not.toContain('data-region="quality-card"');
      expect(html).not.toContain('data-region="integrity-card"');
      await vi.advanceTimersByTimeAsync(300_000);
      expect(urls).toHaveLength(3);
      controller.stop();
    },
  );

  it('a transient header failure keeps retrying and the cards keep polling', async () => {
    let metaCalls = 0;
    const { controller, urls } = setup({
      meta: () => {
        metaCalls += 1;
        return metaCalls < 3 ? json({ error: { code: 'unavailable' } }, 503) : json(META);
      },
      quality: () => json({ state: 'pending' }),
      integrity: () => json({ state: 'pending' }),
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(plain(render(controller))).toContain('Loading...');
    await vi.advanceTimersByTimeAsync(6000);
    const html = render(controller);
    expect(plain(html)).toContain('Candidate 3');
    expect(html).toContain('data-region="quality-card"');
    expect(urls.filter((u) => u.endsWith(REPORT_ID))).toHaveLength(3);
    expect(urls.filter((u) => u.endsWith('/quality')).length).toBeGreaterThan(2);
    controller.stop();
  });

  it('a card never shows a failed state for readiness', async () => {
    const { controller } = setup({
      meta: () => json(META),
      quality: () => json({ error: { code: 'not_found' } }, 404),
      integrity: () => json(INTEGRITY_READY),
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html = render(controller);
    expect(region(html, 'quality-card').text).toContain('Not available right now');
    expect(plain(html)).not.toMatch(/failed/i);
    controller.stop();
  });
});

describe('ReportPage below cutoff (AT-D14)', () => {
  it('shows only the two sentences: no band, flags, timeline, rule table or photo', async () => {
    const { controller } = setup({
      ...allReady,
      integrity: () => json({ state: 'not_used_below_cutoff' }),
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html = render(controller);
    const card = region(html, 'integrity-card').text;
    expect(card).toContain('Not reviewed (below cutoff)');
    expect(card).toContain(
      'Integrity signals for candidates below the cutoff are not used in any decision',
    );
    expect(card).not.toMatch(/band|evidence strength|coverage|How the band is set/i);
    expect(html).not.toContain('data-region="integrity-evidence"');
    const text = plain(html);
    for (const word of [
      'Signals by family',
      'Evidence timeline',
      'Pending review',
      'Start photo',
      'Review suggested',
      'Strong concern',
    ]) {
      expect(text, word).not.toContain(word);
    }
    controller.stop();
  });
});

describe('ReportPage polling (AT-D17)', () => {
  it('polls only a pending card, every 3 s, and stops when it is ready', async () => {
    let qualityCalls = 0;
    const { controller, urls } = setup({
      meta: () => json(META),
      quality: () => {
        qualityCalls += 1;
        return qualityCalls < 3 ? json({ state: 'pending' }) : json(QUALITY_READY);
      },
      integrity: () => json(INTEGRITY_READY),
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(6000);
    await vi.advanceTimersByTimeAsync(60_000);
    const count = (suffix: string) => urls.filter((u) => u.endsWith(suffix)).length;
    expect(count('/quality')).toBe(3);
    expect(count('/integrity')).toBe(1);
    expect(urls.filter((u) => u.endsWith(REPORT_ID))).toHaveLength(1);
    controller.stop();
  });

  it('after 90 s says "Taking longer than usual" on the pending card only', async () => {
    const { controller } = setup({
      ...allReady,
      integrity: () => json({ state: 'pending' }),
    });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(plain(render(controller))).not.toContain('Taking longer than usual');
    await vi.advanceTimersByTimeAsync(91_000);
    const html = render(controller);
    expect(region(html, 'integrity-card').text).toContain('Taking longer than usual');
    expect(region(html, 'quality-card').text).not.toContain('Taking longer than usual');
    expect(plain(html)).not.toMatch(/failed/i);
    controller.stop();
  });
});
