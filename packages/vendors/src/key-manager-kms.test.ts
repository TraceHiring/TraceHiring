// AwsKmsKeyManager (specs/m2-scheduling-invites.md M2-3, M2-16, E18, AT-M2-33; ADR-034): KMS JSON API
// (TrentService.GenerateDataKey with KeySpec AES_256, TrentService.Decrypt) signed by aws4fetch with an injected
// fetch and a fixed signing time; EncryptionContext {org, purpose} on both calls; KMS down → a typed retryable error.
// The KMS here is an in-test double that enforces the encryption context like KMS does. No network. Synthetic data.
import { beforeEach, describe, expect, it } from 'vitest';
import { KMS_ENDPOINT, KMS_REGION, AwsKmsKeyManager } from './key-manager-kms.js';
import type { AwsKmsKeyManagerOptions } from './key-manager-kms.js';
import { KeyManagerError } from './key-manager.js';
import {
  FIXED_AMZ_DATE,
  FIXED_DATE,
  jsonResponse,
  recordingFetch,
  referenceSigV4,
  testCredentials,
} from './messaging-sigv4.test-helpers.js';
import type { RecordedRequest } from './messaging-sigv4.test-helpers.js';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const ORG_B = '00000000-0000-4000-8000-0000000000b2';
const KEY_ARN = 'arn:aws:kms:ap-south-1:000000000000:key/00000000-0000-4000-8000-00000000beef';

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));

/** A KMS double: remembers each data key with its encryption context and refuses a Decrypt whose context differs. */
class FakeKms {
  readonly blobs = new Map<string, { plaintext: string; context: string; keyId: string }>();
  down = false;
  respond = (req: RecordedRequest): Response => {
    if (this.down)
      return jsonResponse(
        503,
        { __type: 'DependencyTimeoutException' },
        'application/x-amz-json-1.1',
      );
    const body = JSON.parse(req.body) as {
      KeyId?: string;
      KeySpec?: string;
      CiphertextBlob?: string;
      EncryptionContext?: Record<string, string>;
    };
    const context = JSON.stringify(body.EncryptionContext ?? {});
    if (req.headers['x-amz-target'] === 'TrentService.GenerateDataKey') {
      const plaintext = b64(crypto.getRandomValues(new Uint8Array(32)));
      const blob = b64(crypto.getRandomValues(new Uint8Array(184)));
      this.blobs.set(blob, { plaintext, context, keyId: body.KeyId ?? '' });
      return jsonResponse(200, { CiphertextBlob: blob, Plaintext: plaintext, KeyId: body.KeyId });
    }
    if (req.headers['x-amz-target'] === 'TrentService.Decrypt') {
      const found = this.blobs.get(body.CiphertextBlob ?? '');
      if (found === undefined || found.context !== context || found.keyId !== body.KeyId) {
        return jsonResponse(
          400,
          { __type: 'InvalidCiphertextException' },
          'application/x-amz-json-1.1',
        );
      }
      return jsonResponse(200, {
        Plaintext: found.plaintext,
        KeyId: found.keyId,
        EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
      });
    }
    return jsonResponse(400, { __type: 'UnknownOperationException' });
  };
}

let kms: FakeKms;
let rec: ReturnType<typeof recordingFetch>;
beforeEach(() => {
  kms = new FakeKms();
  rec = recordingFetch((req) => kms.respond(req));
});

const options = (patch: Partial<AwsKmsKeyManagerOptions> = {}): AwsKmsKeyManagerOptions => ({
  ...testCredentials(),
  keyArn: KEY_ARN,
  fetch: rec.fetch,
  now: () => FIXED_DATE,
  ...patch,
});

const keyError = async (p: Promise<unknown>): Promise<KeyManagerError> => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(KeyManagerError);
  return e as KeyManagerError;
};

