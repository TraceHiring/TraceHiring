// AT-M2-33 (vendors half): createKeyManager refuses DevKeyManager in production; the env × provider matrix; the
// optional cache wrapper (specs/m2-scheduling-invites.md M2-3, R5-34, §6.3; build-notes 2026-10-31 g:
// KEY_MANAGER_PROVIDER = dev | kms). Key material is generated per run. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { CachingKeyManager } from './key-manager-cache.js';
import { DevKeyManager } from './key-manager-dev.js';
import { createKeyManager } from './key-manager-factory.js';
import type { CreateKeyManagerOptions } from './key-manager-factory.js';
import { AwsKmsKeyManager } from './key-manager-kms.js';
import { KeyManagerError } from './key-manager.js';
import {
  FIXED_DATE,
  jsonResponse,
  recordingFetch,
  testCredentials,
} from './messaging-sigv4.test-helpers.js';

const KEY_ARN = 'arn:aws:kms:ap-south-1:000000000000:key/00000000-0000-4000-8000-00000000beef';

const base = (traceEnv: unknown, provider: unknown, patch: Partial<CreateKeyManagerOptions> = {}) =>
  createKeyManager({
    traceEnv,
    provider,
    devKek: crypto.getRandomValues(new Uint8Array(32)),
    kms: {
      ...testCredentials(),
      keyArn: KEY_ARN,
      fetch: recordingFetch(() => jsonResponse(503, {})).fetch,
      now: () => FIXED_DATE,
    },
    ...patch,
  });

const configError = (fn: () => unknown): KeyManagerError => {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(KeyManagerError);
  return caught as KeyManagerError;
};

describe('createKeyManager (AT-M2-33)', () => {
  it('production refuses DevKeyManager', () => {
    const e = configError(() => base('production', 'dev'));
    expect(e.code).toBe('provider_refused');
    expect(e.retryable).toBe(false);
  });

  it.each([
    ['dev', 'dev', DevKeyManager],
    ['staging', 'dev', DevKeyManager],
    ['dev', 'kms', AwsKmsKeyManager],
    ['staging', 'kms', AwsKmsKeyManager],
    ['production', 'kms', AwsKmsKeyManager],
  ] as const)('%s × %s → %s', (env, provider, cls) => {
    expect(base(env, provider)).toBeInstanceOf(cls);
  });

  it.each([undefined, '', 'prod', 'Production', 'test'])('refuses traceEnv %j', (env) => {
    expect(configError(() => base(env, 'kms')).code).toBe('env_refused');
  });

  it.each([undefined, '', 'aws', 'KMS', 'mock'])('refuses provider %j', (provider) => {
    expect(configError(() => base('dev', provider)).code).toBe('unknown_provider');
  });

  it('refuses a provider whose options are missing', () => {
    expect(configError(() => createKeyManager({ traceEnv: 'dev', provider: 'dev' })).code).toBe(
      'bad_options',
    );
    expect(configError(() => createKeyManager({ traceEnv: 'staging', provider: 'kms' })).code).toBe(
      'bad_options',
    );
  });

  it('wraps the manager in the cache when a clock is given', () => {
    expect(base('staging', 'kms', { cache: { now: () => 0 } })).toBeInstanceOf(CachingKeyManager);
    expect(base('dev', 'dev', { cache: { now: () => 0, ttlMs: 60_000 } })).toBeInstanceOf(
      CachingKeyManager,
    );
  });

  it('a KMS outage surfaces as the typed retryable kms_unavailable (the api maps it to 503 crypto_unavailable)', async () => {
    const km = base('staging', 'kms');
    const e = await km
      .generateDataKey('00000000-0000-4000-8000-0000000000a1', 'contacts')
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(KeyManagerError);
    expect((e as KeyManagerError).code).toBe('kms_unavailable');
    expect((e as KeyManagerError).retryable).toBe(true);
  });
});
