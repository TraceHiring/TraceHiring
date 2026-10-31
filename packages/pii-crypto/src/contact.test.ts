// AT-M2-15: protectContact, the one call the api makes per invite row (M2-3, §6.2 "encrypt name/email/phone with the
// org DEK, compute blind indexes and hints"), and its inverse for the messaging consumer. Every output column matches
// its §3.2 CHECK; nothing in the result is plaintext. Synthetic data only.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BLIND_INDEX_RE,
  CIPHERTEXT_RE,
  EMAIL_HINT_RE,
  PHONE_HINT_RE,
  PiiInputError,
  contactFingerprint,
  decryptField,
  emailBlindIndex,
  phoneBlindIndex,
  protectContact,
  revealContact,
} from './index.js';
import type { ContactKeys } from './index.js';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
let keys: ContactKeys;

beforeAll(async () => {
  keys = {
    contactsKey: await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]),
    bidxKey: await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    keyVersion: 1,
  };
});

describe('protectContact', () => {
  it('normalises, encrypts, indexes and hints one row', async () => {
    const out = await protectContact(keys, {
      orgId: ORG_A,
      fullName: 'परीक्षा उम्मीदवार',
      email: '  Candidate.1@Example.TEST ',
      phone: '98765 43210',
    });
    expect(out.keyVersion).toBe(1);
    for (const ct of [out.fullNameCt, out.emailCt, out.phoneCt]) expect(ct).toMatch(CIPHERTEXT_RE);
    for (const h of [out.emailBidx, out.phoneBidx, out.contactFingerprint])
      expect(h).toMatch(BLIND_INDEX_RE);
    expect(out.emailHint).toBe('c•••@example.test');
    expect(out.emailHint).toMatch(EMAIL_HINT_RE);
    expect(out.phoneHint).toBe('••••3210');
    expect(out.phoneHint).toMatch(PHONE_HINT_RE);
    expect(out.emailBidx).toBe(await emailBlindIndex(keys.bidxKey, 'candidate.1@example.test'));
    expect(out.phoneBidx).toBe(await phoneBlindIndex(keys.bidxKey, '+919876543210'));
    expect(out.contactFingerprint).toBe(
      await contactFingerprint(keys.bidxKey, 'candidate.1@example.test'),
    );
    expect(
      await decryptField(keys.contactsKey, { orgId: ORG_A, field: 'email' }, out.emailCt),
    ).toBe('candidate.1@example.test');
    // Nothing plaintext leaks into the result.
    const json = JSON.stringify(out);
    for (const plain of ['candidate.1', '9876543210', 'परीक्षा']) expect(json).not.toContain(plain);
  });

  it('leaves the phone columns null when there is no phone', async () => {
    const out = await protectContact(keys, {
      orgId: ORG_A,
      fullName: 'Test [synthetic]',
      email: 'a@example.test',
    });
    expect(out.phoneCt).toBeNull();
    expect(out.phoneBidx).toBeNull();
    expect(out.phoneHint).toBeNull();
  });

  it('refuses an invalid email or phone with the input code', async () => {
    const badEmail = await protectContact(keys, {
      orgId: ORG_A,
      fullName: 'X',
      email: 'nope',
    }).catch((e: unknown) => e);
    expect(badEmail).toBeInstanceOf(PiiInputError);
    expect((badEmail as PiiInputError).code).toBe('invalid_email');
    const badPhone = await protectContact(keys, {
      orgId: ORG_A,
      fullName: 'X',
      email: 'a@example.test',
      phone: '12345',
    }).catch((e: unknown) => e);
    expect(badPhone).toBeInstanceOf(PiiInputError);
    expect((badPhone as PiiInputError).code).toBe('invalid_phone');
  });

  it('revealContact decrypts what protectContact stored', async () => {
    const out = await protectContact(keys, {
      orgId: ORG_A,
      fullName: 'சோதனை வேட்பாளர்',
      email: 'b@example.test',
      phone: '+44 20 7946 0958',
    });
    expect(
      await revealContact(keys.contactsKey, ORG_A, {
        fullNameCt: out.fullNameCt,
        emailCt: out.emailCt,
        phoneCt: out.phoneCt,
      }),
    ).toEqual({ fullName: 'சோதனை வேட்பாளர்', email: 'b@example.test', phone: '+442079460958' });
  });
});
