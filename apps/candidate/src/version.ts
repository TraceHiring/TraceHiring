// The build version the shell reports: VITE_APP_VERSION when it is a commit SHA, else "dev" (spec §9.3).
// The pattern is repeated from `Version` in @trace/shared/contracts, because the candidate bundle may
// not import the contracts (they pull in zod, spec D3); version.test.ts keeps the two in step.
const VERSION = /^[0-9a-f]{7,40}$|^dev$/;

export const resolveAppVersion = (value: unknown): string =>
  typeof value === 'string' && VERSION.test(value) ? value : 'dev';

export const APP_VERSION: string = resolveAppVersion(import.meta.env.VITE_APP_VERSION);
