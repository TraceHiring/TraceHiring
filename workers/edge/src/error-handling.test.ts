// Error handling of the edge app (spec §9.2, S3A-1): a thrown value that is not an Error still ends
// in the JSON 500, and nothing from the thrown value or the request reaches the response or a log
// line. The edge Worker has no reporter, so the log sink is the only place a value could leak to.
import { LogLine } from '@trace/shared/contracts';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

// Synthesised at run time, so no PII-shaped literal sits in the repo.
const email = (): string => ['pat', 'example.test'].join('@');
const mobile = (): string => ['98765', '43210'].join('');
const piiMessage = (): string => `failed for ${email()} and ${mobile()}`;

// Hono hands only Errors to onError; these are the values that would otherwise escape the app.
const throwValue = (value: unknown): never => {
  throw value;
};
const nonErrors: [string, () => unknown][] = [
  ['a string', () => piiMessage()],
  ['null', () => null],
  ['an object with an email field', () => ({ contact: email(), phone: mobile() })],
];

const request = (app: ReturnType<typeof createApp>, path = '/health', init?: RequestInit) =>
  app.request(`https://edge.test${path}`, init, { VERSION: 'abcdef1' } as Env);

describe('edge error handling', () => {
  it.each(nonErrors)(
    'answers the JSON 500 and logs once when a handler throws %s',
    async (_label, make) => {
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
    },
  );

  it('falls back to the static JSON 500 when the error handler itself throws', async () => {
    // Reading deps.sink throws, which happens inside onError while the log line is built.
    const deps = {
      now: (): Date => {
        throw new Error(piiMessage());
      },
      get sink(): (line: string) => void {
        throw new Error(piiMessage());
      },
    };
    const app = createApp(deps);

    const response = await request(app);

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('{"error":"internal"}');
  });

  it('keeps the request out of the response and the log on the error path and the 404 path', async () => {
    const token = ['tok', 'live', 'x9y8z7w6v5'].join('_');
    const session = ['sid', 'q1w2e3r4t5'].join('');
    const ip = ['192', '0', '2', '77'].join('.');
    const forwarded = ['192', '0', '2', '78'].join('.');
    const agent = ['SyntheticAgent', '7.7.7'].join('/');
    const query = `?email=${encodeURIComponent(email())}&token=${token}`;
    const headers = {
      authorization: `Bearer ${token}`,
      cookie: `sid=${session}`,
      'cf-connecting-ip': ip,
      'x-forwarded-for': forwarded,
      'user-agent': agent,
    };
    const values = [
      email(),
      encodeURIComponent(email()),
      mobile(),
      token,
      session,
      ip,
      forwarded,
      agent,
    ];
    const lines: string[] = [];
    const app = createApp({
      now: () => {
        throw new Error(piiMessage());
      },
      sink: (line) => lines.push(line),
    });

    const failed = await request(app, `/health${query}`, { headers });
    const missing = await request(app, `/nope${query}`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ contact: email(), phone: mobile() }),
    });

    expect(failed.status).toBe(500);
    expect(missing.status).toBe(404);
    const everything = [await failed.text(), await missing.text(), ...lines].join(' | ');
    for (const value of values) {
      expect(everything).not.toContain(value);
    }
  });
});
