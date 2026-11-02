// The candidate app's only network client and its only `fetch` caller (specs/d1-demo-slice.md §4.2, §4.7).
// It talks to the edge Worker only: JSON with `Content-Type: application/json` exactly, `Authorization: Bearer` (no
// cookies, no credentials), and narrows every answer by status plus a small hand check, because the bundle imports the
// zod contracts as types only (spec D3). Errors are the edge's constant codes; a body that does not fit is read
// defensively. Nothing here logs: a token, code, link or answer never reaches the logger.
import type {
  AgeDeclareReq,
  CandidateErrorCode,
  ConsentReq,
  EventBatchAck,
  EventBatchReq,
  InviteResolveRes,
  NoticeRes,
  OkRes,
  OtpRequestRes,
  OtpVerifyRes,
  PhotoRes,
  Receipt,
  ServedItem,
  SessionAttachRes,
  SessionStartReq,
  SessionStartRes,
  SessionView,
  SubmitReq,
} from '@trace/shared/contracts/candidate';

/** The edge's status for each constant code; api.test.ts checks it equals the contract's table. */
export const ERROR_STATUS: Record<CandidateErrorCode, number> = {
  bad_request: 400,
  token_invalid: 401,
  token_expired: 401,
  superseded: 401,
  otp_wrong: 401,
  not_eligible: 403,
  step_required: 403,
  invalid_link: 404,
  link_expired: 410,
  link_revoked: 410,
  closed: 410,
  out_of_order: 409,
  too_large: 413,
  bad_media: 415,
  otp_locked: 429,
  resend_too_soon: 429,
  rate_limited: 429,
  unavailable: 503,
};

/** A constant code, `network` (no answer reached us) or `unexpected` (an answer that fits no contract). */
export type ApiCode = CandidateErrorCode | 'network' | 'unexpected';

export interface ApiFailure {
  ok: false;
  code: ApiCode;
  /** HTTP status, 0 for a network failure. */
  status: number;
  retryAfterSeconds?: number;
  /** 409 `out_of_order`: the stream's high-water mark; resend from `ackSeq + 1`. */
  ackSeq?: number;
}

export type ApiResult<T> = { ok: true; value: T } | ApiFailure;

/** Codes and failures the app treats as "offline": nothing reached the server, or it is unavailable (RT-1, RT-11). */
export const isOffline = (f: ApiFailure): boolean =>
  f.code === 'network' || f.code === 'unavailable' || f.code === 'unexpected';

// ---- The edge origin (fail closed) ----------------------------------------------------------------------------

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * The edge origin from the build (`VITE_EDGE_ORIGIN`): an `https:` origin, or `http:` on 127.0.0.1 / localhost only,
 * with no path, query, fragment or user info. Anything else is null and the app shows "unavailable" (never a guess).
 */
export const resolveEdgeOrigin = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim() !== value || value === '') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === 'https:';
  const local = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (!secure && !local) return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return null;
  if (value !== url.origin && value !== `${url.origin}/`) return null;
  return url.origin;
};

// ---- Hand checks ------------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isText = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= max;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const isTime = (v: unknown): v is string =>
  typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const isSha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const JWS = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const isJws = (v: unknown): v is string => typeof v === 'string' && v.length <= 2048 && JWS.test(v);
const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as string[]).includes(v);
const isOptionId = (v: unknown): v is string => isText(v, 64);
const isPosition = (v: unknown): v is number => isInt(v, 1);

const isInvitationState = oneOf(
  'created',
  'sent',
  'otp_verified',
  'started',
  'submitted',
  'expired',
  'revoked',
  'blocked_age',
);
const isSessionState = oneOf('in_progress', 'submitted', 'auto_submitted');
const isLobbyNext = oneOf('age', 'consent', 'photo', 'start');
const isItemKind = oneOf('mcq', 'written');

export const isOk = (v: unknown): v is OkRes => isObj(v) && v['ok'] === true;

export const isInviteResolveRes = (v: unknown): v is InviteResolveRes =>
  isObj(v) &&
  isInvitationState(v['state']) &&
  (v['title'] === undefined || isText(v['title'], 200)) &&
  (v['durationMinutes'] === undefined || isInt(v['durationMinutes'], 1, 120));

export const isOtpRequestRes = (v: unknown): v is OtpRequestRes =>
  isObj(v) &&
  isInt(v['resendAfterSeconds'], 0, 3600) &&
  isInt(v['expiresInSeconds'], 1, 3600) &&
  v['channel'] === 'email';

export const isOtpVerifyRes = (v: unknown): v is OtpVerifyRes =>
  isObj(v) && isJws(v['lobbyToken']) && isTime(v['expiresAt']) && isLobbyNext(v['next']);

export const isNoticeRes = (v: unknown): v is NoticeRes =>
  isObj(v) &&
  isUuid(v['noticeVersionId']) &&
  v['language'] === 'en' &&
  isText(v['bodyText'], 20000) &&
  isSha(v['renderedSha256']);

