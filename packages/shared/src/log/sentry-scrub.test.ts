// AT-9-sentry / AT-D22 (specs/m0-foundations.md §9.2 "Before D1: the Sentry adapter", §13;
// specs/d1-demo-slice.md D1-18): `beforeSend` and `beforeBreadcrumb` strip request, user and query
// data and exception values, and run the redactor over everything that remains. Events are shaped
// like the ones the Sentry SDKs build; every PII-like value is synthesised at test time.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REDACTED } from './redact.js';
import { scrubSentryBreadcrumb, scrubSentryEvent, stripQuery } from './sentry-scrub.js';
import { synth } from './synth.test-helpers.js';

const pii = () => ({
  email: synth.email(3),
  mobile: synth.mobile(4),
  aadhaar: synth.aadhaar(5),
  ip: synth.ipv4(6),
  word: `w${synth.word(7)}`,
  jwt: synth.jwt(8),
});

const values = (p: ReturnType<typeof pii>): string[] => Object.values(p);

const expectNone = (out: unknown, p: ReturnType<typeof pii>) => {
  const text = JSON.stringify(out);
  for (const v of values(p)) expect(text).not.toContain(v);
};

/** An error event as @sentry/cloudflare or @sentry/react builds it, with PII everywhere it can sit. */
const fullEvent = (p: ReturnType<typeof pii>) => ({
  event_id: '0123456789abcdef0123456789abcdef',
  timestamp: 1_760_000_000.5,
  level: 'error',
  platform: 'javascript',
  release: 'abcdef1234567890abcdef1234567890abcdef12',
  environment: 'staging',
  server_name: `${p.word}.host`,
  sdk: { name: 'sentry.javascript.cloudflare', version: '11.1.0' },
  message: `failed for ${p.email}`,
  logentry: { message: `user %s`, params: [p.email] },
  fingerprint: [p.word],
  modules: { [p.word]: '1.0.0' },
  request: {
    url: `https://api.test/v1/candidates?email=${p.email}&q=${p.word}#${p.word}`,
    method: 'POST',
    headers: { 'user-agent': p.word, 'cf-connecting-ip': p.ip, authorization: `Bearer ${p.jwt}` },
    cookies: { sb: p.jwt },
    query_string: `email=${p.email}`,
    data: { mobile: p.mobile, note: p.word },
    env: { REMOTE_ADDR: p.ip },
  },
  user: { id: p.word, email: p.email, ip_address: p.ip, username: p.word },
  tags: { route: '/v1/candidates', note: `call ${p.mobile}` },
  extra: { body: { aadhaar: p.aadhaar }, text: `mail ${p.email}` },
  contexts: {
    trace: {
      trace_id: 'fedcba9876543210fedcba9876543210',
      span_id: '0123456789abcdef',
      data: p.word,
    },
    runtime: { name: 'cloudflare' },
    request_info: { ip: p.ip },
  },
  exception: {
    values: [
      {
        type: 'TypeError',
        value: `Key (email)=(${p.email}) already exists`,
        mechanism: { type: 'auto.http.hono', handled: false, data: { url: p.word } },
        stacktrace: {
          frames: [
            {
              filename: `https://app.test/assets/index.js?token=${p.jwt}`,
              abs_path: `https://app.test/assets/index.js?token=${p.jwt}#${p.word}`,
              function: 'handle',
              lineno: 10,
              colno: 4,
              in_app: true,
              vars: { email: p.email },
              context_line: `const who = '${p.email}'`,
              pre_context: [p.word],
              post_context: [p.mobile],
            },
          ],
        },
      },
    ],
  },
  breadcrumbs: [
    {
      type: 'http',
      category: 'fetch',
      level: 'info',
      timestamp: 1_760_000_000,
      data: {
        url: `https://api.test/x?mobile=${p.mobile}`,
        method: 'GET',
        status_code: 500,
        body: p.word,
      },
    },
    {
      category: 'navigation',
      data: { from: `/candidates?q=${p.email}`, to: `/candidates/1?tab=${p.word}` },
    },
    { category: 'console', level: 'log', message: `user ${p.email} ${p.word}` },
  ],
});

