// Wiring of the edge app (AT-B14, specs/m0b-tenancy.md §1.1 item 9b): the error and 404 handling
// itself lives in @trace/workers-http and is tested there (non-Error throws, the static 500, no
// request data in a log or a response, HTTPException). This pins only that the edge app uses it:
// /health answers, an unknown path answers the JSON 404, and a thrown Error or a thrown non-Error
// answers the JSON 500 and is logged once under the edge service. The edge Worker has no reporter,
// so the log sink is the only place a value could leak to.
import { HealthResponse, LogLine } from '@trace/shared/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

// Synthesised at run time, so no PII-shaped literal sits in the repo.
const email = (): string => ['pat', 'example.test'].join('@');
const mobile = (): string => ['98765', '43210'].join('');
const piiMessage = (): string => `failed for ${email()} and ${mobile()}`;

const throwValue = (value: unknown): never => {
  throw value;
};

const request = (app: ReturnType<typeof createApp>, path = '/health') =>
  app.request(`https://edge.test${path}`, undefined, { VERSION: 'abcdef1' } as Env);

describe('edge app wiring (AT-B14)', () => {
  it('answers /health 200 as the edge service, never cached', async () => {
    const app = createApp({ now: () => new Date('2026-10-12T00:00:00.000Z') });

    const response = await request(app);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(HealthResponse.parse(await response.json())).toMatchObject({
      status: 'ok',
      service: 'edge',
      version: 'abcdef1',
    });
  });

  it('answers an unknown path with the JSON 404', async () => {
    const lines: string[] = [];
    const app = createApp({ sink: (line) => lines.push(line) });

    const response = await request(app, '/nope');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"not_found"}');
    expect(lines).toHaveLength(0);
  });

  it.each([
    ['an Error', () => new Error(piiMessage())],
    ['a string', () => piiMessage()],
    ['null', () => null],
    ['an object with an email field', () => ({ contact: email(), phone: mobile() })],
  ])('answers the JSON 500 and logs once under edge when a handler throws %s', async (_l, make) => {
    const lines: string[] = [];
    const app = createApp({ now: () => throwValue(make()), sink: (line) => lines.push(line) });

    const response = await request(app);

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).toBe('{"error":"internal"}');
    expect(lines).toHaveLength(1);
    expect(LogLine.parse(JSON.parse(lines[0] ?? ''))).toMatchObject({
      level: 'error',
      service: 'edge',
      version: 'abcdef1',
      event: 'request.failed',
    });
    for (const sensitive of [email(), mobile(), 'failed for']) {
      expect([text, ...lines].join(' | ')).not.toContain(sensitive);
    }
  });
});

describe('edge app hands the shared handling only the log sink (B5-SEC2)', () => {
  it('never calls a reporter that is smuggled into the deps, when a route throws', async () => {
    const captured: unknown[] = [];
    const reporter = {
      capture(...args: unknown[]) {
        captured.push(args);
      },
    };
    const lines: string[] = [];
    // The cast stands in for any caller that gets a reporter past the type; the edge has none.
    const deps = {
      now: () => throwValue(new Error(piiMessage())),
      sink: (line: string) => lines.push(line),
      reporter,
    };
    const app = createApp(deps as never);

    const response = await request(app);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"internal"}');
    expect(captured).toHaveLength(0);
    expect(lines).toHaveLength(1);
  });

  it('reads the sink at error time, so a throwing sink getter still ends in the static 500', async () => {
    const deps = {
      now: () => throwValue(new Error(piiMessage())),
      get sink(): (line: string) => void {
        throw new Error(piiMessage());
      },
    };
    const app = createApp(deps);

    const response = await request(app);

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"internal"}');
  });
});