export const isPhotoRes = (v: unknown): v is PhotoRes =>
  isObj(v) && isSha(v['sha256']) && isInt(v['bytes'], 1, 512000);

export const isReceipt = (v: unknown): v is Receipt =>
  isObj(v) &&
  typeof v['receiptRef'] === 'string' &&
  /^[0-9A-HJKMNP-TV-Z]{8}$/.test(v['receiptRef']) &&
  isTime(v['submittedAt']);

const isAnswer = (v: unknown): boolean =>
  isObj(v) &&
  isPosition(v['position']) &&
  ((typeof v['text'] === 'string' && v['choice'] === undefined) ||
    (isOptionId(v['choice']) && v['text'] === undefined));

const isArrayOf = (v: unknown, check: (x: unknown) => boolean, min: number, max: number) =>
  Array.isArray(v) && v.length >= min && v.length <= max && v.every(check);

export const isSessionView = (v: unknown): v is SessionView =>
  isObj(v) &&
  isUuid(v['sessionId']) &&
  isSessionState(v['state']) &&
  isTime(v['serverNow']) &&
  isTime(v['startedAt']) &&
  isTime(v['deadlineAt']) &&
  isUuid(v['streamId']) &&
  v['heartbeatSeconds'] === 10 &&
  typeof v['pasteBlocked'] === 'boolean' &&
  isText(v['title'], 200) &&
  isArrayOf(
    v['sections'],
    (s) => isObj(s) && isUuid(s['id']) && isText(s['title'], 120) && isPosition(s['position']),
    1,
    10,
  ) &&
  isArrayOf(
    v['items'],
    (i) =>
      isObj(i) &&
      isPosition(i['position']) &&
      isUuid(i['sectionId']) &&
      isItemKind(i['kind']) &&
      (i['servedAt'] === null || isTime(i['servedAt'])),
    1,
    100,
  ) &&
  isArrayOf(v['answers'], isAnswer, 0, 100) &&
  (v['receipt'] === undefined || isReceipt(v['receipt']));

export const isSessionStartRes = (v: unknown): v is SessionStartRes =>
  isObj(v) &&
  ((isJws(v['sessionToken']) && isTime(v['expiresAt']) && isSessionView(v['view'])) ||
    (v['state'] === 'submitted' && isReceipt(v['receipt'])));

export const isSessionAttachRes = (v: unknown): v is SessionAttachRes =>
  isObj(v) && isSessionView(v['view']);

export const isServedItem = (v: unknown): v is ServedItem => {
  if (
    !isObj(v) ||
    !isPosition(v['position']) ||
    !isItemKind(v['kind']) ||
    !isUuid(v['sectionId']) ||
    !isText(v['prompt'], 4000) ||
    !isTime(v['servedAt'])
  )
    return false;
  if (v['maxChars'] !== undefined && !isInt(v['maxChars'], 1, 10000)) return false;
  if (v['kind'] === 'mcq') {
    return (
      v['maxChars'] === undefined &&
      isArrayOf(
        v['options'],
        (o) => isObj(o) && isOptionId(o['id']) && isText(o['label'], 500),
        2,
        6,
      )
    );
  }
  return v['options'] === undefined;
};

export const isEventBatchAck = (v: unknown): v is EventBatchAck =>
  isObj(v) &&
  isInt(v['ackSeq'], 0) &&
  isTime(v['serverNow']) &&
  isTime(v['deadlineAt']) &&
  isSessionState(v['state']);

// ---- Failures --------------------------------------------------------------------------------------------------

const isCode = (v: unknown): v is CandidateErrorCode =>
  typeof v === 'string' && Object.hasOwn(ERROR_STATUS, v);

/** Integer seconds of a `Retry-After` header (a date form is ignored). */
const retryAfter = (res: Response): number | undefined => {
  const raw = res.headers.get('retry-after');
  if (raw === null || !/^\d{1,5}$/.test(raw.trim())) return undefined;
  return Number(raw.trim());
};

/** Status-only fallbacks for a body that names no contract code (proxies, platform errors). */
const BY_STATUS: Partial<Record<number, CandidateErrorCode>> = {
  413: 'too_large',
  429: 'rate_limited',
  503: 'unavailable',
};

const failureOf = (res: Response, body: unknown): ApiFailure => {
  const status = res.status;
  const wait = retryAfter(res);
  const extra = wait === undefined ? {} : { retryAfterSeconds: wait };
  const named = isObj(body) ? body['error'] : undefined;
  if (isCode(named) && ERROR_STATUS[named] === status) {
    if (named === 'out_of_order') {
      const ackSeq = isObj(body) ? body['ackSeq'] : undefined;
      if (!isInt(ackSeq, 0)) return { ok: false, code: 'unexpected', status };
      return { ok: false, code: named, status, ackSeq };
    }
    return { ok: false, code: named, status, ...extra };
  }
  const fallback = BY_STATUS[status];
  if (fallback !== undefined) return { ok: false, code: fallback, status, ...extra };
  return { ok: false, code: 'unexpected', status };
};