describe('scrubSentryEvent (AT-9-sentry)', () => {
  it('keeps only the request URL without its query or fragment, and the method', () => {
    const p = pii();
    const out = scrubSentryEvent(fullEvent(p));
    expect(out?.request).toEqual({ url: 'https://api.test/v1/candidates', method: 'POST' });
    expectNone(out?.request, p);
  });

  it('deletes the user, the message, the fingerprint, the server name and the module list', () => {
    const p = pii();
    const out = scrubSentryEvent(fullEvent(p)) as Record<string, unknown>;
    for (const key of ['user', 'message', 'logentry', 'fingerprint', 'server_name', 'modules']) {
      expect(out).not.toHaveProperty(key);
    }
  });

  it("replaces each exception value with serializeError's code from the original error", () => {
    const p = pii();
    const original = Object.assign(new Error(`dup ${p.email}`), { code: '23505' });
    const out = scrubSentryEvent(fullEvent(p), { originalException: original });
    expect(out?.exception?.values?.[0]?.value).toBe('23505');
    expect(out?.exception?.values?.[0]?.type).toBe('TypeError');
  });

  it('uses the code of a serialised error passed in the hint data (the adapter path)', () => {
    const p = pii();
    const out = scrubSentryEvent(fullEvent(p), {
      data: { serializedError: { name: 'Error', code: 'ECONNRESET' } },
    });
    expect(out?.exception?.values?.[0]?.value).toBe('ECONNRESET');
  });

  it('replaces each exception value with [REDACTED] when there is no code', () => {
    const p = pii();
    for (const hint of [
      undefined,
      {},
      { originalException: `failed ${p.email}` },
      { data: p.word },
    ]) {
      const out = scrubSentryEvent(fullEvent(p), hint);
      expect(out?.exception?.values?.[0]?.value).toBe(REDACTED);
    }
  });

  it('reports a type that is not an error class name as Error', () => {
    const p = pii();
    const event = fullEvent(p);
    event.exception.values[0]!.type = p.email;
    const out = scrubSentryEvent(event);
    expect(out?.exception?.values?.[0]?.type).toBe('Error');
  });

  it('keeps frame locations without query strings, and drops frame variables and source lines', () => {
    const p = pii();
    const frame = scrubSentryEvent(fullEvent(p))?.exception?.values?.[0]?.stacktrace?.frames?.[0];
    expect(frame).toEqual({
      filename: 'https://app.test/assets/index.js',
      abs_path: 'https://app.test/assets/index.js',
      function: 'handle',
      lineno: 10,
      colno: 4,
      in_app: true,
    });
  });

  it('keeps the mechanism type and handled flag only', () => {
    const p = pii();
    const mechanism = scrubSentryEvent(fullEvent(p))?.exception?.values?.[0]?.mechanism;
    expect(mechanism).toEqual({ type: 'auto.http.hono', handled: false });
  });

  it('runs the redactor over tags, extra and contexts', () => {
    const p = pii();
    const out = scrubSentryEvent(fullEvent(p)) as Record<string, unknown>;
    expectNone([out['tags'], out['extra'], out['contexts']], p);
    expect((out['tags'] as Record<string, unknown>)['route']).toBe('/v1/candidates');
  });

  it('keeps the trace context ids only', () => {
    const p = pii();
    const out = scrubSentryEvent(fullEvent(p)) as { contexts: Record<string, unknown> };
    expect(out.contexts['trace']).toEqual({
      trace_id: 'fedcba9876543210fedcba9876543210',
      span_id: '0123456789abcdef',
    });
  });

  it('keeps the event id, timestamp, level, platform, release, environment and sdk as they are', () => {
    const p = pii();
    const out = scrubSentryEvent(fullEvent(p));
    expect(out).toMatchObject({
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: 1_760_000_000.5,
      level: 'error',
      platform: 'javascript',
      release: 'abcdef1234567890abcdef1234567890abcdef12',
      environment: 'staging',
      sdk: { name: 'sentry.javascript.cloudflare', version: '11.1.0' },
    });
  });

  it('drops a release, environment or event id that is not in its expected shape', () => {
    const p = pii();
    const event = { ...fullEvent(p), release: p.mobile, environment: p.email, event_id: p.word };
    const out = scrubSentryEvent(event) as Record<string, unknown>;
    expect(out).not.toHaveProperty('release');
    expect(out).not.toHaveProperty('environment');
    expect(out).not.toHaveProperty('event_id');
  });

  it('scrubs the breadcrumbs it carries', () => {
    const p = pii();
    const out = scrubSentryEvent(fullEvent(p));
    expect(out?.breadcrumbs).toEqual([
      {
        type: 'http',
        category: 'fetch',
        level: 'info',
        timestamp: 1_760_000_000,
        data: { url: 'https://api.test/x', method: 'GET', status_code: 500 },
      },
      { category: 'navigation', data: { from: '/candidates', to: '/candidates/1' } },
      { category: 'console', level: 'log' },
    ]);
  });

  it('leaves nothing synthesised anywhere in the event', () => {
    const p = pii();
    const original = Object.assign(new Error(`dup ${p.email}`), { code: '23505' });
    expectNone(scrubSentryEvent(fullEvent(p), { originalException: original }), p);
  });

  it('does not change the event it is given', () => {
    const p = pii();
    const event = fullEvent(p);
    const before = JSON.stringify(event);
    scrubSentryEvent(event);
    expect(JSON.stringify(event)).toBe(before);
  });

  it('drops the event (returns null) when it cannot be read, and never throws', () => {
    const hostile = {
      get exception(): unknown {
        throw new Error('getter');
      },
    };
    expect(scrubSentryEvent(hostile)).toBeNull();
    expect(scrubSentryEvent(null as unknown as object)).toBeNull();
  });

  it('never throws and never passes a pattern-shaped value through, for any event shape', () => {
    // A free word is not a pattern: under a free-form key (tags, extra) the redactor keeps it, so
    // the property covers the values the redactor recognises; the fixed tests above cover words.
    const p = { ...pii(), word: synth.email(9) };
    const secret = fc.constantFrom(...values(p));
    const leaf = fc.oneof(secret, fc.string(), fc.integer(), fc.boolean(), fc.constant(null));
    const tree = fc.letrec((tie) => ({
      node: fc.oneof(
        { depthSize: 'small' },
        leaf,
        fc.array(tie('node'), { maxLength: 4 }),
        fc.dictionary(fc.oneof(fc.string(), secret), tie('node'), { maxKeys: 4 }),
      ),
    })).node;
    const key = fc.constantFrom(
      'request',
      'user',
      'tags',
      'extra',
      'contexts',
      'exception',
      'breadcrumbs',
      'message',
      'release',
      'environment',
      'event_id',
      'sdk',
      'level',
      'platform',
      'timestamp',
    );
    fc.assert(
      fc.property(fc.dictionary(key, tree), fc.option(tree), (event, original) => {
        const out = scrubSentryEvent(event, { originalException: original, data: original });
        expectNone(out, p);
      }),
      { numRuns: 300 },
    );
  });
});

