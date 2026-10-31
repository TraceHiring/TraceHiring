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
  ServedItemV2,
  SessionAttachRes,
  SessionAttachResV2,
  SessionStartReq,
  SessionStartRes,
  SessionStartResV2,
  SessionView,
  SessionViewV2,
  SubmitReq,
} from '@trace/shared/contracts/candidate';

/** A v1 (D1) or v2 (M1, R5-9) session view: `v: 2` tells them apart. */
export type AnyView = SessionView | SessionViewV2;
/** A v1 or v2 served item. */
export type AnyItem = ServedItem | ServedItemV2;

export const isV2 = (view: AnyView): view is SessionViewV2 => 'v' in view && view.v === 2;

/** Item images (R5-66 e): only these types, at most 1 MiB (the edge's own cap, item-media.ts). */
export const ITEM_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ItemImageType = (typeof ITEM_IMAGE_TYPES)[number];
export const ITEM_IMAGE_MAX_BYTES = 1_048_576;

/** The bytes of one item image, as the edge served them. Never stored; the screen shows them as a `data:` URL. */
export interface ItemImage {
  type: ItemImageType;
  bytes: Uint8Array;
}

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
  section_closed: 410,
  out_of_order: 409,
  // M2 (R5-23); the screens for them come with B6.
  outside_start_window: 409,
  lobby_closed: 409,
  reschedule_used: 409,
  too_late_to_reschedule: 409,
  slot_full: 409,
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
  /**
   * 409 `out_of_order` on events (R5-67): the seqs of the part the edge kept that it recorded as refused, checked as
   * an ack's (distinct, each <= `ackSeq`, at most 100). Absent when none.
   */
  refusedSeqs?: number[];
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

const isNavigation = oneOf('free', 'forward_only');
const isPasteRule = oneOf('blocked', 'allowed_logged');
const isSectionState = oneOf('not_entered', 'open', 'closed');

/** R5-24 (the contract's section rule): a written section is forward-only with a paste rule; no other has one. */
const sectionRulesOk = (s: Obj): boolean =>
  s['format'] === 'written'
    ? s['navigation'] === 'forward_only' && s['pasteRule'] !== undefined
    : s['pasteRule'] === undefined;

const isSectionV2 = (s: unknown): boolean =>
  isObj(s) &&
  isUuid(s['id']) &&
  isText(s['title'], 120) &&
  isPosition(s['position']) &&
  isItemKind(s['format']) &&
  isNavigation(s['navigation']) &&
  (s['pasteRule'] === undefined || isPasteRule(s['pasteRule'])) &&
  isSectionState(s['state']) &&
  (s['deadlineAt'] === undefined || isTime(s['deadlineAt'])) &&
  sectionRulesOk(s);

/** The v2 view (M1, R5-9): sections carry format, navigation, paste rule, state and deadline; no `pasteBlocked`. */
export const isSessionViewV2 = (v: unknown): v is SessionViewV2 => {
  if (
    !isObj(v) ||
    v['v'] !== 2 ||
    !isUuid(v['sessionId']) ||
    !isSessionState(v['state']) ||
    !isTime(v['serverNow']) ||
    !isTime(v['startedAt']) ||
    !isTime(v['deadlineAt']) ||
    !isUuid(v['streamId']) ||
    v['heartbeatSeconds'] !== 10 ||
    v['pasteBlocked'] !== undefined ||
    !isText(v['title'], 200) ||
    !isArrayOf(v['sections'], isSectionV2, 1, 10)
  )
    return false;
  const sectionIds = new Set((v['sections'] as Obj[]).map((s) => s['id']));
  return (
    isArrayOf(
      v['items'],
      (i) =>
        isObj(i) &&
        isPosition(i['position']) &&
        isUuid(i['sectionId']) &&
        sectionIds.has(i['sectionId']) &&
        isItemKind(i['kind']) &&
        (i['servedAt'] === null || isTime(i['servedAt'])),
      1,
      100,
    ) &&
    isArrayOf(v['answers'], isAnswer, 0, 100) &&
    (v['receipt'] === undefined || isReceipt(v['receipt']))
  );
};

/** A v1 or a v2 view. A v1 view has no `v` key (D1). */
export const isAnyView = (v: unknown): v is AnyView =>
  isObj(v) && (v['v'] === undefined ? isSessionView(v) : isSessionViewV2(v));

export const isSessionStartRes = (v: unknown): v is SessionStartRes | SessionStartResV2 =>
  isObj(v) &&
  ((isJws(v['sessionToken']) && isTime(v['expiresAt']) && isAnyView(v['view'])) ||
    (v['state'] === 'submitted' && isReceipt(v['receipt'])));

export const isSessionAttachRes = (v: unknown): v is SessionAttachRes | SessionAttachResV2 =>
  isObj(v) && isAnyView(v['view']);

