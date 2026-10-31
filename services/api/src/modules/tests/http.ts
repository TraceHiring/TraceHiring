// Request and answer helpers for the org modules (spec §6.2: JSON in and out, errors never echo input; spec m1 R5-53 d,
// R5-56 f). A body is read as a byte stream under the route's cap (declared or not), decoded as UTF-8, then parsed; a
// key that could reach an object's prototype chain (`__proto__`, `constructor`, `prototype`) is refused at any depth.
// Anything else is a 400 `bad_request`. Zod issues are never returned.
import { OrgError, orgFail, orgJson } from './org-context.js';

/** Bodies above this are refused before parsing (a full D1 draft is about 60 KB). The default of every route. */
export const MAX_ORG_BODY_BYTES = 256 * 1024;

const MiB = 1024 * 1024;

/**
 * Per-route caps (R5-53 d). Each admits the largest request its contract allows with ordinary text (UTF-8, up to three
 * bytes a character, plus JSON punctuation): `SaveTestDraftRequest` holds up to 200 inline items of a 4,000-character
 * stem and six 500-character options (about 7,000 characters each, about 4.2 MB at three bytes a character);
 * `ImportRowsRequest` holds 100 rows with a stem, six options and a param spec (about 13,000 characters each, about
 * 3.9 MB). Both get 8 MiB.
 */
export const BODY_CAPS = {
  default: MAX_ORG_BODY_BYTES,
  saveTestDraft: 8 * MiB,
  importRows: 8 * MiB,
} as const;

const PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class ProtoKey extends Error {}

const readCapped = async (request: Request, maxBytes: number): Promise<Uint8Array> => {
  const body = request.body;
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return orgFail('bad_request');
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
};

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
    const bytes = await readCapped(request, maxBytes);
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch (err) {
    if (err instanceof OrgError) throw err;
    return orgFail('bad_request');
  }
  try {
    return JSON.parse(text, (key, value: unknown) => {
      if (PROTO_KEYS.has(key)) throw new ProtoKey();
      return value;
    }) as unknown;
  } catch {
    return orgFail('bad_request');
  }
};

type Validator<T> = {
  safeParse(v: unknown): { success: true; data: T } | { success: false };
};

/** Parses `body` with `schema`, or fails with 400 `bad_request`. */
export const parseBody = <T>(schema: Validator<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  return r.success ? r.data : orgFail('bad_request');
};

/**
 * The query string as an object of single values, parsed with a strict `schema`: a key given twice, a key the schema
 * does not know, or a value it refuses is 400 `bad_request`.
 */
export const readQuery = <T>(url: string, schema: Validator<T>): T => {
  const params = new URL(url).searchParams;
  const out: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(out, key) || PROTO_KEYS.has(key)) return orgFail('bad_request');
    out[key] = value;
  }
  return parseBody(schema, out);
};

/** Every answer is parsed against its contract first; a row that does not fit is `unavailable`, never echoed. */
export const answer = <T>(schema: Validator<T>, body: unknown, status = 200): Response => {
  const out = schema.safeParse(body);
  return out.success ? orgJson(out.data, status) : orgFail('unavailable');
};

/** 204 with no body (R5-53 c: `DELETE …/settings/integrity-locks/:settingKey`). */
export const noContent = (): Response =>
  new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
