import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_DEPTH, MAX_STRING, REDACTED, TRUNCATED, redact, redactString } from './redact.js';
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
