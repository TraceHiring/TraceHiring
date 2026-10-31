// AT-M2-15 (normalisation vectors) and E23: M2-4 email and phone normalisation, display hints, name NFC
// (specs/m2-scheduling-invites.md M2-4, §3.2 candidate_contacts CHECKs, build-notes 2026-10-31 "Wave 1 lead part" e).
// Synthetic data only: example.test addresses and reserved-looking numbers.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EMAIL_HINT_RE,
  PHONE_HINT_RE,
  PiiInputError,
  emailHint,
  normaliseEmail,
  normaliseName,
  normalisePhone,
  phoneHint,
} from './index.js';

const expectInvalid = (fn: () => unknown, code: 'invalid_email' | 'invalid_phone') => {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(PiiInputError);
  expect((caught as PiiInputError).code).toBe(code);
  // The error never carries the value.
  expect((caught as Error).message).toBe(`pii-crypto: ${code}`);
};

describe('normaliseEmail (M2-4: trim, NFKC, lower case, ASCII dot-atom, LDH domain)', () => {
  it.each([
    ['  Alice.Example@Example.TEST ', 'alice.example@example.test'],
    ['\tcandidate.1@example.test\n', 'candidate.1@example.test'],
    ['ＡＢＣ@example.test', 'abc@example.test'], // full-width letters fold under NFKC
    ["o'brien+tag@mail.example.test", "o'brien+tag@mail.example.test"],
    ['_a@example.test', '_a@example.test'],
    ['=a@example.test', '=a@example.test'],
    ['1@x.example.test', '1@x.example.test'],
    ['a-b_c.d@sub-domain.example.test', 'a-b_c.d@sub-domain.example.test'],
    [`${'a'.repeat(64)}@example.test`, `${'a'.repeat(64)}@example.test`],
  ])('accepts %j as %j', (raw, expected) => {
    expect(normaliseEmail(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['plain'],
    ['a@b'],
    ['a@example'],
    ['a..b@example.test'],
    ['.a@example.test'],
    ['a.@example.test'],
    ['a@-example.test'],
    ['a@example-.test'],
    ['a@example..test'],
    ['a@.example.test'],
    ['a@example.test.'],
    ['a@example.t3st'],
    ['a@example.123'],
    ['a@example.t'],
    ['___@example.test'],
    ['=+-@example.test'],
    ['a b@example.test'],
    ['é@example.test'],
    ['a@exämple.test'],
    ['a@exa_mple.test'],
    ['a@@example.test'],
    ['a@b@example.test'],
    ['"quoted"@example.test'],
    ['a(b)@example.test'],
    ['@example.test'],
    ['a@'],
    [`${'a'.repeat(65)}@example.test`],
    [`a@${'b'.repeat(64)}.test`],
    [`a@${`${'b'.repeat(63)}.`.repeat(4)}test`],
  ])('refuses %j with invalid_email', (raw) => {
    expectInvalid(() => normaliseEmail(raw), 'invalid_email');
  });

  it('refuses a non-string', () => {
    expectInvalid(() => normaliseEmail(42 as never), 'invalid_email');
  });

  it('refuses an address whose hint would pass 80 characters (domain of 76)', () => {
    const domain75 = `${'d'.repeat(63)}.${'e'.repeat(6)}.test`; // 63 + 1 + 6 + 1 + 4 = 75
    expect(domain75.length).toBe(75);
    expect(emailHint(normaliseEmail(`a@${domain75}`)).length).toBe(80);
    const domain76 = `${'d'.repeat(63)}.${'e'.repeat(7)}.test`;
    expect(domain76.length).toBe(76);
    expectInvalid(() => normaliseEmail(`a@${domain76}`), 'invalid_email');
  });

  it('is idempotent and keeps the hint invariants for every address it accepts (property)', () => {
    fc.assert(
      fc.property(fc.emailAddress(), (raw) => {
        let value: string;
        try {
          value = normaliseEmail(raw);
        } catch (e) {
          expect(e).toBeInstanceOf(PiiInputError);
          return;
        }
        expect(normaliseEmail(value)).toBe(value);
        expect(value.length).toBeLessThanOrEqual(254);
        const hint = emailHint(value);
        expect(hint).toMatch(EMAIL_HINT_RE);
        expect(hint.length).toBeLessThanOrEqual(80);
        expect('=+-@').not.toContain(hint[0]);
      }),
      { numRuns: 500 },
    );
  });
});

describe('emailHint (first [a-z0-9] of the local part, then •••@domain)', () => {
  it.each([
    ['alice.example@example.test', 'a•••@example.test'],
    ['_a@example.test', 'a•••@example.test'],
    ['=a@example.test', 'a•••@example.test'],
    ['+-9z@example.test', '9•••@example.test'],
    ["'x@mail.example.test", 'x•••@mail.example.test'],
  ])('%j → %j', (email, hint) => {
    const h = emailHint(normaliseEmail(email));
    expect(h).toBe(hint);
    expect(h).toMatch(EMAIL_HINT_RE);
  });

  it('pins the CHECK pattern of candidate_contacts.email_hint', () => {
    expect(EMAIL_HINT_RE.source).toBe('^[a-z0-9]•••@[a-z0-9.-]+$');
  });

  it('refuses a value that is not a normalised address', () => {
    expectInvalid(() => emailHint('Not An Address'), 'invalid_email');
  });

  it('never starts with = + - @ (E23)', () => {
    for (const raw of [
      '=cmd@example.test',
      '+1@example.test',
      '-x@example.test',
      '=-+a@example.test',
    ]) {
      expect('=+-@').not.toContain(emailHint(normaliseEmail(raw))[0]);
    }
  });
});

describe('normalisePhone (M2-4: +91 default, Indian mobiles, explicit +CC for others)', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['6000000000', '+916000000000'],
    ['7999999999', '+917999999999'],
    ['98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['98765.43210', '+919876543210'],
    ['(98765) 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['0 98765 43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['91 98765 43210', '+919876543210'],
    ['+919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['+91 (98765) 43210', '+919876543210'],
    ['+44 20 7946 0958', '+442079460958'],
    ['+1 (202) 555-0100', '+12025550100'],
    ['+12345678', '+12345678'],
    ['+123456789012345', '+123456789012345'],
  ])('accepts %j as %j', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['+'],
    ['abc'],
    ['5876543210'], // Indian mobiles start 6-9
    ['0876543210'],
    ['987654321'], // 9 digits
    ['98765432101'], // 11 digits, no 0 or 91 prefix
    ['00919876543210'],
    ['0919876543210'],
    ['915876543210'],
    ['+915876543210'], // +91 national part must be ^[6-9][0-9]{9}$
    ['+9198765432'],
    ['+9198765432101'],
    ['+91 08765 43210'],
    ['+1234567'], // fewer than 8 digits after +
    ['+1234567890123456'], // more than 15
    ['+0123456789'], // a country code never starts with 0
    ['++919876543210'],
    ['98765x43210'],
    ['+91 98765 4321O'],
    ['٩٨٧٦٥٤٣٢١٠'], // non-ASCII digits
    ['98765/43210'],
    ['9'.repeat(70)],
  ])('refuses %j with invalid_phone', (raw) => {
    expectInvalid(() => normalisePhone(raw), 'invalid_phone');
  });

  it('refuses a non-string', () => {
    expectInvalid(() => normalisePhone(undefined as never), 'invalid_phone');
  });

  it('maps every formatting of a 10-digit Indian mobile to the same E.164 value (property)', () => {
    const mobile = fc
      .tuple(fc.constantFrom('6', '7', '8', '9'), fc.stringMatching(/^[0-9]{9}$/))
      .map(([a, b]) => a + b);
    const prefix = fc.constantFrom('', '0', '91', '+91', '+91 ', '0 ', '91-');
    const sep = fc.constantFrom('', ' ', '-', '.');
    fc.assert(
      fc.property(mobile, prefix, sep, (m, p, s) => {
        const formatted = `${p}${m.slice(0, 5)}${s}${m.slice(5)}`;
        const out = normalisePhone(formatted);
        expect(out).toBe(`+91${m}`);
        expect(normalisePhone(out)).toBe(out);
      }),
      { numRuns: 300 },
    );
  });
});

describe('phoneHint', () => {
  it('is •••• plus the last four digits', () => {
    expect(phoneHint(normalisePhone('98765 43210'))).toBe('••••3210');
    expect(phoneHint('+442079460958')).toBe('••••0958');
    expect(phoneHint('+442079460958')).toMatch(PHONE_HINT_RE);
  });

  it('pins the CHECK pattern of candidate_contacts.phone_hint', () => {
    expect(PHONE_HINT_RE.source).toBe('^••••[0-9]{4}$');
  });

  it('refuses a value that is not E.164', () => {
    expectInvalid(() => phoneHint('9876543210'), 'invalid_phone');
  });

  it('never starts with = + - @ (E23)', () => {
    expect('=+-@').not.toContain(phoneHint('+919876543210')[0]);
  });
});

describe('normaliseName (NFC only; the api validates names against the contract)', () => {
  it('composes decomposed marks (NFC) and keeps everything else as given', () => {
    expect(normaliseName('René [synthetic]')).toBe('René [synthetic]');
    expect(normaliseName('  spaced  ')).toBe('  spaced  ');
  });

  it('keeps Devanagari and Tamil text (E22)', () => {
    const devanagari = 'परीक्षा उम्मीदवार';
    const tamil = 'சோதனை வேட்பாளர்';
    expect(normaliseName(devanagari)).toBe(devanagari.normalize('NFC'));
    expect(normaliseName(tamil)).toBe(tamil.normalize('NFC'));
  });

  it('refuses a non-string or an empty name', () => {
    for (const bad of [undefined, 42, '']) {
      let caught: unknown;
      try {
        normaliseName(bad as never);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PiiInputError);
      expect((caught as PiiInputError).code).toBe('invalid_name');
    }
  });
});
