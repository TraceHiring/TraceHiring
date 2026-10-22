// AT-9 wiring (spec §9.2, §13) and AT-B14 wiring (specs/m0b-tenancy.md §1.1 item 9b): the error and
// 404 handling itself lives in @trace/workers-http and is tested there (redaction, the release
// label, a failing reporter or sink, non-Error throws, HTTPException, no request data anywhere).
// This pins only that the api app uses it with the injected ErrorReporter: /health answers, an
// unknown path answers the JSON 404, and a thrown Error or non-Error answers the JSON 500, reaches
// the reporter once with the release and is logged once under the api service. M0a injects
// noopErrorReporter in src/index.ts; the Sentry adapter (before D1) implements the same interface,
// so nothing here changes when it is swapped in.
import { HealthResponse, LogLine } from '@trace/shared/contracts';
import { type ErrorReporter, type SerializedError } from '@trace/shared/log';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

interface Captured {
  err: SerializedError;
  ctx: { release: string } | undefined;
}

const spyReporter = () => {
  const captured: Captured[] = [];
  const reporter: ErrorReporter = {
    capture(err, ctx) {
      captured.push({ err, ctx });
    },
  };
  return { reporter, captured };
};

// Synthesised at run time, so no PII-shaped literal sits in the repo.
const email = (): string => ['pat', 'example.test'].join('@');
const mobile = (): string => ['98765', '43210'].join('');
const piiMessage = (): string => `failed for ${email()} and ${mobile()}`;

const throwValue = (value: unknown): never => {
  throw value;
};

const request = (app: ReturnType<typeof createApp>, path = '/health') =>
  app.request(`https://api.test${path}`, undefined, { VERSION: 'abcdef1' } as Env);

describe('api app wiring (AT-9, AT-B14)', () => {
  it('answers /health 200 as the api service, never cached, and reports nothing', async () => {
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, now: () => new Date('2026-10-12T00:00:00.000Z') });

    const response = await request(app);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(HealthResponse.parse(await response.json())).toMatchObject({
      status: 'ok',
      service: 'api',
      version: 'abcdef1',
    });
    expect(captured).toHaveLength(0);
  });

  it('answers an unknown path with the JSON 404, and reports and logs nothing', async () => {
    const lines: string[] = [];
    const { reporter, captured } = spyReporter();
    const app = createApp({ reporter, sink: (line) => lines.push(line) });

    const response = await request(app, '/nope');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"not_found"}');
    expect(captured).toHaveLength(0);
    expect(lines).toHaveLength(0);
  });

  it.each([
    ['an Error', () => new Error(piiMessage())],
    ['a string', () => piiMessage()],
    ['null', () => null],
    ['an object with an email field', () => ({ contact: email(), phone: mobile() })],
  ])(
    'answers the JSON 500, reports once and logs once under api when a handler throws %s',
    async (_label, make) => {
      const lines: string[] = [];
      const { reporter, captured } = spyReporter();
      const app = createApp({
        reporter,
        now: () => throwValue(make()),
        sink: (line) => lines.push(line),
      });

      const response = await request(app);

      expect(response.status).toBe(500);
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const text = await response.text();
      expect(text).toBe('{"error":"internal"}');
      expect(captured).toHaveLength(1);
      expect(captured[0]?.ctx).toEqual({ release: 'abcdef1' });
      expect(captured[0]?.err.name).toBe('Error');
      expect(lines).toHaveLength(1);
      expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({
        level: 'error',
        service: 'api',
        version: 'abcdef1',
        event: 'request.failed',
      });
      const everything = [text, ...lines, JSON.stringify(captured)].join(' | ');
      for (const sensitive of [email(), mobile(), 'failed for']) {
        expect(everything).not.toContain(sensitive);
      }
    },
  );
});
