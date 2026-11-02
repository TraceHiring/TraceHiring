// DC-D5 part (c): the media link in real Chromium under the recruiter's real CSP, plus a real-HTTP burn check against
// `wrangler dev`. Synthetic data only. Evidence is written to .out/d5-evidence-<project>.json.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  OUT_DIR,
  SITE_ORIGIN,
  TEMPLATE_SOURCE,
  WORKER_ORIGIN,
  recruiterHeaders,
} from '../support/env.ts';
import { issueLink, seedSyntheticJpeg, setConfig, stats, writeEvidence } from '../support/media.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
const redact = (s: string) => s.replace(/(\/media\/)[0-9a-f-]{36}\?\S*/g, '$1[jti]?[redacted]');

function watch(page: Page) {
  const responses: Array<
    Promise<{ status: number; method: string; headers: Record<string, string> }>
  > = [];
  const consoleMsgs: Array<{ type: string; text: string }> = [];
  page.on('response', (r) => {
    if (r.url().startsWith(`${WORKER_ORIGIN}/media/`)) {
      responses.push(
        r
          .allHeaders()
          .then((headers) => ({ status: r.status(), method: r.request().method(), headers })),
      );
    }
  });
  page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: redact(m.text()) }));
  return { responses: () => Promise.all(responses), consoleMsgs };
}

const evidence: Record<string, unknown> = {};
let photoBytes = 0;

test.describe.configure({ mode: 'serial' });

