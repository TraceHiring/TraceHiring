// Build version handling (spec §9.3, §9.4): a commit SHA injected at build time, or 'dev'.
import { Version } from './contracts.js';

export { Version };

export const resolveVersion = (candidate: string | undefined): string =>
  candidate !== undefined && Version.safeParse(candidate).success ? candidate : 'dev';
