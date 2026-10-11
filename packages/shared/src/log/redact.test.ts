import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as publicLog from './index.js';
import {
  MAX_DEPTH,
  MAX_STRING,
  REDACTED,
  TRUNCATED,
  applyPatterns,
  canonical,
  redact,
  redactString,
} from './redact.js';
import { synth } from './synth.test-helpers.js';

const stems = [
  'name',
  'email',
  'phone',
  'mobile',
  'whatsapp',
  'address',
  'pincode',
  'dob',
  'birth',
  'age',
  'gender',
  'aadhaar',
  'aadhar',
  'pan',
  'passport',
  'voter',
  'epic',
  'caste',
  'religion',
  'disability',
  'college',
  'ip',
  'forwardedfor',
  'connectingip',
  'realip',
  'otp',
  'code',
  'password',
  'passcode',
  'pin',
  'token',
  'secret',
  'key',
  'authorization',
  'cookie',
  'session',
  'nonce',
  'invite',
  'signedurl',
  'jwt',
  'answer',
  'finaltext',
  'transcript',
  'scratchpad',
  'jdtext',
  'photo',
  'image',
  'audio',
  'video',
  'accommodation',
];

describe('key rules', () => {
  it.each(stems)('redacts any key containing the stem "%s"', (stem) => {
    const variants = [stem, `candidate_${stem}`, `${stem.toUpperCase()}-Value`, `x ${stem}`];
    for (const key of variants) {
      expect(redact({ [key]: 'v' })).toEqual({ [key]: REDACTED });
    }
  });

  it('normalises case, underscores, dashes and spaces before matching', () => {
    expect(redact({ 'Forwarded-For': 'v', Signed_URL: 'v', 'final text': 'v' })).toEqual({
      'Forwarded-For': REDACTED,
      Signed_URL: REDACTED,
      'final text': REDACTED,
    });
  });

  it('keeps the allow-listed exact keys that contain a stem', () => {
    const id = '7f3c1e2a-5b6d-4c8e-9f01-23456789abcd';
    const input = { orgId: id, requestId: id, sessionId: id, keyVersion: 3, org_id: id };
    expect(redact(input)).toEqual(input);
  });

  it('redacts a whole subtree under a matching key', () => {
    expect(redact({ answer: { text: 'x', parts: ['y'] } })).toEqual({ answer: REDACTED });
  });

  it('redacts nested keys and keys inside arrays', () => {
    expect(redact({ a: [{ email: 'x' }], b: { c: { token: 'y' } } })).toEqual({
      a: [{ email: REDACTED }],
      b: { c: { token: REDACTED } },
    });
  });
});