test.describe('@d5 media link in Chromium under the recruiter CSP', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    photoBytes = await seedSyntheticJpeg(page);
    await page.close();
  });

  test.beforeEach(async () => {
    await setConfig({ allowedOrigins: null, corp: 'same-origin' });
    await stats(true);
  });

  test.afterAll(() => {
    writeEvidence(`d5-evidence-${test.info().project.name}.json`, { photoBytes, ...evidence });
  });

  test('designed path: CORS fetch, createImageBitmap, canvas watermark, data: URL, zero CSP violations', async ({
    page,
  }, testInfo) => {
    const w = watch(page);
    const doc = await page.goto(`${SITE_ORIGIN}/`);
    const docHeaders = await (doc as NonNullable<typeof doc>).allHeaders();
    expect(docHeaders['content-security-policy']).toBe(recruiterHeaders('strict').csp);

    const link = await issueLink();
    const res = (await page.evaluate((u) => (window as any).d5.fetchAndWatermark(u), link)) as any;

    expect(res.status).toBe(200);
    expect(res.type).toBe('cors');
    expect(res.blobType).toBe('image/jpeg');
    expect(res.tainted).toBe(false); // the canvas is NOT tainted: CORS fetch + blob + createImageBitmap
    expect(res.changedPixels).toBeGreaterThan(1000); // the watermark really changed the pixels
    expect(res.dataDisplay).toBe('loaded');
    expect(res.dataImg).toEqual({ w: 480, h: 320 });
    expect(res.dataUrlPrefix).toBe('data:image/jpeg;base64,');
    expect(res.visibleHeaders['content-type']).toBe('image/jpeg');
    expect(res.visibleHeaders['cache-control']).toBe('no-store');
    expect(res.visibleHeaders['access-control-allow-origin']).toBeNull(); // never exposed to scripts
    // Without Access-Control-Expose-Headers the page only sees the CORS-safelisted response headers.
    expect(res.visibleHeaders['x-content-type-options']).toBeNull();
    expect(res.visibleHeaders['referrer-policy']).toBeNull();

    const violations = (await page.evaluate(() => (window as any).d5.violations())) as unknown[];
    expect(violations).toEqual([]);

    const [media] = await w.responses();
    const h = (media as NonNullable<typeof media>).headers;
    expect(media?.status).toBe(200);
    expect(media?.method).toBe('GET');
    expect(h['content-type']).toBe('image/jpeg');
    expect(h['cache-control']).toBe('no-store');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['access-control-allow-origin']).toBe(SITE_ORIGIN);
    expect(h['vary']).toBe('Origin');
    expect(h['cross-origin-resource-policy']).toBe('same-origin');
    expect(h['access-control-allow-credentials']).toBeUndefined();
    expect(Number(h['content-length'])).toBe(photoBytes);

    // What the browser sent: a plain GET, cross-site, CORS mode, an Origin, no Referer, no cookie, no Authorization.
    const seen = await stats();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: 'GET',
      status: 200,
      origin: SITE_ORIGIN,
      hasReferer: false,
      hasAuthorization: false,
      hasCookie: false,
      secFetchSite: 'cross-site',
      secFetchMode: 'cors',
      secFetchDest: 'empty',
    });
    expect(seen.some((s) => s.method === 'OPTIONS')).toBe(false); // no preflight for a plain GET

    expect(w.consoleMsgs.filter((m) => m.type === 'error')).toEqual([]); // before the replay below

    // Replay of the same link: a CORS-readable 404 with the generic body (no bytes).
    const replay = (await page.evaluate(
      (u) => (window as any).d5.fetchAndWatermark(u),
      link,
    )) as any;
    expect(replay.status).toBe(404);
    expect(replay.type).toBe('cors');
    expect(JSON.parse(replay.errorBody)).toEqual({ error: { code: 'not_found' } });

    await page.screenshot({ path: path.join(OUT_DIR, `d5-designed-${testInfo.project.name}.png`) });
    evidence['designed'] = {
      templateSource: TEMPLATE_SOURCE,
      csp: docHeaders['content-security-policy'],
      documentHeaders: docHeaders,
      requestSeenByWorker: seen[0],
      responseHeaders: h,
      pageVisibleHeaders: res.visibleHeaders,
      canvas: { size: res.size, changedPixels: res.changedPixels, tainted: res.tainted },
      display: {
        route: 'data:',
        prefix: res.dataUrlPrefix,
        length: res.dataUrlLength,
        img: res.dataImg,
      },
      violations,
      replay: { status: replay.status, body: replay.errorBody },
    };
  });

  test('blob: display is blocked by img-src (the recruiter CSP allows data:, not blob:)', async ({
    page,
  }) => {
    const w = watch(page);
    await page.goto(`${SITE_ORIGIN}/`);
    const res = (await page.evaluate(
      (u) => (window as any).d5.fetchAndWatermark(u, { display: 'blob' }),
      await issueLink(),
    )) as any;
    expect(res.status).toBe(200);
    expect(res.tainted).toBe(false);
    expect(res.blobUrlScheme).toBe('blob:');
    expect(res.blobDisplay).toBe('error');
    const violations = (await page.evaluate(() => (window as any).d5.violations())) as any[];
    expect(violations).toHaveLength(1);
    expect(violations[0].effectiveDirective).toBe('img-src');
    expect(violations[0].blockedURI).toBe('blob'); // the event reports only the scheme
    expect(w.consoleMsgs.some((m) => m.type === 'error' && /img-src/.test(m.text))).toBe(true);
    evidence['blobRoute'] = { result: res.blobDisplay, violations };
  });

  test('the unmodified template blocks the media fetch with connect-src (so the addition is required)', async ({
    page,
  }) => {
    const w = watch(page);
    const doc = await page.goto(`${SITE_ORIGIN}/unmodified`);
    const csp = (await (doc as NonNullable<typeof doc>).allHeaders())['content-security-policy'];
    expect(csp).not.toContain(WORKER_ORIGIN);
    const link = await issueLink();
    const res = (await page.evaluate((u) => (window as any).d5.tryFetch(u), link)) as any;
    expect(res).toMatchObject({ ok: false, error: 'TypeError' });
    const violations = (await page.evaluate(() => (window as any).d5.violations())) as any[];
    expect(violations).toHaveLength(1);
    expect(violations[0].effectiveDirective).toBe('connect-src');
    expect(violations[0].blockedHadFullLink).toBe(true); // blockedURI holds the whole link: never forward CSP reports
    expect(await stats()).toEqual([]); // CSP blocked it before the network, so the Worker never saw it
    // ... and so the link is unburnt: it still works from the page that has the directive.
    await page.goto(`${SITE_ORIGIN}/`);
    const ok = (await page.evaluate((u) => (window as any).d5.tryFetch(u), link)) as any;
    expect(ok).toMatchObject({ ok: true, status: 200, imageBitmap: 'ok' });
    evidence['unmodifiedTemplate'] = { csp, result: res, violations };
    expect(w.consoleMsgs.some((m) => /connect-src/.test(m.text))).toBe(true);
  });

  test('an <img> pointed at the Worker is blocked by img-src (before the network): connect-src alone is the design', async ({
    page,
  }) => {
    await page.goto(`${SITE_ORIGIN}/`);
    const link = await issueLink();
    const a = (await page.evaluate((u) => (window as any).d5.imgTaint(u, false), link)) as any;
    const b = (await page.evaluate((u) => (window as any).d5.imgTaint(u, true), link)) as any;
    expect(a.load).toBe('error');
    expect(b.load).toBe('error');
    const violations = (await page.evaluate(() => (window as any).d5.violations())) as any[];
    expect(violations.map((v) => v.effectiveDirective)).toEqual(['img-src', 'img-src']);
    expect(await stats()).toEqual([]);
    const ok = (await page.evaluate((u) => (window as any).d5.tryFetch(u), link)) as any;
    expect(ok.status).toBe(200);
    evidence['imgElementUnderStrictCsp'] = { results: [a, b], violations };
  });

  test('CORS: an origin missing from ALLOWED_ORIGINS fails the fetch (a TypeError) and the link is already burnt', async ({
    page,
  }) => {
    const w = watch(page);
    await page.goto(`${SITE_ORIGIN}/`);
    await setConfig({ allowedOrigins: ['http://localhost:9'] });
    const link = await issueLink();
    const res = (await page.evaluate((u) => (window as any).d5.tryFetch(u), link)) as any;
    expect(res).toMatchObject({ ok: false, error: 'TypeError' });
    expect(await page.evaluate(() => (window as any).d5.violations())).toEqual([]); // CORS is not a CSP matter
    expect(w.consoleMsgs.some((m) => m.type === 'error' && /CORS policy/.test(m.text))).toBe(true);
    const seen = await stats();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: 'GET', status: 200 }); // the Worker served it; the browser hid it
    await setConfig({ allowedOrigins: null });
    const again = (await page.evaluate((u) => (window as any).d5.tryFetch(u), link)) as any;
    expect(again).toMatchObject({ ok: true, status: 404 });
    evidence['corsMissingOrigin'] = { firstFetch: res, afterFix: again };
  });

  test('a no-cors fetch is refused by CORP same-origin, and without CORP it is opaque and unusable', async ({
    page,
  }) => {
    await page.goto(`${SITE_ORIGIN}/`);
    // With the default Cross-Origin-Resource-Policy: same-origin the browser fails a cross-origin no-cors fetch.
    const withCorp = (await page.evaluate(
      (u) => (window as any).d5.tryFetch(u, { mode: 'no-cors' }),
      await issueLink(),
    )) as any;
    expect(withCorp).toMatchObject({ ok: false, error: 'TypeError' });
    // Without CORP the response is opaque: no bytes for the page, and createImageBitmap cannot use it.
    await setConfig({ corp: null });
    await stats(true);
    const opaque = (await page.evaluate(
      (u) => (window as any).d5.tryFetch(u, { mode: 'no-cors' }),
      await issueLink(),
    )) as any;
    expect(opaque).toMatchObject({ ok: true, type: 'opaque', blobSize: 0 });
    expect(opaque.imageBitmap).not.toBe('ok');
    const seen = await stats();
    expect(seen[0]).toMatchObject({ secFetchMode: 'no-cors', origin: null });
    evidence['noCorsFetch'] = { withCorp, withoutCorp: opaque, workerSaw: seen[0] };
  });

  test('an Authorization header makes a preflight the Worker refuses, and the link stays usable', async ({
    page,
  }) => {
    await page.goto(`${SITE_ORIGIN}/`);
    const link = await issueLink();
    const blocked = (await page.evaluate(
      (u) => (window as any).d5.tryFetch(u, { headers: { Authorization: 'Bearer synthetic' } }),
      link,
    )) as any;
    expect(blocked).toMatchObject({ ok: false, error: 'TypeError' });
    const seen = await stats();
    expect(seen.map((s) => `${s.method} ${s.status}`)).toEqual(['OPTIONS 404']);
    const ok = (await page.evaluate((u) => (window as any).d5.tryFetch(u), link)) as any;
    expect(ok).toMatchObject({ ok: true, status: 200, imageBitmap: 'ok' });
    evidence['authorizationHeader'] = { blocked, workerSaw: seen };
  });

  test('tainted canvas: an <img> without crossorigin taints it, with crossorigin plus ACAO it does not (img-src variant)', async ({
    page,
  }) => {
    await page.goto(`${SITE_ORIGIN}/img-allowed`);
    // (1) CORP same-origin (the default) blocks a no-cors <img> even though the CSP allows it.
    const blockedByCorp = (await page.evaluate(
      (u) => (window as any).d5.imgTaint(u, false),
      await issueLink(),
    )) as any;
    expect(blockedByCorp.load).toBe('error');
    // (2) Without CORP the no-cors <img> loads, and the canvas it is drawn on is tainted.
    await setConfig({ corp: null });
    const tainted = (await page.evaluate(
      (u) => (window as any).d5.imgTaint(u, false),
      await issueLink(),
    )) as any;
    expect(tainted).toMatchObject({
      load: 'loaded',
      toDataURL: 'SecurityError',
      getImageData: 'SecurityError',
    });
    // (3) crossorigin=anonymous makes it a CORS request; with ACAO the canvas stays clean (CORP is not applied to CORS).
    await setConfig({ corp: 'same-origin' });
    const clean = (await page.evaluate(
      (u) => (window as any).d5.imgTaint(u, true),
      await issueLink(),
    )) as any;
    expect(clean).toMatchObject({ load: 'loaded', toDataURL: 'ok', getImageData: 'ok' });
    // (4) crossorigin=anonymous but no ACAO for this origin: the image does not load at all.
    await setConfig({ allowedOrigins: ['http://localhost:9'] });
    const noAcao = (await page.evaluate(
      (u) => (window as any).d5.imgTaint(u, true),
      await issueLink(),
    )) as any;
    expect(noAcao.load).toBe('error');
    // (5) The designed fetch path also works on this variant page and also under CORP same-origin.
    await setConfig({ allowedOrigins: null });
    const viaFetch = (await page.evaluate(
      (u) => (window as any).d5.fetchAndWatermark(u),
      await issueLink(),
    )) as any;
    expect(viaFetch).toMatchObject({ status: 200, tainted: false, dataDisplay: 'loaded' });
    evidence['taintedCanvas'] = {
      blockedByCorp,
      tainted,
      clean,
      noAcao,
      viaFetch: viaFetch.status,
    };
  });

  test('real HTTP against wrangler dev: 25 concurrent fetches of one link give one 200 and 24 404', async () => {
    const rounds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const link = await issueLink();
      const rs = await Promise.all(
        Array.from({ length: 25 }, () => fetch(link, { headers: { origin: SITE_ORIGIN } })),
      );
      const bodies = await Promise.all(rs.map((r) => r.arrayBuffer()));
      const ok = rs
        .map((r, k) => ({ s: r.status, n: bodies[k]?.byteLength ?? 0 }))
        .filter((x) => x.s === 200);
      expect(ok).toHaveLength(1);
      expect(ok[0]?.n).toBe(photoBytes);
      expect(rs.filter((r) => r.status === 404)).toHaveLength(24);
      expect((await fetch(link)).status).toBe(404);
      rounds.push(`${ok.length}x200/${rs.filter((r) => r.status === 404).length}x404`);
    }
    evidence['httpConcurrency'] = rounds;
  });
});
