// Helpers for the real-DO tests (`*.real.test.ts`, the `edge-do` pool of vitest.config.ts). The deployed Env types every
// binding as optional (the top level of wrangler.jsonc binds only VERSION), so a test asks for a binding by name and
// fails loudly when the pool did not bind it. Object names are random per test: storage persists across the tests of
// a file, so no two tests share an object.
import { env } from 'cloudflare:workers';

type Bound = Required<Pick<Env, 'SESSION' | 'OTP' | 'EVIDENCE' | 'MIRROR_QUEUE'>>;

/** The named binding of the `edge-do` pool; throws when it is missing. */
export const bound = <K extends keyof Bound>(name: K): Bound[K] => {
  const value = env[name];
  if (value === undefined) throw new Error(`the edge-do pool has no ${name} binding`);
  return value as Bound[K];
};

/** A stub of the object named `name` (a fresh random name when omitted). */
export const otpStub = (name: string = crypto.randomUUID()) => {
  const ns = bound('OTP');
  return ns.get(ns.idFromName(name));
};

export const sessionStub = (name: string = crypto.randomUUID()) => {
  const ns = bound('SESSION');
  return ns.get(ns.idFromName(name));
};