describe('value patterns', () => {
  const m = synth.mobile();
  const cases: [string, string][] = [
    ['email', synth.email()],
    ['UPI id', synth.upi()],
    ['mobile', m],
    ['mobile +91 spaced', `+91 ${m.slice(0, 5)} ${m.slice(5)}`],
    ['mobile 0091', `0091${m}`],
    ['mobile 91 dashed', `91-${m.slice(0, 3)}-${m.slice(3, 6)}-${m.slice(6)}`],
    ['mobile leading 0', `0${m}`],
    ['Aadhaar', synth.aadhaar()],
    ['Aadhaar 4-4-4', synth.aadhaar().replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3')],
    ['VID', synth.vid()],
    ['PAN', synth.pan()],
    ['passport', synth.passport()],
    ['voter EPIC', synth.epic()],
    ['IFSC', synth.ifsc()],
    ['IPv4', synth.ipv4()],
    ['IPv6', synth.ipv6()],
    ['JWT', synth.jwt()],
    ['Bearer', `Bearer ${synth.base64()}`],
    ['secret key', synth.secretKey()],
    ['postgres URL', synth.dbUrl()],
    ['long hex', synth.hex()],
    ['long base64', synth.base64()],
  ];

  it.each(cases)('redacts a %s inside a string', (_label, value) => {
    const out = redactString(`before ${value} after`);
    expect(out).not.toContain(value);
    expect(out).toContain(REDACTED);
    expect(out.startsWith('before ')).toBe(true);
  });

  it('redacts bank account numbers next to account keywords', () => {
    const acct = synth.account();
    expect(redactString(`account no: ${acct}`)).not.toContain(acct);
    expect(redactString(`A/c ${acct}`)).not.toContain(acct);
  });

  it('redacts PII-shaped numbers held as numbers', () => {
    expect(redact({ v: Number(synth.mobile()) })).toEqual({ v: REDACTED });
    expect(redact({ v: Number(synth.aadhaar()) })).toEqual({ v: REDACTED });
    expect(redact({ v: 42 })).toEqual({ v: 42 });
  });

  it('leaves ordinary text, UUIDs and ISO times alone', () => {
    const s = 'session started 7f3c1e2a-5b6d-4c8e-9f01-23456789abcd at 2026-10-11T12:30:45.000Z';
    expect(redactString(s)).toBe(s);
  });
});

describe('caps and odd values', () => {
  it('replaces strings over the cap with [TRUNCATED], never passing input through', () => {
    expect(redact({ v: 'x'.repeat(MAX_STRING + 1) })).toEqual({ v: TRUNCATED });
    expect(redact({ v: 'x'.repeat(MAX_STRING) })).toEqual({ v: 'x'.repeat(MAX_STRING) });
  });

  it('truncates objects deeper than the depth cap', () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < MAX_DEPTH + 2; i++) deep = { n: deep };
    const out = JSON.stringify(redact(deep));
    expect(out).toContain(TRUNCATED);
    expect(out).not.toContain('leaf');
  });

  it('is cycle-safe', () => {
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(() => redact(a)).not.toThrow();
    expect(JSON.stringify(redact(a))).toContain('[CIRCULAR]');
  });

  it('turns errors into serialised errors without their message', () => {
    const out = JSON.stringify(redact({ err: new Error(`duplicate key ${synth.email()}`) }));
    expect(out).not.toContain('duplicate key');
    expect(out).toContain('"name":"Error"');
  });
});

const depthOf = (v: unknown): number =>
  v !== null && typeof v === 'object'
    ? 1 + Math.max(0, ...Object.values(v as Record<string, unknown>).map(depthOf))
    : 0;
const strings = (v: unknown): string[] =>
  typeof v === 'string'
    ? [v]
    : v !== null && typeof v === 'object'
      ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [k, ...strings(x)])
      : [];