// ---- Requests --------------------------------------------------------------------------------------------------

const TIMEOUT_MS = 30_000;
const JSON_TYPE = 'application/json';

interface Send {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  bearer?: string;
  json?: unknown;
  raw?: { body: Uint8Array; headers: Record<string, string> };
}

const timeoutSignal = (): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(TIMEOUT_MS)
    : undefined;

export interface CandidateApi {
  resolve(linkToken: string): Promise<ApiResult<InviteResolveRes>>;
  otpRequest(linkToken: string): Promise<ApiResult<OtpRequestRes>>;
  otpVerify(linkToken: string, otp: string): Promise<ApiResult<OtpVerifyRes>>;
  age(lobbyToken: string, adult: AgeDeclareReq['adult']): Promise<ApiResult<OkRes>>;
  notice(lobbyToken: string): Promise<ApiResult<NoticeRes>>;
  consent(lobbyToken: string, body: ConsentReq): Promise<ApiResult<OkRes>>;
  photo(lobbyToken: string, jpeg: Uint8Array, sha256: string): Promise<ApiResult<PhotoRes>>;
  start(lobbyToken: string, body: SessionStartReq): Promise<ApiResult<SessionStartRes>>;
  attach(sessionToken: string): Promise<ApiResult<SessionAttachRes>>;
  item(sessionToken: string, position: number): Promise<ApiResult<ServedItem>>;
  events(sessionToken: string, batch: EventBatchReq): Promise<ApiResult<EventBatchAck>>;
  submit(sessionToken: string, body: SubmitReq): Promise<ApiResult<Receipt>>;
}

/** The client for one edge origin (from `resolveEdgeOrigin`). */
export const createApi = (origin: string): CandidateApi => {
  const send = async <T>(req: Send, check: (v: unknown) => v is T): Promise<ApiResult<T>> => {
    const headers: Record<string, string> = {};
    if (req.bearer !== undefined) headers['authorization'] = `Bearer ${req.bearer}`;
    let body: BodyInit | undefined;
    if (req.json !== undefined) {
      headers['content-type'] = JSON_TYPE;
      body = JSON.stringify(req.json);
    } else if (req.raw !== undefined) {
      Object.assign(headers, req.raw.headers);
      body = req.raw.body as BodyInit;
    }
    let res: Response;
    try {
      const signal = timeoutSignal();
      res = await globalThis.fetch(`${origin}${req.path}`, {
        method: req.method,
        headers,
        ...(body === undefined ? {} : { body }),
        credentials: 'omit',
        cache: 'no-store',
        mode: 'cors',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      return { ok: false, code: 'network', status: 0 };
    }
    let parsed: unknown = undefined;
    try {
      const text = await res.text();
      parsed = text === '' ? undefined : (JSON.parse(text) as unknown);
    } catch {
      parsed = undefined;
    }
    if (res.status === 200) {
      return check(parsed)
        ? { ok: true, value: parsed }
        : { ok: false, code: 'unexpected', status: 200 };
    }
    return failureOf(res, parsed);
  };

  return {
    resolve: (token) =>
      send({ method: 'POST', path: '/v1/invite/resolve', json: { token } }, isInviteResolveRes),
    otpRequest: (token) =>
      send({ method: 'POST', path: '/v1/otp/request', json: { token } }, isOtpRequestRes),
    otpVerify: (token, otp) =>
      send({ method: 'POST', path: '/v1/otp/verify', json: { token, code: otp } }, isOtpVerifyRes),
    age: (bearer, adult) =>
      send({ method: 'POST', path: '/v1/lobby/age', bearer, json: { adult } }, isOk),
    notice: (bearer) => send({ method: 'GET', path: '/v1/lobby/notice', bearer }, isNoticeRes),
    consent: (bearer, body) =>
      send({ method: 'POST', path: '/v1/lobby/consent', bearer, json: body }, isOk),
    photo: (bearer, jpeg, sha256) =>
      send(
        {
          method: 'PUT',
          path: '/v1/lobby/photo',
          bearer,
          raw: { body: jpeg, headers: { 'content-type': 'image/jpeg', 'x-photo-sha256': sha256 } },
        },
        isPhotoRes,
      ),
    start: (bearer, body) =>
      send({ method: 'POST', path: '/v1/session/start', bearer, json: body }, isSessionStartRes),
    attach: (bearer) =>
      send({ method: 'POST', path: '/v1/session/attach', bearer, json: {} }, isSessionAttachRes),
    item: async (bearer, position) => {
      if (!isInt(position, 1, 999)) return { ok: false, code: 'bad_request', status: 0 };
      return send({ method: 'GET', path: `/v1/session/items/${position}`, bearer }, isServedItem);
    },
    events: (bearer, batch) =>
      send({ method: 'POST', path: '/v1/session/events', bearer, json: batch }, isEventBatchAck),
    submit: (bearer, body) =>
      send({ method: 'POST', path: '/v1/session/submit', bearer, json: body }, isReceipt),
  };
};
