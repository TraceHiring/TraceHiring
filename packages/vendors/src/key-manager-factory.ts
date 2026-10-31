// createKeyManager (specs/m2-scheduling-invites.md M2-3, AT-M2-33; build-notes 2026-10-31 g: KEY_MANAGER_PROVIDER =
// dev | kms): picks the KeyManager for TRACE_ENV. Production refuses DevKeyManager (AT-M2-33); `kms` runs in every
// environment (dev, staging and production) with its own credentials and key ARN. With `cache`, the manager is
// wrapped in CachingKeyManager (≤ 300 s, §6.3).
import { CachingKeyManager } from './key-manager-cache.js';
import type { CachingKeyManagerOptions } from './key-manager-cache.js';
import { DevKeyManager } from './key-manager-dev.js';
import { AwsKmsKeyManager } from './key-manager-kms.js';
import type { AwsKmsKeyManagerOptions } from './key-manager-kms.js';
import { KeyManagerError } from './key-manager.js';
import type { KeyManager } from './key-manager.js';

export type KeyManagerProvider = 'dev' | 'kms';
const TRACE_ENVS: readonly string[] = ['dev', 'staging', 'production'];
/** Where each provider may run. */
export const KEY_MANAGER_PROVIDER_ENVS: Readonly<Record<KeyManagerProvider, readonly string[]>> = {
  dev: ['dev', 'staging'],
  kms: ['dev', 'staging', 'production'],
};

export interface CreateKeyManagerOptions {
  /** TRACE_ENV. */
  traceEnv: unknown;
  /** KEY_MANAGER_PROVIDER. */
  provider: unknown;
  /** The DevKeyManager key-encryption key (≥ 32 bytes; devKekFromBase64 decodes the secret). */
  devKek?: Uint8Array;
  kms?: AwsKmsKeyManagerOptions;
  cache?: CachingKeyManagerOptions;
}

export function createKeyManager(options: CreateKeyManagerOptions): KeyManager {
  if (typeof options !== 'object' || options === null) throw new KeyManagerError('bad_options');
  const { traceEnv, provider } = options;
  if (typeof traceEnv !== 'string' || !TRACE_ENVS.includes(traceEnv)) {
    throw new KeyManagerError('env_refused');
  }
  if (provider !== 'dev' && provider !== 'kms') throw new KeyManagerError('unknown_provider');
  if (!KEY_MANAGER_PROVIDER_ENVS[provider].includes(traceEnv)) {
    throw new KeyManagerError('provider_refused');
  }
  let manager: KeyManager;
  if (provider === 'dev') {
    if (options.devKek === undefined) throw new KeyManagerError('bad_options');
    manager = new DevKeyManager(traceEnv, { kek: options.devKek });
  } else {
    if (options.kms === undefined) throw new KeyManagerError('bad_options');
    manager = new AwsKmsKeyManager(options.kms);
  }
  return options.cache === undefined ? manager : new CachingKeyManager(manager, options.cache);
}
