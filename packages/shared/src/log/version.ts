// The shape of a release or logger version (spec §9.1, §9.3): a commit SHA or 'dev'. Internal (not
// exported from index.ts): the logger checks its config with it, the error reporter its ctx.
export const VERSION = /^[0-9a-f]{7,40}$|^dev$/;

export const isVersion = (value: unknown): value is string =>
  typeof value === 'string' && VERSION.test(value);
