// Constant `{ error: { code } }` answers for the integrity card module (spec §6.2). Rule 1 / L-19: this module
// imports no neutral module, so it keeps its own copy of the code table. An error thrown by the shared row source is
// recognised structurally (an Error named OrgError with a known code); anything else is a bug and is rethrown to the
// app's error handler (redacted report, constant 500). Nothing here echoes input.

const STATUS = {
  bad_request: 400,
  unauthorized: 401,
  aal2_required: 403,
  not_found: 404,
  conflict: 409,
  cutoff_required: 422,
  rate_limited: 429,
  unavailable: 503,
} as const;

export type IntegrityErrorCode = keyof typeof STATUS;

export class IntegrityRouteError extends Error {
  readonly code: IntegrityErrorCode;
  constructor(code: IntegrityErrorCode) {
    super(code);
    this.name = 'IntegrityRouteError';
    this.code = code;
  }
}

export const integrityFail = (code: IntegrityErrorCode): never => {
  throw new IntegrityRouteError(code);
};

const isCode = (value: unknown): value is IntegrityErrorCode =>
  typeof value === 'string' && Object.hasOwn(STATUS, value);

export const integrityJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

/** The constant answer for a known error, or null for anything else (the caller rethrows it). */
export const integrityErrorAnswer = (err: unknown): Response | null => {
  if (!(err instanceof Error)) return null;
  if (err.name !== 'IntegrityRouteError' && err.name !== 'OrgError') return null;
  const code = (err as { code?: unknown }).code;
  if (!isCode(code)) return null;
  return integrityJson({ error: { code } }, STATUS[code]);
};
