import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as publicLog from './index.js';
import {
  MAX_DEPTH,
  MAX_ENTRIES,
  MAX_STRING,
  REDACTED,
  TRUNCATED,
  applyPatterns,
  canonical,
  redact,
  redactString,
} from './redact.js';
import { synth } from './synth.test-helpers.js';

// Wall-clock budgets (redactor review #7): one sample flakes when the machine is busy, so time the best of
// five runs. Load only ever adds time, so the minimum is the closest to the real cost, and super-linear
// backtracking (seconds at 100 KB) still fails by a wide margin.
function bestOfFiveMs(run: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 5; i += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

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

  // Redactor security review #2 (docs/reviews/M0a-S1.7-redactor-security-review.md): a UPI id at the end of a
  // sentence or before a dash (canonical() folds every Pd dash and U+2212 to '-') must still be redacted.
  it.each([
    ['a full stop', '.'],
    ['a hyphen', '-x'],
    ['an em dash', '—x'],
    ['an en dash', '–x'],
    ['a minus sign', '−x'],
  ])('redacts a UPI id followed by %s', (_label, tail) => {
    const upi = synth.upi();
    const out = redactString(`refund to ${upi}${tail}`);
    expect(out).not.toContain(upi);
    expect(out).toContain(REDACTED);
  });

  it('still redacts an email whose local part has a dot', () => {
    const email = `${synth.upi().split('@')[0]}.${synth.upi(2).replace('@', '@mail.')}.example`;
    const out = redactString(`mail ${email} now`);
    expect(out).not.toContain(email);
    expect(out).toBe(`mail ${REDACTED} now`);
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
          withBoxedValues: true,
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
    // canonicalisation (follow-ups 3-5): digits far from their zero, ignorables, dashes
    '\u0669'.repeat(1999),
    String.fromCodePoint(0x1e959).repeat(999),
    '9\u034f'.repeat(999),
    '\u{e0020}'.repeat(999),
    '9\u2013'.repeat(999),
  ];
  it.each(adversarial.map((s, i) => [i, s] as const))(
    'redacts adversarial input %i within the time budget',
    (_i, s) => {
      expect(bestOfFiveMs(() => redactString(s))).toBeLessThan(PATTERN_BUDGET_MS);
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
    // canonicalisation (follow-ups 3-5): what the patterns see after folding
    ['Arabic-Indic digits and spaces', fill('\u0669 ')],
    ['ignorable-split digits', fill('9\u034f')],
    ['en-dash digits', fill('9\u2013')],
    // IPv6 after a word prefix (follow-up 6)
    ['word prefixes', fill('x:')],
    ['prefix and hex', fill('ab:c')],
    ['prefix then groups', fill('from:a:')],
    ['long prefixes', fill('a-b_c-d-e-f-g-h_i-j-k-l-m-n-o-p-q:1:')],
    // URL userinfo (follow-up 7)
    ['scheme separators', fill('a://')],
    ['long userinfo, no @', 'a://' + fill('b')],
    ['userinfo of @', 'a://' + fill('@')],
    ['userinfo pairs', fill('a://b@')],
    ['scheme characters', fill('ab+.-')],
    ['schemes inside userinfo', 'a://' + fill('b:c://')],
  ];

  it.each(shapes)('runs the patterns over ~100 KB of "%s" well inside 50 ms', (_label, s) => {
    expect(s.length).toBeGreaterThanOrEqual(KB100);
    const text = canonical(s);
    applyPatterns(text.slice(0, 1000)); // warm-up so regex compilation is not timed
    expect(bestOfFiveMs(() => applyPatterns(text))).toBeLessThan(50);
  });

  it('returns [TRUNCATED] for a 100 KB string without running the patterns', () => {
    expect(redactString(fill('.', 'account'))).toBe(TRUNCATED);
    expect(bestOfFiveMs(() => redactString(fill('.', 'account')))).toBeLessThan(5);
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

describe('number canonicalisation (S1.7 follow-ups 3-5)', () => {
  const m = synth.mobile();
  const a = synth.aadhaar();
  const inScript = (s: string, zero: number): string =>
    s.replace(/\d/g, (d) => String.fromCodePoint(zero + Number(d)));
  const hex = (cps: number[]): [string, number][] =>
    cps.map((cp) => [cp.toString(16).toUpperCase().padStart(4, '0'), cp]);
  const expectRedacted = (s: string): void => {
    expect(redactString(`x ${s} y`)).toBe(`x ${REDACTED} y`);
  };

  // Default_Ignorable_Code_Point characters that the old fixed list did not cover
  it.each(
    hex([0x34f, 0x61c, 0x115f, 0x17b4, 0x180b, 0x2066, 0x3164, 0xfe0f, 0xffa0, 0x1d173, 0xe0020]),
  )('strips the ignorable U+%s from inside a number', (_hex, cp) => {
    const c = String.fromCodePoint(cp);
    expectRedacted(`${m.slice(0, 5)}${c}${m.slice(5)}`);
    expectRedacted([...a].join(c));
  });

  it('strips ignorable letters from keys', () => {
    for (const key of ['e\u3164mail', 'pass\u115fword', 'to\uffa0ken']) {
      expect(redact({ [key]: 'v' })).toEqual({ [key]: REDACTED });
    }
  });

  it.each([
    ['Arabic-Indic', 0x660],
    ['Extended Arabic-Indic', 0x6f0],
    ['Ol Chiki', 0x1c50],
    ['Meetei Mayek', 0xabf0],
    ['Lepcha', 0x1c40],
    ['Myanmar', 0x1040],
    ['Thai', 0xe50],
    ['Sora Sompeng', 0x110f0],
    ['Chakma', 0x11136],
    ['Masaram Gondi', 0x11d50],
    ['Adlam', 0x1e950],
  ])('folds %s digits to ASCII', (_label, zero) => {
    expectRedacted(inScript(m, zero));
    expectRedacted(inScript(a, zero));
    expect(canonical(inScript('0123456789', zero))).toBe('0123456789');
  });

  it('folds a number that mixes digit scripts', () => {
    expectRedacted(inScript(m.slice(0, 5), 0x966) + inScript(m.slice(5), 0x660));
  });

  it.each(hex([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2e3a, 0xfe58, 0x2212]))(
    'maps the dash U+%s to "-" between digit groups',
    (_hex, cp) => {
      const d = String.fromCodePoint(cp);
      expectRedacted(`${m.slice(0, 5)}${d}${m.slice(5)}`);
      expectRedacted(`+91${d}${m}`);
      expectRedacted(a.replace(/(\d{4})(\d{4})(\d{4})/, `$1${d}$2${d}$3`));
      expect(canonical(`a${d}b`)).toBe('a-b');
    },
  );

  it('is idempotent on any Unicode text, even where a dropped ignorable lets marks compose', () => {
    expect(canonical('e\u034f\u0301')).toBe('\u00e9');
    expect(canonical('\u1100\u3164\u1161')).toBe('\uac00');
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 40 }), (s) => {
        const once = canonical(s);
        expect(canonical(once)).toBe(once);
        expect(redactString(redactString(s))).toBe(redactString(s));
      }),
      { numRuns: 500 },
    );
  });
});

describe('IPv6 after a word prefix (S1.7 follow-up 6)', () => {
  it.each([
    ['ip:', synth.ipv6()],
    ['from:', synth.ipv6(2)],
    ['host:', synth.ipv6Full()],
    ['peer:', `fe80::${synth.ipv6(3).slice(-2)}`],
    ['src_addr:', synth.ipv6Full(4)],
  ])('redacts the address after "%s" and keeps the prefix', (prefix, ip) => {
    const out = redactString(`conn ${prefix}${ip} closed`);
    expect(out).toBe(`conn ${prefix}${REDACTED} closed`);
    expect(redactString(out)).toBe(out);
  });

  it('leaves clock times and other word:value pairs after a prefix alone', () => {
    const s = 'at:12:30:45 ts:2026-10-11T12:30:45Z std::vector error:abc:def level:warn';
    expect(redactString(s)).toBe(s);
  });
});

describe('URL userinfo (S1.7 follow-up 7)', () => {
  const user = synth.word(1);
  const pass = `${synth.word(2)}${synth.mobile().slice(0, 3)}`;
  const host = `${synth.word(3)}.example`;
  it.each([
    ['https', `https://${user}:${pass}@${host}/v1/x`, `https://${REDACTED}@${host}/v1/x`],
    ['redis, password only', `redis://:${pass}@${host}:6379`, `redis://${REDACTED}@${host}:6379`],
    ['amqp, no path', `amqp://${user}:${pass}@${host}`, `amqp://${REDACTED}@${host}`],
    ['ftp, user only', `ftp://${user}@${host}/f`, `ftp://${REDACTED}@${host}/f`],
    ['an @ in the password', `https://${user}:a@${pass}@${host}/`, `https://${REDACTED}@${host}/`],
  ])('keeps the scheme and host and redacts the userinfo: %s', (_label, url, expected) => {
    const out = redactString(`fetch ${url} failed`);
    expect(out).toBe(`fetch ${expected} failed`);
    expect(redactString(out)).toBe(out);
  });

  it('still redacts a postgres URL completely', () => {
    expect(redactString(`connect ${synth.dbUrl()} failed`)).toBe(`connect ${REDACTED} failed`);
  });

  it('leaves URLs without userinfo alone', () => {
    const s = `fetch https://${host}/v1/x and mailto:support done`;
    expect(redactString(s)).toBe(s);
  });
});

describe('stacks under stack-like keys (S1.7 follow-up 8)', () => {
  const phrase = synth.phrase();
  const frames = ['at f (file:///app/a.js:1:2)', 'at g (file:///app/b.js:30:4)'];
  // The message spans lines and mentions a frame-free sentence; none of it may survive.
  const stack = [
    `Error: duplicate ${phrase}`,
    `detail ${phrase}`,
    ...frames.map((f) => `    ${f}`),
  ];

  // Redactor security review #1: message lines shaped like a frame must not survive, and a stack
  // string over the cap becomes [TRUNCATED] like any other string (spec §9.1 caps).
  it('drops message lines that only look like frames', () => {
    const fake = `at ${phrase}:1:1`;
    const times = `at 12:30:45 ${phrase} booked:1:1`;
    expect(redact({ stack: ['Error: slot', fake, times, `    ${frames[0]}`].join('\n') })).toEqual({
      stack: [frames[0]],
    });
  });

  it('truncates a stack string over the cap instead of filtering it', () => {
    const big = ['Error: x', `at ${phrase}:1:1`, ...Array<string>(80).fill(`    ${frames[0]}`)];
    const text = big.join('\n');
    expect(text.length).toBeGreaterThan(MAX_STRING);
    expect(redact({ stack: text })).toEqual({ stack: TRUNCATED });
  });

  it.each([
    'at Object.<anonymous> (file:///a.js:1:2)',
    'at new Foo (/a.js:1:2)',
    'at Foo.bar [as baz] (/a.js:1:2)',
    'at async run (/a.js:1:2)',
    'at node:internal/x:1:2',
    'at fetch (index.js:1:2)',
  ])('keeps the real V8 frame "%s"', (frame) => {
    expect(redact({ stack: `Error: x\n    ${frame}` })).toEqual({ stack: [frame] });
  });

  it.each(['stack', 'stacktrace', 'stack_trace', 'stackTrace', 'errorStack', 'Stack Trace'])(
    'keeps only the frames of a string under "%s"',
    (key) => {
      const once = redact({ [key]: stack.join('\n') });
      expect(once).toEqual({ [key]: frames });
      expect(redact(once)).toEqual(once);
    },
  );

  it('filters an array of stack lines the same way', () => {
    const once = redact({ stack: [...stack, 42] });
    expect(once).toEqual({ stack: frames });
    expect(redact(once)).toEqual(once);
  });

  it('drops a frame that stops looking like a frame once redacted, so it stays idempotent', () => {
    // A line number shaped like a mobile number: redacting it leaves no line:column behind.
    const odd = `at h (file:///app/c.js:${synth.mobile()}:5)`;
    const s = ['Error: x', `    ${odd}`, `    ${frames[0]}`].join('\n');
    const once = redact({ stack: s, err: Object.assign(new Error('x'), { stack: s }) });
    expect(once).toEqual({ stack: [frames[0]], err: { name: 'Error', stack: [frames[0]] } });
    // A serialised error's own `name` key is a PII stem, so a second pass is compared on stacks.
    const twice = redact(once) as { stack: unknown; err: { stack: unknown } };
    expect(twice.stack).toEqual([frames[0]]);
    expect(twice.err.stack).toEqual([frames[0]]);
  });

  it('caps a stack array at the depth cap like any other array', () => {
    let deep: Record<string, unknown> = { stack: stack.join('\n') };
    for (let i = 0; i < MAX_DEPTH - 1; i++) deep = { n: deep };
    expect(depthOf(redact(deep))).toBeLessThanOrEqual(MAX_DEPTH);
  });

  it.each([
    ['colon-digit lines', `at x:${'1:'.repeat(140)}\n`],
    ['long digit runs', `at x:${'1'.repeat(280)}:\n`],
    ['message lines', `Error: ${'x'.repeat(290)}\n`],
    ['frames', `${frames[0]}\n`],
  ])(
    'truncates a ~100 KB stack string, and filters ~30 KB of %s lines within 50 ms',
    (_label, line) => {
      const big = line.repeat(Math.ceil(100_000 / line.length));
      expect(redact({ stack: big })).toEqual({ stack: TRUNCATED });
      // An array of lines is filtered line by line (at most MAX_ENTRIES of them), never truncated whole.
      const lines = Array<string>(MAX_ENTRIES).fill(line.trimEnd());
      redact({ stack: lines.slice(0, 5) }); // warm-up
      const out = redact({ stack: lines }) as { stack: string[] };
      expect(bestOfFiveMs(() => redact({ stack: lines }))).toBeLessThan(50);
      expect(out.stack.length).toBeLessThanOrEqual(20);
    },
  );

  it('leaves other keys that mention a stack alone', () => {
    expect(redact({ stackSize: 3, stacks: 'a b' })).toEqual({ stackSize: 3, stacks: 'a b' });
  });
});

describe('boxed primitives and hostile arrays (S1.7 follow-up 9)', () => {
  it('unwraps String, Number, Boolean and BigInt objects before redacting', () => {
    const email = synth.email();
    const mobile = synth.mobile();
    expect(
      redact({
        s: new String(email),
        n: new Number(Number(mobile)),
        b: new Boolean(true),
        big: Object(BigInt(synth.aadhaar())),
        ok: new String('fine'),
      }),
    ).toEqual({ s: REDACTED, n: REDACTED, b: true, big: REDACTED, ok: 'fine' });
    expect(redact(new String(email))).toBe(REDACTED);
  });

  it('unwraps a wrapper whose prototype was changed, and walks a look-alike as an object', () => {
    const moved = Object.setPrototypeOf(new String(synth.email()), null) as object;
    expect(redact({ v: moved })).toEqual({ v: REDACTED });
    const fake = Object.assign(Object.create(String.prototype) as object, { a: 1 });
    expect(redact({ v: fake })).toEqual({ v: { a: 1 } });
  });

  it("never runs an array's own slice or map", () => {
    const leak = (): string[] => ['leak'];
    const arr = Object.assign([synth.email()], { slice: leak, map: leak });
    expect(redact({ a: arr })).toEqual({ a: [REDACTED] });
  });

  it('never runs a species constructor', () => {
    let called = false;
    class Spy {
      constructor() {
        called = true;
      }
    }
    const arr = [synth.email(), 'x'];
    Object.defineProperty(arr, 'constructor', { value: { [Symbol.species]: Spy } });
    expect(redact({ a: arr })).toEqual({ a: [REDACTED, 'x'] });
    expect(called).toBe(false);
  });

  it('keeps the entry cap on long arrays', () => {
    const out = redact(Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => i)) as unknown[];
    expect(out).toHaveLength(MAX_ENTRIES + 1);
    expect(out.at(-1)).toBe(TRUNCATED);
  });
});