describe('AwsKmsKeyManager: request shape (AT-M2-11 local half of DC-M2-1)', () => {
  it('pins region and endpoint', () => {
    expect(KMS_REGION).toBe('ap-south-1');
    expect(KMS_ENDPOINT).toBe('https://kms.ap-south-1.amazonaws.com/');
  });

  it('GenerateDataKey: POST, x-amz-json-1.1, target, AES_256, encryption context, SigV4 for a fixed date', async () => {
    const km = new AwsKmsKeyManager(options());
    const dk = await km.generateDataKey(ORG_A, 'contacts');
    expect(rec.calls).toHaveLength(1);
    const req = rec.calls[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://kms.ap-south-1.amazonaws.com/');
    expect(req.headers['content-type']).toBe('application/x-amz-json-1.1');
    expect(req.headers['x-amz-target']).toBe('TrentService.GenerateDataKey');
    expect(req.headers['x-amz-date']).toBe(FIXED_AMZ_DATE);
    expect(JSON.parse(req.body)).toEqual({
      KeyId: KEY_ARN,
      KeySpec: 'AES_256',
      EncryptionContext: { org: ORG_A, purpose: 'contacts', kv: '1' },
    });
    const ref = referenceSigV4({
      method: 'POST',
      host: 'kms.ap-south-1.amazonaws.com',
      path: '/',
      signedHeaders: {
        'x-amz-date': FIXED_AMZ_DATE,
        'x-amz-target': 'TrentService.GenerateDataKey',
      },
      body: req.body,
      region: 'ap-south-1',
      service: 'kms',
      amzDate: FIXED_AMZ_DATE,
      ...testCredentials(),
    });
    expect(ref.canonicalRequest.split('\n').slice(0, 8)).toEqual([
      'POST',
      '/',
      '',
      'host:kms.ap-south-1.amazonaws.com',
      'x-amz-date:20261031T120000Z',
      'x-amz-target:TrentService.GenerateDataKey',
      '',
      'host;x-amz-date;x-amz-target',
    ]);
    expect(req.headers.authorization).toBe(ref.authorization);

    expect(dk.kmsKeyRef).toBe(KEY_ARN);
    expect(dk.keyVersion).toBe(1);
    expect(dk.wrapped.length).toBeLessThanOrEqual(1024);
    expect(dk.plaintext.extractable).toBe(false);
    expect(dk.plaintext.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
  });

  it('Decrypt: sends the blob, the key ARN and the same encryption context; the key works', async () => {
    const km = new AwsKmsKeyManager(options());
    const dk = await km.generateDataKey(ORG_A, 'bidx');
    const key = await km.unwrap(ORG_A, 'bidx', dk.wrapped, dk.kmsKeyRef);
    const req = rec.calls[1]!;
    expect(req.headers['x-amz-target']).toBe('TrentService.Decrypt');
    expect(JSON.parse(req.body)).toEqual({
      CiphertextBlob: dk.wrapped,
      KeyId: KEY_ARN,
      EncryptionContext: { org: ORG_A, purpose: 'bidx', kv: '1' },
    });
    const ref = referenceSigV4({
      method: 'POST',
      host: 'kms.ap-south-1.amazonaws.com',
      path: '/',
      signedHeaders: { 'x-amz-date': FIXED_AMZ_DATE, 'x-amz-target': 'TrentService.Decrypt' },
      body: req.body,
      region: 'ap-south-1',
      service: 'kms',
      amzDate: FIXED_AMZ_DATE,
      ...testCredentials(),
    });
    expect(req.headers.authorization).toBe(ref.authorization);
    expect(key.algorithm).toMatchObject({ name: 'HMAC', hash: { name: 'SHA-256' } });
    expect(key.extractable).toBe(false);
    const msg = new TextEncoder().encode('probe');
    expect(new Uint8Array(await crypto.subtle.sign('HMAC', key, msg))).toEqual(
      new Uint8Array(await crypto.subtle.sign('HMAC', dk.plaintext, msg)),
    );
  });
});

describe('AwsKmsKeyManager: failure modes (E18, AT-M2-33)', () => {
  it('unwrap with the wrong org or purpose fails with unwrap_failed (KMS refuses the context)', async () => {
    const km = new AwsKmsKeyManager(options());
    const dk = await km.generateDataKey(ORG_A, 'contacts');
    expect((await keyError(km.unwrap(ORG_B, 'contacts', dk.wrapped, dk.kmsKeyRef))).code).toBe(
      'unwrap_failed',
    );
    expect((await keyError(km.unwrap(ORG_A, 'bidx', dk.wrapped, dk.kmsKeyRef))).code).toBe(
      'unwrap_failed',
    );
  });

  it('binds the key version into the encryption context: a version 2 key does not unwrap as version 1 (B1 fix 3)', async () => {
    const km = new AwsKmsKeyManager(options());
    const dk = await km.generateDataKey(ORG_A, 'contacts', { keyVersion: 2 });
    expect(dk.keyVersion).toBe(2);
    expect(JSON.parse(rec.calls[0]!.body).EncryptionContext).toEqual({
      org: ORG_A,
      purpose: 'contacts',
      kv: '2',
    });
    expect((await keyError(km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 1))).code).toBe(
      'unwrap_failed',
    );
    expect(JSON.parse(rec.calls[1]!.body).EncryptionContext).toEqual({
      org: ORG_A,
      purpose: 'contacts',
      kv: '1',
    });
    const key = await km.unwrap(ORG_A, 'contacts', dk.wrapped, dk.kmsKeyRef, 2);
    expect(key.extractable).toBe(false);
  });

  it('refuses a missing or invalid key version on unwrap before any request', async () => {
    const km = new AwsKmsKeyManager(options());
    for (const bad of [undefined, 0, 1.5, '1']) {
      expect(
        (await keyError(km.unwrap(ORG_A, 'contacts', 'AAAA', KEY_ARN, bad as never))).code,
      ).toBe('bad_key_version');
    }
    expect(rec.calls).toHaveLength(0);
  });

  it('KMS down (5xx) is the retryable kms_unavailable', async () => {
    const km = new AwsKmsKeyManager(options());
    const dk = await km.generateDataKey(ORG_A, 'contacts');
    kms.down = true;
    for (const p of [
      km.generateDataKey(ORG_A, 'contacts'),
      km.unwrap(ORG_A, 'contacts', dk.wrapped, KEY_ARN),
    ]) {
      const e = await keyError(p);
      expect(e.code).toBe('kms_unavailable');
      expect(e.retryable).toBe(true);
      expect(e.message).toBe('key manager: kms_unavailable');
    }
  });

  it('a network error is the retryable kms_unavailable', async () => {
    const km = new AwsKmsKeyManager(
      options({ fetch: () => Promise.reject(new TypeError('fetch failed')) }),
    );
    const e = await keyError(km.generateDataKey(ORG_A, 'contacts'));
    expect(e.code).toBe('kms_unavailable');
    expect(e.retryable).toBe(true);
  });

  it.each([
    [429, {}, 'kms_throttled', true],
    [400, { __type: 'ThrottlingException' }, 'kms_throttled', true],
    [400, { __type: 'AccessDeniedException' }, 'kms_rejected', false],
    [400, { __type: 'DisabledException' }, 'kms_rejected', false],
    [500, { __type: 'KMSInternalException' }, 'kms_unavailable', true],
    [400, 'not json', 'kms_rejected', false],
  ] as const)('HTTP %i %j → %s (retryable %s)', async (status, body, code, retryable) => {
    const f = recordingFetch(() =>
      typeof body === 'string' ? new Response(body, { status }) : jsonResponse(status, body),
    );
    const e = await keyError(
      new AwsKmsKeyManager(options({ fetch: f.fetch })).generateDataKey(ORG_A, 'bidx'),
    );
    expect(e.code).toBe(code);
    expect(e.retryable).toBe(retryable);
  });

  it.each([
    [{}],
    [{ CiphertextBlob: 'AAAA', KeyId: KEY_ARN }],
    [{ CiphertextBlob: 'AAAA', Plaintext: b64(new Uint8Array(16)), KeyId: KEY_ARN }],
    [{ CiphertextBlob: 'A'.repeat(1028), Plaintext: b64(new Uint8Array(32)), KeyId: KEY_ARN }],
    [{ CiphertextBlob: '***', Plaintext: b64(new Uint8Array(32)), KeyId: KEY_ARN }],
    [{ CiphertextBlob: 'AAAA', Plaintext: b64(new Uint8Array(32)), KeyId: `${KEY_ARN}0` }],
  ])('a malformed GenerateDataKey answer %j is kms_bad_response', async (body) => {
    const f = recordingFetch(() => jsonResponse(200, body));
    const e = await keyError(
      new AwsKmsKeyManager(options({ fetch: f.fetch })).generateDataKey(ORG_A, 'contacts'),
    );
    expect(e.code).toBe('kms_bad_response');
    expect(e.retryable).toBe(false);
  });

  it('refuses a key reference that is not a KMS key ARN in ap-south-1, before any request', async () => {
    const km = new AwsKmsKeyManager(options());
    for (const ref of ['dev:1', 'arn:aws:kms:us-east-1:000000000000:key/x', '', `${KEY_ARN}\n`]) {
      expect((await keyError(km.unwrap(ORG_A, 'contacts', 'AAAA', ref))).code).toBe('bad_key_ref');
    }
    expect(rec.calls).toHaveLength(0);
  });

  it.each([
    [{ keyArn: 'arn:aws:kms:us-east-1:000000000000:key/x' }],
    [{ keyArn: '' }],
    [{ accessKeyId: '' }],
    [{ secretAccessKey: '' }],
    [{ fetch: undefined as never }],
  ])('refuses bad options %j', (patch) => {
    let caught: unknown;
    try {
      new AwsKmsKeyManager(options(patch as Partial<AwsKmsKeyManagerOptions>));
    } catch (e) {
      caught = e;
    }
    expect((caught as KeyManagerError).code).toBe('bad_options');
  });
});
