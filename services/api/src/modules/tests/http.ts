// Request-body reading for the org modules (spec §6.2: JSON in and out, errors never echo input). The body is read
// as text under a byte cap, then parsed; anything else is a 400 `bad_request`. Zod issues are never returned.
import { orgFail } from './org-context.js';

/** Bodies above this are refused before parsing (a full D1 draft is about 60 KB). */
export const MAX_ORG_BODY_BYTES = 256 * 1024;

export const readJson = async (
  request: Request,
  maxBytes: number = MAX_ORG_BODY_BYTES,
): Promise<unknown> => {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^[0-9]{1,9}$/.test(declared) || Number(declared) > maxBytes)) {
    return orgFail('bad_request');
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return orgFail('bad_request');
  }
  if (new TextEncoder().encode(text).length > maxBytes) return orgFail('bad_request');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return orgFail('bad_request');
  }
};

/** Parses `body` with `schema`, or fails with the given code (default `bad_request`). */
export const parseBody = <T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  body: unknown,
): T => {
  const r = schema.safeParse(body);
  return r.success ? r.data : orgFail('bad_request');
};