describe('scrubSentryBreadcrumb (AT-9-sentry)', () => {
  it('keeps the type, category, level and timestamp, and URLs without queries', () => {
    const p = pii();
    expect(
      scrubSentryBreadcrumb({
        type: 'http',
        category: 'xhr',
        level: 'warning',
        timestamp: 1_760_000_001,
        message: `GET ${p.email}`,
        data: {
          url: `https://api.test/a?x=${p.word}`,
          method: 'GET',
          status_code: 404,
          body: p.mobile,
        },
      }),
    ).toEqual({
      type: 'http',
      category: 'xhr',
      level: 'warning',
      timestamp: 1_760_000_001,
      data: { url: 'https://api.test/a', method: 'GET', status_code: 404 },
    });
  });

  it('runs the redactor over the URL path', () => {
    const p = pii();
    const out = scrubSentryBreadcrumb({
      category: 'fetch',
      data: { url: `https://api.test/u/${p.email}` },
    });
    expectNone(out, p);
  });

  it('drops a category or level that is not a plain label', () => {
    const p = pii();
    expect(scrubSentryBreadcrumb({ category: `x ${p.email}`, level: p.word })).toEqual({});
  });

  it('drops the breadcrumb (returns null) when it cannot be read', () => {
    const hostile = {
      get data(): unknown {
        throw new Error('getter');
      },
    };
    expect(scrubSentryBreadcrumb(hostile)).toBeNull();
  });
});

describe('stripQuery', () => {
  it.each([
    ['https://a.test/p?q=1#h', 'https://a.test/p'],
    ['https://a.test/p#h?q', 'https://a.test/p'],
    ['/p?x=1', '/p'],
    ['https://a.test/p', 'https://a.test/p'],
    ['', ''],
  ])('%s -> %s', (input, output) => {
    expect(stripQuery(input)).toBe(output);
  });
});
