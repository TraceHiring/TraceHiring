// The common edge rules of specs/d1-demo-slice.md §4.2: JSON in and out, `cache-control: no-store` on every answer,
// errors as `{ "error": "<code>" }` with a constant code (a Hono HTTPException whose message is that literal code),
// CORS for exactly `CANDIDATE_APP_ORIGIN`, body caps before parsing, and the identity keys discarded before a strict
// parse. Nothing here reads a header other than the ones it names, and nothing here logs.
import {
  CANDIDATE_ERROR_STATUS,
  discardIdentityKeys,
  type CandidateErrorCode,
} from '@trace/shared/contracts/candidate';
import { NO_STORE } from '@trace/workers-http';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

export type EdgeEnv = { Bindings: Env };
export type EdgeContext = Context<EdgeEnv>;

/** Body caps (§4.2), checked by bodyLimit before any parsing. */
export const LOBBY_BODY_LIMIT = 4 * 1024;
export const PHOTO_BODY_LIMIT = 512_000;

/** The answer for a constant code, with `Retry-After` on a 429 when the wait is known. */
export const errorResponse = (code: CandidateErrorCode, retryAfterSeconds?: number): Response => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...NO_STORE,
  };
  if (retryAfterSeconds !== undefined) {
    headers['retry-after'] = String(Math.max(1, Math.ceil(retryAfterSeconds)));
  }
  return new Response(JSON.stringify({ error: code }), {
    status: CANDIDATE_ERROR_STATUS[code],
    headers,
  });
};

/** A candidate error: thrown, answered by the shared 4xx path as is. The message is the literal code. */
export class EdgeError extends HTTPException {
  readonly code: CandidateErrorCode;

  constructor(code: CandidateErrorCode, retryAfterSeconds?: number) {
    const status = CANDIDATE_ERROR_STATUS[code] as ContentfulStatusCode;
    super(status, { message: code, res: errorResponse(code, retryAfterSeconds) });
    this.code = code;
  }
}

export const fail = (code: CandidateErrorCode, retryAfterSeconds?: number): never => {
  throw new EdgeError(code, retryAfterSeconds);
};

export const isEdgeError = (err: unknown): err is EdgeError => err instanceof EdgeError;

/**
 * Wraps a route handler so that a thrown EdgeError becomes its own answer. The shared error path answers only a 4xx
 * HTTPException as is; `unavailable` (503) is an answer the edge chose (fail closed), never a logged failure, so it
 * must not reach that path. Anything else still goes there (logged once, constant 500).
 */
export const handle =
  (fn: (c: EdgeContext) => Promise<Response>) =>
  async (c: EdgeContext): Promise<Response> => {
    try {
      return await fn(c);
    } catch (err) {
      if (isEdgeError(err)) return err.getResponse();
      throw err;
    }
  };

/** `cache-control: no-store` on every answer under /v1, including CORS preflights and errors. */
export const noStore: MiddlewareHandler<EdgeEnv> = async (c, next) => {
  await next();
  c.res.headers.set('cache-control', NO_STORE['cache-control']);
};

/** CORS for exactly the candidate app's origin (§4.2). An unset origin allows no cross-origin caller. */
export const candidateCors = (): MiddlewareHandler<EdgeEnv> =>
  cors({
    origin: (origin, c: EdgeContext) => {
      const allowed = c.env.CANDIDATE_APP_ORIGIN;
      return typeof allowed === 'string' && allowed !== '' && origin === allowed ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowHeaders: ['authorization', 'content-type', 'x-photo-sha256'],
    exposeHeaders: ['retry-after'],
    maxAge: 600,
    credentials: false,
  });

/** A body cap that answers 413 `too_large` before anything reads the body. */
export const capBody = (maxSize: number): MiddlewareHandler<EdgeEnv> =>
  bodyLimit({ maxSize, onError: () => fail('too_large') });

const isJson = (c: EdgeContext): boolean => {
  const type = c.req.header('content-type') ?? '';
  return /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type.trim());
};

/**
 * Reads a JSON body: `application/json` only (so a browser always preflights), parsed, the identity keys discarded
 * (ids come from verified claims only, AT-D11(b)), then the strict schema. Any problem is 400 `bad_request`.
 */
export const readJson = async <S extends z.ZodType>(
  c: EdgeContext,
  schema: S,
): Promise<z.infer<S>> => {
  if (!isJson(c)) return fail('bad_request');
  let raw: unknown;
  try {
    raw = JSON.parse(await c.req.text()) as unknown;
  } catch (err) {
    if (isEdgeError(err)) throw err;
    return fail('bad_request');
  }
  const parsed = schema.safeParse(discardIdentityKeys(raw));
  if (!parsed.success) return fail('bad_request');
  return parsed.data;
};

/** A JSON answer that is checked against its contract first: an answer that does not fit is `unavailable`. */
export const sendJson = <S extends z.ZodType>(
  c: EdgeContext,
  schema: S,
  body: z.input<S>,
): Response => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail('unavailable');
  return c.json(parsed.data as object, 200, NO_STORE);
};

/** The raw Bearer credential, or 401 `token_invalid`. No cookie is ever read (§4.2). */
export const bearer = (c: EdgeContext): string => {
  const header = c.req.header('authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_.-]{1,4096})$/.exec(header);
  return match?.[1] ?? fail('token_invalid');
};