/** The fields a v1 and a v2 item share, and the mcq/written shape rule. */
const isItemBase = (v: Obj): boolean => {
  if (
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

export const isServedItem = (v: unknown): v is ServedItem => isObj(v) && isItemBase(v);

/** A v2 item: options already in served order, images by hash (1-4), a variant id on mcq items only. */
export const isServedItemV2 = (v: unknown): v is ServedItemV2 =>
  isObj(v) &&
  isItemBase(v) &&
  (v['media'] === undefined ||
    isArrayOf(v['media'], (m) => isObj(m) && isSha(m['hash']) && isText(m['alt'], 300), 1, 4)) &&
  (v['variantId'] === undefined || (v['kind'] === 'mcq' && isUuid(v['variantId'])));

/** `refusedSeqs` (R5-20): distinct, each acknowledged (≤ ackSeq). */
const isRefusedSeqs = (v: unknown, ackSeq: number): boolean =>
  isArrayOf(v, (s) => isPosition(s) && s <= ackSeq, 0, 100) &&
  new Set(v as number[]).size === (v as number[]).length;

export const isEventBatchAck = (v: unknown): v is EventBatchAck =>
  isObj(v) &&
  isInt(v['ackSeq'], 0) &&
  isTime(v['serverNow']) &&
  isTime(v['deadlineAt']) &&
  isSessionState(v['state']) &&
  (v['refusedSeqs'] === undefined || isRefusedSeqs(v['refusedSeqs'], v['ackSeq']));

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
      const refused = isObj(body) ? body['refusedSeqs'] : undefined;
      if (refused === undefined) return { ok: false, code: named, status, ackSeq };
      if (!isRefusedSeqs(refused, ackSeq)) return { ok: false, code: 'unexpected', status };
      return { ok: false, code: named, status, ackSeq, refusedSeqs: refused as number[] };
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
  start(
    lobbyToken: string,
    body: SessionStartReq,
  ): Promise<ApiResult<SessionStartRes | SessionStartResV2>>;
  attach(sessionToken: string): Promise<ApiResult<SessionAttachRes | SessionAttachResV2>>;
  /**
   * One served item. `afterSeq` (v2 sessions only, R5-45, R5-59 d): the highest seq the outbox has enqueued; a v1
   * session sends none, as in D1.
   */
  item(sessionToken: string, position: number, afterSeq?: number): Promise<ApiResult<AnyItem>>;
  events(sessionToken: string, batch: EventBatchReq): Promise<ApiResult<EventBatchAck>>;
  submit(sessionToken: string, body: SubmitReq): Promise<ApiResult<Receipt>>;
  /** An item image's bytes (R5-10): png, jpeg or webp up to 1 MiB, else a failure. */
  media(sessionToken: string, hash: string): Promise<ApiResult<ItemImage>>;
}

/** The media type of a response, without parameters, if it is an allowed item image type. */
const imageTypeOf = (res: Response): ItemImageType | null => {
  const raw = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return (ITEM_IMAGE_TYPES as readonly string[]).includes(raw) ? (raw as ItemImageType) : null;
};

/** Reads at most `max` bytes of a body; null when it is longer (the rest is cancelled, never buffered). */
const readCapped = async (res: Response, max: number): Promise<Uint8Array | null> => {
  const declared = res.headers.get('content-length');
  if (declared !== null && (!/^\d{1,10}$/.test(declared.trim()) || Number(declared) > max))
    return null;
  const reader = res.body?.getReader();
  if (reader === undefined) {
    const whole = new Uint8Array(await res.arrayBuffer());
    return whole.byteLength > max ? null : whole;
  }
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
};

const HASH = /^[0-9a-f]{64}$/;

/** The client for one edge origin (from `resolveEdgeOrigin`). */
export const createApi = (origin: string): CandidateApi => {
  /** The one network call: a Response, or null when nothing reached us. */
  const request = async (req: Send): Promise<Response | null> => {
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
    try {
      const signal = timeoutSignal();
      return await globalThis.fetch(`${origin}${req.path}`, {
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
      return null;
    }
  };

  /** A failure answer's body, read defensively. */
  const failureFrom = async (res: Response): Promise<ApiFailure> => {
    let parsed: unknown = undefined;
    try {
      const text = await res.text();
      parsed = text === '' ? undefined : (JSON.parse(text) as unknown);
    } catch {
      parsed = undefined;
    }
    return failureOf(res, parsed);
  };

  const send = async <T>(req: Send, check: (v: unknown) => v is T): Promise<ApiResult<T>> => {
    const res = await request(req);
    if (res === null) return { ok: false, code: 'network', status: 0 };
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
    item: async (bearer, position, afterSeq) => {
      if (!isInt(position, 1, 999)) return { ok: false, code: 'bad_request', status: 0 };
      if (afterSeq === undefined) {
        return send({ method: 'GET', path: `/v1/session/items/${position}`, bearer }, isServedItem);
      }
      if (!isInt(afterSeq, 0, 999_999_999_999_999)) {
        return { ok: false, code: 'bad_request', status: 0 };
      }
      return send(
        { method: 'GET', path: `/v1/session/items/${position}?afterSeq=${afterSeq}`, bearer },
        isServedItemV2,
      );
    },
    events: (bearer, batch) =>
      send({ method: 'POST', path: '/v1/session/events', bearer, json: batch }, isEventBatchAck),
    submit: (bearer, body) =>
      send({ method: 'POST', path: '/v1/session/submit', bearer, json: body }, isReceipt),
    media: async (bearer, hash) => {
      if (!HASH.test(hash)) return { ok: false, code: 'bad_request', status: 0 };
      const res = await request({ method: 'GET', path: `/v1/session/media/${hash}`, bearer });
      if (res === null) return { ok: false, code: 'network', status: 0 };
      if (res.status !== 200) return failureFrom(res);
      const type = imageTypeOf(res);
      let bytes: Uint8Array | null = null;
      try {
        bytes = type === null ? null : await readCapped(res, ITEM_IMAGE_MAX_BYTES);
      } catch {
        return { ok: false, code: 'network', status: 0 };
      }
      if (type === null || bytes === null) return { ok: false, code: 'bad_media', status: 200 };
      return { ok: true, value: { type, bytes } };
    },
  };
};
