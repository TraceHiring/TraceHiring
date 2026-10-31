// AwsKmsKeyManager (specs/m2-scheduling-invites.md M2-3, M2-16, E18, AT-M2-33; ADR-034): per-org data keys from
// AWS KMS in ap-south-1 over the KMS JSON API (`TrentService.GenerateDataKey` with KeySpec AES_256, and
// `TrentService.Decrypt`), signed with aws4fetch through an injected fetch. Both calls carry the EncryptionContext
// { org, purpose, kv } (string values; kv = the key version, B1 fix 3), so a blob wrapped for one org, purpose or
// key version does not decrypt for another (KMS refuses it).
// kms_key_ref is the key ARN. The plaintext key bytes are imported as a non-extractable CryptoKey and zeroed.
// Errors carry codes only: 5xx and network errors → kms_unavailable, 429 / ThrottlingException → kms_throttled
// (both retryable; the api answers 503 crypto_unavailable, E18); InvalidCiphertext / IncorrectKey → unwrap_failed;
// any other 4xx → kms_rejected; a malformed answer → kms_bad_response.
import {
  KeyManagerError,
  WRAPPED_KEY_MAX_LENGTH,
  assertKeyVersion,
  assertOrgAndPurpose,
  assertWrapped,
  base64ToBytes,
  importDataKey,
  keyVersionOf,
} from './key-manager.js';
import type { DataKey, DataKeyHandle, KeyManager, KeyPurpose } from './key-manager.js';
import { AWS_REGION, signedAwsPost, validCredentials } from './messaging-aws.js';
import type { AwsCredentials, AwsFetch } from './messaging-aws.js';

export const KMS_REGION = AWS_REGION;
export const KMS_ENDPOINT = 'https://kms.ap-south-1.amazonaws.com/';
/** A KMS key ARN in ap-south-1 (key id or multi-Region key id). */
export const KMS_KEY_ARN_RE = /^arn:aws:kms:ap-south-1:[0-9]{12}:key\/[A-Za-z0-9-]{1,64}$/;

export interface AwsKmsKeyManagerOptions extends AwsCredentials {
  /** KMS_KEY_ARN. */
  keyArn: string;
  fetch: AwsFetch;
  /** The SigV4 signing clock. Default `() => new Date()`. */
  now?: () => Date;
  timeoutMs?: number;
}

/** The KMS EncryptionContext: string values only (KMS requires strings). */
const encryptionContext = (orgId: string, purpose: KeyPurpose, keyVersion: number) => ({
  org: orgId,
  purpose,
  kv: String(keyVersion),
});

const UNWRAP_FAILED_TYPES: readonly string[] = [
  'InvalidCiphertextException',
  'IncorrectKeyException',
];

export class AwsKmsKeyManager implements KeyManager {
  readonly #credentials: AwsCredentials;
  readonly #keyArn: string;
  readonly #fetch: AwsFetch;
  readonly #now: () => Date;
  readonly #timeoutMs: number;

  constructor(options: AwsKmsKeyManagerOptions) {
    if (typeof options !== 'object' || options === null) throw new KeyManagerError('bad_options');
    const { accessKeyId, secretAccessKey, sessionToken, keyArn, fetch, now, timeoutMs } = options;
    const credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken === undefined ? {} : { sessionToken }),
    };
    if (!validCredentials(credentials)) throw new KeyManagerError('bad_options');
    if (typeof keyArn !== 'string' || !KMS_KEY_ARN_RE.test(keyArn))
      throw new KeyManagerError('bad_options');
    if (typeof fetch !== 'function') throw new KeyManagerError('bad_options');
    if (now !== undefined && typeof now !== 'function') throw new KeyManagerError('bad_options');
    const timeout = timeoutMs ?? 5_000;
    if (
      typeof timeout !== 'number' ||
      !Number.isInteger(timeout) ||
      timeout < 100 ||
      timeout > 60_000
    ) {
      throw new KeyManagerError('bad_options');
    }
    this.#credentials = credentials;
    this.#keyArn = keyArn;
    this.#fetch = fetch;
    this.#now = now ?? (() => new Date());
    this.#timeoutMs = timeout;
  }

  async #call(
    target: 'GenerateDataKey' | 'Decrypt',
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await signedAwsPost({
        url: KMS_ENDPOINT,
        service: 'kms',
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': `TrentService.${target}`,
        },
        body: JSON.stringify(body),
        credentials: this.#credentials,
        now: this.#now,
        fetch: this.#fetch,
        timeoutMs: this.#timeoutMs,
      });
    } catch {
      throw new KeyManagerError('kms_unavailable');
    }
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const type = (parsed as { __type?: unknown } | null)?.__type;
    const typeName = typeof type === 'string' ? (type.split('#').pop() ?? '') : '';
    if (res.status >= 500) throw new KeyManagerError('kms_unavailable');
    if (res.status === 429 || typeName === 'ThrottlingException')
      throw new KeyManagerError('kms_throttled');
    if (res.status < 200 || res.status >= 300) {
      if (UNWRAP_FAILED_TYPES.includes(typeName)) throw new KeyManagerError('unwrap_failed');
      throw new KeyManagerError('kms_rejected');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new KeyManagerError('kms_bad_response');
    }
    return parsed as Record<string, unknown>;
  }

  async generateDataKey(
    orgId: string,
    purpose: KeyPurpose,
    options?: { keyVersion?: number },
  ): Promise<DataKey> {
    assertOrgAndPurpose(orgId, purpose);
    const keyVersion = keyVersionOf(options);
    const out = await this.#call('GenerateDataKey', {
      KeyId: this.#keyArn,
      KeySpec: 'AES_256',
      EncryptionContext: encryptionContext(orgId, purpose, keyVersion),
    });
    const { CiphertextBlob, Plaintext, KeyId } = out;
    if (
      typeof CiphertextBlob !== 'string' ||
      CiphertextBlob.length > WRAPPED_KEY_MAX_LENGTH ||
      base64ToBytes(CiphertextBlob) === null ||
      CiphertextBlob.length === 0 ||
      KeyId !== this.#keyArn ||
      typeof Plaintext !== 'string'
    ) {
      throw new KeyManagerError('kms_bad_response');
    }
    const raw = base64ToBytes(Plaintext);
    if (raw === null) throw new KeyManagerError('kms_bad_response');
    const plaintext = await importDataKey(raw, purpose);
    return { plaintext, wrapped: CiphertextBlob, keyVersion, kmsKeyRef: this.#keyArn };
  }

  async unwrap(
    orgId: string,
    purpose: KeyPurpose,
    wrapped: string,
    kmsKeyRef: string,
    keyVersion: number,
  ): Promise<DataKeyHandle> {
    assertOrgAndPurpose(orgId, purpose);
    assertWrapped(wrapped);
    if (typeof kmsKeyRef !== 'string' || !KMS_KEY_ARN_RE.test(kmsKeyRef)) {
      throw new KeyManagerError('bad_key_ref');
    }
    assertKeyVersion(keyVersion);
    const out = await this.#call('Decrypt', {
      CiphertextBlob: wrapped,
      KeyId: kmsKeyRef,
      EncryptionContext: encryptionContext(orgId, purpose, keyVersion),
    });
    const { Plaintext, KeyId } = out;
    if (KeyId !== kmsKeyRef || typeof Plaintext !== 'string')
      throw new KeyManagerError('kms_bad_response');
    const raw = base64ToBytes(Plaintext);
    if (raw === null) throw new KeyManagerError('kms_bad_response');
    return importDataKey(raw, purpose);
  }
}