describe('properties', () => {
  it('never throws, is idempotent, respects the caps and is JSON-safe', () => {
    fc.assert(
      fc.property(
        fc.anything({
          maxDepth: 9,
          withBigInt: true,
          withDate: true,
          withMap: true,
          withSet: true,
          withTypedArray: true,
          withSparseArray: true,
          withNullPrototype: true,
        }),
        (input) => {
          const once = redact(input);
          expect(redact(once)).toEqual(once);
          expect(depthOf(once)).toBeLessThanOrEqual(MAX_DEPTH);
          for (const s of strings(once)) expect(s.length).toBeLessThanOrEqual(MAX_STRING);
          expect(() => JSON.stringify(once)).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never outputs a string longer than the cap from the input', () => {
    fc.assert(
      fc.property(fc.string({ minLength: MAX_STRING + 1, maxLength: MAX_STRING + 50 }), (s) => {
        expect(redact({ v: s })).toEqual({ v: TRUNCATED });
      }),
      { numRuns: 50 },
    );
  });
});

describe('security review regressions (S1.7)', () => {
  const PATTERN_BUDGET_MS = 50;
  const adversarial = [
    'account' + '.'.repeat(1992),
    'bank' + ' :#.-'.repeat(398),
    'a'.repeat(1999) + '@',
    '1 '.repeat(999),
    '9-'.repeat(999),
    ':'.repeat(1999),
    'A1a'.repeat(666),
    'eyJ' + 'a.'.repeat(998),
  ];
  it.each(adversarial.map((s, i) => [i, s] as const))(
    'redacts adversarial input %i within the time budget',
    (_i, s) => {
      const start = performance.now();
      redactString(s);
      expect(performance.now() - start).toBeLessThan(PATTERN_BUDGET_MS);
    },
  );

  it('redacts a token that follows "="', () => {
    const tok = synth.base64(3);
    expect(redactString(`t=${tok}`)).not.toContain(tok);
    expect(redactString(`api_key=${tok}&x=1`)).not.toContain(tok);
  });

  it('strips query strings and fragments that carry parameters', () => {
    const short = 'Ab3dEf6hIj9kLm2nOp5qRs';
    const out = redactString(`GET /start?t=${short}&name=Priya+S#frag=x done`);
    expect(out).toBe('GET /start?[REDACTED] done');
    expect(redactString('/invite?email=a.b%40example.com')).not.toContain('%40');
  });

  it('redacts percent-encoded emails outside a query', () => {
    expect(redactString('/u/ab.cd%40example.com/x')).not.toContain('%40example');
  });

  it('covers free-text and location keys', () => {
    for (const key of [
      'details',
      'hint',
      'text',
      'content',
      'body',
      'prompt',
      'completion',
      'response',
      'resume',
      'comment',
      'notes',
      'reason',
      'msg',
      'message',
      'referer',
      'query',
      'city',
      'latitude',
      'longitude',
      'asOrganization',
    ]) {
      expect(redact({ [key]: 'v' })).toEqual({ [key]: REDACTED });
    }
  });

  it('normalises keys with zero-width and compatibility characters', () => {
    expect(redact({ 'e\u200bmail': 'v', ｅｍａｉｌ: 'v' })).toEqual({
      'e\u200bmail': REDACTED,
      ｅｍａｉｌ: REDACTED,
    });
  });

  it('catches more Indian number formats', () => {
    const m = synth.mobile();
    for (const s of [
      `${m.slice(0, 5)}.${m.slice(5)}`,
      `${m.slice(0, 5)}  ${m.slice(5)}`,
      `resume_${m}.pdf`,
      `uid${synth.aadhaar()}`,
      synth.aadhaar().replace(/(\d{4})(\d{4})(\d{4})/, '$1.$2.$3'),
      [...m].map((d) => String.fromCodePoint(0x966 + Number(d))).join(''),
    ]) {
      expect(redactString(`x ${s} y`)).toContain(REDACTED);
    }
    expect(redactString(`from ${synth.ipv4()}.`)).toContain(REDACTED);
  });

  it('never calls an overridden toISOString on a Date', () => {
    const d = Object.assign(new Date(0), { toISOString: () => 'leak' });
    expect(redact({ when: d })).toEqual({ when: '1970-01-01T00:00:00.000Z' });
  });

  it('caps total work on shared references', () => {
    const leaf: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) leaf[`k${i}`] = 'v';
    let node: Record<string, unknown> = leaf;
    for (let d = 0; d < 4; d++) {
      const next: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) next[`k${i}`] = node;
      node = next;
    }
    const start = performance.now();
    const out = JSON.stringify(redact(node));
    expect(performance.now() - start).toBeLessThan(1000);
    expect(out).toContain(TRUNCATED);
  });
});

describe('linear-time patterns (S1.7 ReDoS finding)', () => {
  // ~100 KB per shape, with no length cap: every pattern must stay linear, not just fast at 2,000.
  const KB100 = 100_000;
  const fill = (unit: string, prefix = ''): string =>
    prefix + unit.repeat(Math.ceil((KB100 - prefix.length) / unit.length));
  const shapes: [string, string][] = [
    ['account + dots', fill('.', 'account')],
    ['bank + separators', fill(' :#.-', 'bank')],
    ['account keywords', fill('account no ')],
    ['local part, no domain', fill('a', '') + '@'],
    ['many @', fill('a@')],
    ['percent-encoded @', fill('a%40')],
    ['domain labels, no tld', 'x@' + fill('a1.')],
    ['UPI-like', fill('ab.') + '@' + 'x'.repeat(40)],
    ['digit pairs', fill('1 ')],
    ['mobile-like', fill('9-')],
    ['dotted digits', fill('9.')],
    ['colons', fill(':')],
    ['hex colons', fill('a:')],
    ['mixed base64', fill('A1a')],
    ['hex then non-hex', fill('a') + 'g'],
    ['JWT dots', fill('a.', 'eyJ')],
    ['JWT starts', fill('eyJ-')],
    ['Bearer spaces', 'Bearer' + fill(' ')],
    ['key=value pairs', fill('a=b ')],
    ['key run', fill('a-')],
    ['token= runs', fill('token=')],
    ['query marks', fill('?a')],
    ['query pairs', fill('?a=b ')],
    ['IPv4-like', fill('1.1.')],
    ['PAN-like', fill('ABCDE1234')],
    // quoted key=value (follow-up 1): openers, long bodies with no closer, escapes, nesting
    ['double-quote openers', fill('a="')],
    ['single-quote openers', fill("a='")],
    ['escaped-quote openers', fill('a=\\"')],
    ['sensitive double-quote openers', fill('token="')],
    ['sensitive escaped openers', fill('token:\\"')],
    ['long body, no closer', 'a="' + fill('b')],
    ['long sensitive body, no closer', 'token="' + fill('b ')],
    ['long escaped body, no closer', 'a=\\"' + fill('\\\\')],
    ['long body of escapes', 'a="' + fill('\\"')],
    ['one quote type inside another', 'a="' + fill("b='")],
    ['nested escaped openers', 'a="' + fill('b=\\"c ')],
    ['quotes after separators', fill('a = "')],
    [
      'distinct quoted keys',
      Array.from({ length: 20_000 }, (_, i) => `k${i.toString(36)}="`).join(''),
    ],
    ['distinct keys', Array.from({ length: 20_000 }, (_, i) => `k${i.toString(36)}=v `).join('')],
    // Authorization schemes (follow-up 2)
    ['Basic spaces', 'Basic' + fill(' ')],
    ['Token words', fill('Token ')],
  ];

  it.each(shapes)('runs the patterns over ~100 KB of "%s" well inside 50 ms', (_label, s) => {
    expect(s.length).toBeGreaterThanOrEqual(KB100);
    const text = canonical(s);
    applyPatterns(text.slice(0, 1000)); // warm-up so regex compilation is not timed
    const start = performance.now();
    applyPatterns(text);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('returns [TRUNCATED] for a 100 KB string without running the patterns', () => {
    const start = performance.now();
    expect(redactString(fill('.', 'account'))).toBe(TRUNCATED);
    expect(performance.now() - start).toBeLessThan(5);
  });

  it('keeps the uncapped pattern runner out of the public API', () => {
    expect(publicLog).not.toHaveProperty('applyPatterns');
    expect(publicLog).not.toHaveProperty('canonical');
    expect(publicLog).toHaveProperty('redactString');
  });
});

describe('free-text secrets and query strings (S1.7 findings 2 and 3)', () => {
  const secret = synth.base64(5).slice(0, 10);

  it.each(['password', 'otp', 'token', 'api_key', 'secret', 'pin', 'session', 'access_token'])(
    'redacts the value after "%s=" and "%s:" in free text',
    (key) => {
      for (const s of [`${key}=${secret}`, `${key}: ${secret}`, `"${key}":"${secret}"`]) {
        const out = redactString(`login failed ${s} retry`);
        expect(out).not.toContain(secret);
        expect(out).toContain(key);
        expect(out.endsWith(' retry')).toBe(true);
      }
    },
  );

  it('leaves non-sensitive key=value pairs alone', () => {
    const s = 'status=ok count: 3 level=warn';
    expect(redactString(s)).toBe(s);
  });

  it('keeps scheme, host and path but drops the query values', () => {
    const out = redactString(`fetch https://api.example/v1/start?t=${secret}&lang=en failed`);
    expect(out).toBe('fetch https://api.example/v1/start?[REDACTED] failed');
  });

  it('drops fragment parameters (implicit-flow tokens)', () => {
    const out = redactString(`/cb#access_token=${secret}&state=x`);
    expect(out).toBe('/cb#[REDACTED]');
  });

  it('leaves a plain question mark alone', () => {
    const s = 'is it ready? yes';
    expect(redactString(s)).toBe(s);
  });

  it('is idempotent on redacted query strings and key=value pairs', () => {
    const once = redactString(`a?b=${secret} password=${secret}`);
    expect(redactString(once)).toBe(once);
  });
});

describe('free-text key stems (S1.7 finding 5)', () => {
  it.each([
    'answerText',
    'response_body',
    'transcript',
    'reviewerComment',
    'note',
    'messageBody',
    'feedback',
    'essay',
    'llmPrompt',
    'description',
    'passwd',
    'pwd',
    'signature',
    'credentials',
  ])('redacts "%s"', (key) => {
    expect(redact({ [key]: 'v' })).toEqual({ [key]: REDACTED });
  });

  it('keeps allow-listed metadata keys', () => {
    const input = { contentType: 'application/json', statusCode: 200, responseStatus: 404 };
    expect(redact(input)).toEqual(input);
  });
});

describe('quoted and multi-word key=value secrets (S1.7 follow-up 1)', () => {
  const secret = synth.base64(5).slice(0, 10);
  const phrase = synth.phrase();
  const R = REDACTED;
  const cases: [string, string, string][] = [
    ['single-quoted', `password='${secret}'`, `password='${R}'`],
    ['double-quoted', `password="${secret}"`, `password="${R}"`],
    ['double-quoted, multi-word', `password="${phrase}"`, `password="${R}"`],
    ['spaced', `password = "${phrase}"`, `password = "${R}"`],
    ['Python dict', `{'token': '${secret}'}`, `{'token': '${R}'}`],
    ['Python dict, multi-word', `{'token': '${phrase}'}`, `{'token': '${R}'}`],
    ['escaped JSON', `{\\"password\\":\\"${secret}\\"}`, `{\\"password\\":\\"${R}\\"}`],
    ['escaped JSON, multi-word', `{\\"password\\":\\"${phrase}\\"}`, `{\\"password\\":\\"${R}\\"}`],
    ['JSON, multi-word address', `{"address":"${phrase}"}`, `{"address":"${R}"}`],
    ['JSON with an escaped quote', `{"password":"${secret}\\" ${phrase}"}`, `{"password":"${R}"}`],
    [
      'escaped JSON inside a JSON string',
      JSON.stringify({ data: JSON.stringify({ password: phrase }) }),
      JSON.stringify({ data: JSON.stringify({ password: R }) }),
    ],
    [
      'escaped JSON with an escaped quote, inside a JSON string',
      JSON.stringify({ data: JSON.stringify({ password: `${secret}" ${phrase}`, n: 1 }) }),
      JSON.stringify({ data: JSON.stringify({ password: R, n: 1 }) }),
    ],
    [
      'quoted secret inside a non-sensitive quoted value',
      `{"data":"token='${phrase}'"}`,
      `{"data":"token='${R}'"}`,
    ],
    ['unclosed quote', `password="${phrase}`, `password="${R}`],
  ];

  it.each(cases)('redacts the whole quoted value: %s', (_label, s, expected) => {
    const out = redactString(`login failed ${s}`);
    expect(out).toBe(`login failed ${expected}`);
    expect(redactString(out)).toBe(out);
  });

  it('leaves quoted values under non-sensitive keys and empty values alone', () => {
    const s = `status="all good" level='warn' {"kind":"a b"} password=""`;
    expect(redactString(s)).toBe(s);
  });
});

describe('Authorization schemes (S1.7 follow-up 2)', () => {
  const basic = synth.basic();
  const tok = synth.base64(9).slice(0, 20);
  it.each([
    ['Basic', `Authorization: Basic ${basic}`],
    ['basic, lower case', `authorization: basic ${basic}`],
    ['Token', `Authorization: Token ${tok}`],
    ['Token in free text', `retry with Token ${tok} later`],
  ])('redacts %s credentials like Bearer', (_label, s) => {
    const out = redactString(s);
    expect(out).not.toContain(basic);
    expect(out).not.toContain(tok);
    expect(out).toContain(REDACTED);
    expect(redactString(out)).toBe(out);
  });
});
