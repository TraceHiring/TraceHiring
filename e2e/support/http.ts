// Small HTTP helpers for the API-level E2E specs. Failures carry the step, the HTTP status and the constant error
// code only (edge `{error}`, api `{error:{code}}`); never a body, token, link, code or password, because Playwright
// prints an error message in the CI log and the HTML report.
import type { APIResponse } from '@playwright/test';

/** A value scripts/e2e-local.mjs passes in the environment; its absence is a setup fault, not a skip. */
export const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set (scripts/e2e-local.mjs sets it)`);
  }
  return value;
};

const CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** The constant error code of a refusal, or null. */
export const errorCode = async (res: APIResponse): Promise<string | null> => {
  try {
    const body = (await res.json()) as { error?: unknown };
    const raw =
      typeof body.error === 'string'
        ? body.error
        : typeof body.error === 'object' && body.error !== null
          ? (body.error as { code?: unknown }).code
          : undefined;
    return typeof raw === 'string' && CODE.test(raw) ? raw : null;
  } catch {
    return null;
  }
};

/** Throws `<what>: expected HTTP <n>, got <m> (<code>)` unless the status matches. */
export const expectStatus = async (res: APIResponse, status: number, what: string) => {
  if (res.status() === status) return;
  const code = await errorCode(res);
  throw new Error(
    `${what}: expected HTTP ${status}, got ${res.status()}${code ? ` (${code})` : ''}`,
  );
};

/** The JSON body of an answer with the expected status. */
export const jsonOf = async <T>(res: APIResponse, status: number, what: string): Promise<T> => {
  await expectStatus(res, status, what);
  return (await res.json()) as T;
};

/** Expects a refusal with exactly this status and code. */
export const expectRefusal = async (
  res: APIResponse,
  status: number,
  code: string,
  what: string,
) => {
  const got = await errorCode(res);
  if (res.status() !== status || got !== code) {
    throw new Error(
      `${what}: expected HTTP ${status} (${code}), got ${res.status()}${got ? ` (${got})` : ''}`,
    );
  }
};

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Calls `probe` every `everyMs` until it returns a value, or throws `<what>: not within <n> s`. */
export const poll = async <T>(
  what: string,
  { timeoutMs, everyMs }: { timeoutMs: number; everyMs: number },
  probe: () => Promise<T | undefined>,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline)
      throw new Error(`${what}: not within ${Math.round(timeoutMs / 1000)} s`);
    await sleep(everyMs);
  }
};

/** The sorted keys of an object, for exact-shape checks that never print a value. */
export const keysOf = (value: unknown): string[] =>
  typeof value === 'object' && value !== null ? Object.keys(value).sort() : [];
