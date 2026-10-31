// Sentry scrubber (spec specs/m0-foundations.md §9.2 "Before D1: the Sentry adapter"; AT-9-sentry,
// d1 AT-D22). Used as `beforeSend` and `beforeBreadcrumb` by the recruiter app, workers/jobs and
// services/api; never by workers/edge or the candidate app.
//
// It rebuilds the event from an allow-list instead of deleting known fields, so a field a future SDK
// adds is dropped, not sent:
// - the request keeps only its URL (no query string or fragment) and method: headers, cookies,
//   query_string, data and env go; the user goes;
// - every URL loses its query string, including breadcrumb and frame URLs;
// - each exception value becomes serializeError's code, or "[REDACTED]";
// - tags, extra and every context but the trace ids go: the browser SDK puts raw callback
//   arguments in extra, which no redactor can be trusted with (AT-D22 security review, major 3);
// - the redactor runs over every string that remains (spec §9.1).
// No Sentry package is imported: the event is typed structurally, so @trace/shared stays SDK-free.
import { REDACTED, redactSerializedError, redactString } from './redact.js';
import { isErrorName, serializeError, type SerializedError } from './serialize-error.js';
import { isVersion } from './version.js';

export interface SentryFrameLike {
  filename?: string;
  abs_path?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

export interface SentryExceptionLike {
  type?: string;
  value?: string;
  mechanism?: { type?: string; handled?: boolean };
  stacktrace?: { frames?: SentryFrameLike[] };
}

export interface SentryBreadcrumbLike {
  type?: string;
  category?: string;
  level?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
}

/** The part of a Sentry event the scrubber keeps. */
export interface SentryEventLike {
  event_id?: string;
  timestamp?: number;
  level?: string;
  platform?: string;
  release?: string;
  environment?: string;
  sdk?: { name?: string; version?: string };
  request?: { url?: string; method?: string };
  contexts?: Record<string, unknown>;
  exception?: { values?: SentryExceptionLike[] };
  breadcrumbs?: SentryBreadcrumbLike[];
}

/** The part of Sentry's EventHint the scrubber reads. */
export interface SentryHintLike {
  originalException?: unknown;
  /** The adapter passes the serialised error here (sentry-reporter.ts). */
  data?: unknown;
}

const LEVELS: ReadonlySet<string> = new Set(['fatal', 'error', 'warning', 'log', 'info', 'debug']);
/** A plain label: an SDK name, a breadcrumb category, a mechanism type. */
const LABEL = /^[A-Za-z][A-Za-z0-9_.:/@-]{0,63}$/;
const ENVIRONMENT = /^[a-z][a-z0-9_-]{0,31}$/;
const METHOD = /^[A-Z]{1,10}$/;
const EVENT_ID = /^[0-9a-f]{32}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;
const MAX_FRAMES = 50;
const MAX_BREADCRUMBS = 100;
/** Unix seconds between 2001 and 2128: never a mobile, Aadhaar or account number. */
const isTimestamp = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1e9 && v < 5e9;
/** A line or column number, a count, a status: small, so never an ID number. */
const isSmallInt = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
/** An ID made of hex: kept only if it also holds a hex letter, so it is never an all-digit number. */
const isHexId = (v: unknown, shape: RegExp): v is string =>
  typeof v === 'string' && shape.test(v) && /[a-f]/.test(v);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A label that passes its shape and comes out of the redactor unchanged; otherwise undefined. */
const label = (v: unknown, shape: RegExp = LABEL): string | undefined =>
  typeof v === 'string' && shape.test(v) && redactString(v) === v ? v : undefined;

/** Removes the query string and fragment of a URL or path. */
export const stripQuery = (url: string): string => {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
};

/**
 * Whether a URL or path names the media route `/media/...` (d1 §6.2 R3-6): its path holds the link's jti, so no
 * such URL may reach Sentry, even without its query. Case-insensitive and percent-decoded; fails closed (an
 * undecodable string that mentions media counts as a media URL).
 */
export const isMediaUrl = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  let s = v;
  try {
    s = decodeURIComponent(v);
  } catch {
    return /media/i.test(v);
  }
  return /^(?:[a-z][a-z0-9+.-]*:\/\/[^/?#]*)?\/media(?:[/?#]|$)/i.test(s.trim());
};

/** A breadcrumb whose data names a media URL (url, from or to). */
const isMediaBreadcrumb = (breadcrumb: unknown): boolean => {
  const data = isRecord(breadcrumb) ? breadcrumb['data'] : undefined;
  return isRecord(data) && ['url', 'from', 'to'].some((k) => isMediaUrl(data[k]));
};

/** A URL without its query, redacted; undefined for anything that is not a string. */
const safeUrl = (v: unknown): string | undefined =>
  typeof v === 'string' ? redactString(stripQuery(v)) : undefined;

/** Copies the defined values only, so an absent field stays absent. */
const compact = <T extends object>(o: T): { [K in keyof T]?: Exclude<T[K], undefined> } => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as { [K in keyof T]?: Exclude<T[K], undefined> };
};

/**
 * serializeError's code for the error behind the event, redacted: from the original exception
 * when the SDK captured an Error, or from the serialised error the adapter passed in the hint.
 */
const codeOf = (hint: SentryHintLike | undefined): string | undefined => {
  const original = hint?.originalException;
  if (original instanceof Error) return redactSerializedError(serializeError(original)).code;
  const data = hint?.data;
  const serialized = isRecord(data) ? data['serializedError'] : undefined;
  const code = isRecord(serialized) ? serialized['code'] : undefined;
  if (typeof code !== 'string') return undefined;
  return redactSerializedError({ name: 'Error', code } satisfies SerializedError).code;
};

const scrubFrame = (frame: unknown): SentryFrameLike => {
  if (!isRecord(frame)) return {};
  return compact({
    filename: safeUrl(frame['filename']),
    abs_path: safeUrl(frame['abs_path']),
    function: typeof frame['function'] === 'string' ? redactString(frame['function']) : undefined,
    module: typeof frame['module'] === 'string' ? redactString(frame['module']) : undefined,
    lineno: isSmallInt(frame['lineno'], 9_999_999) ? frame['lineno'] : undefined,
    colno: isSmallInt(frame['colno'], 9_999_999) ? frame['colno'] : undefined,
    in_app: typeof frame['in_app'] === 'boolean' ? frame['in_app'] : undefined,
  });
};

const scrubException = (exception: unknown, value: string): SentryExceptionLike => {
  const e = isRecord(exception) ? exception : {};
  const mechanism = isRecord(e['mechanism']) ? e['mechanism'] : undefined;
  const stacktrace = isRecord(e['stacktrace']) ? e['stacktrace'] : undefined;
  const frames = Array.isArray(stacktrace?.['frames']) ? stacktrace['frames'] : undefined;
  const type = e['type'];
  return compact({
    type: isErrorName(type) && redactString(type) === type ? type : 'Error',
    value,
    mechanism:
      mechanism &&
      compact({
        type: label(mechanism['type']),
        handled: typeof mechanism['handled'] === 'boolean' ? mechanism['handled'] : undefined,
      }),
    stacktrace: frames && { frames: frames.slice(-MAX_FRAMES).map(scrubFrame) },
  });
};

const scrubBreadcrumbData = (data: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(data)) return undefined;
  return compact({
    url: safeUrl(data['url']),
    from: safeUrl(data['from']),
    to: safeUrl(data['to']),
    method: label(data['method'], METHOD),
    status_code: isSmallInt(data['status_code'], 999) ? data['status_code'] : undefined,
  });
};

const scrubBreadcrumbInner = (breadcrumb: unknown): SentryBreadcrumbLike => {
  if (!isRecord(breadcrumb)) return {};
  const level = breadcrumb['level'];
  return compact({
    type: label(breadcrumb['type']),
    category: label(breadcrumb['category']),
    level: typeof level === 'string' && LEVELS.has(level) ? level : undefined,
    timestamp: isTimestamp(breadcrumb['timestamp']) ? breadcrumb['timestamp'] : undefined,
    data: scrubBreadcrumbData(breadcrumb['data']),
  });
};

/**
 * `beforeBreadcrumb`: keeps the type, category, level and timestamp, and from the data only the
 * URLs (without query strings, redacted), the method and the status code. The message goes (console
 * breadcrumbs carry whole log lines, click breadcrumbs carry page text). Returns null, which drops
 * the breadcrumb, if it cannot be read or names a media URL (d1 R3-6). Never throws.
 */
export const scrubSentryBreadcrumb = <B extends object>(breadcrumb: B): B | null => {
  try {
    if (isMediaBreadcrumb(breadcrumb)) return null;
    return scrubBreadcrumbInner(breadcrumb) as B;
  } catch {
    return null;
  }
};

/**
 * Only the trace and span ids of the trace context. Every other context goes: SDK contexts carry the
 * user agent, locale and timezone, and a redactor cannot be trusted with free text (AT-D22 review).
 */
const scrubContexts = (contexts: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(contexts)) return undefined;
  const trace = contexts['trace'];
  const out: Record<string, unknown> = {};
  if (isRecord(trace)) {
    const ids = compact({
      trace_id: isHexId(trace['trace_id'], TRACE_ID) ? trace['trace_id'] : undefined,
      span_id: isHexId(trace['span_id'], SPAN_ID) ? trace['span_id'] : undefined,
    });
    if (Object.keys(ids).length > 0) out['trace'] = ids;
  }
  return out;
};

const scrubEventInner = (event: object, hint: SentryHintLike | undefined): SentryEventLike => {
  const e = event as Record<string, unknown>;
  const value = codeOf(hint) ?? REDACTED;
  const release = e['release'];
  const sdk = isRecord(e['sdk']) ? e['sdk'] : undefined;
  const request = isRecord(e['request']) ? e['request'] : undefined;
  const exception = isRecord(e['exception']) ? e['exception'] : undefined;
  const exceptionValues = Array.isArray(exception?.['values']) ? exception['values'] : undefined;
  const breadcrumbs = Array.isArray(e['breadcrumbs']) ? e['breadcrumbs'] : undefined;
  const level = e['level'];
  return compact({
    event_id: isHexId(e['event_id'], EVENT_ID) ? e['event_id'] : undefined,
    timestamp: isTimestamp(e['timestamp']) ? e['timestamp'] : undefined,
    level: typeof level === 'string' && LEVELS.has(level) ? level : undefined,
    platform: label(e['platform']),
    // The commit SHA (spec §9.2); a SHA must hold a hex letter, as in error-reporter.ts.
    release:
      isVersion(release) && (release === 'dev' || /[a-f]/.test(release)) ? release : undefined,
    environment: label(e['environment'], ENVIRONMENT),
    sdk:
      sdk &&
      compact({
        name: label(sdk['name']),
        version: label(sdk['version'], /^[0-9][0-9A-Za-z.+-]{0,31}$/),
      }),
    request:
      request &&
      compact({
        url: isMediaUrl(request['url']) ? undefined : safeUrl(request['url']),
        method: label(request['method'], METHOD),
      }),
    contexts: scrubContexts(e['contexts']),
    exception: exceptionValues && {
      values: exceptionValues.map((x) => scrubException(x, value)),
    },
    breadcrumbs: breadcrumbs
      ?.filter((b) => !isMediaBreadcrumb(b))
      .slice(-MAX_BREADCRUMBS)
      .map(scrubBreadcrumbInner),
  });
};

/**
 * `beforeSend`: a new event built from the allow-list above (the input is not changed). Returns
 * null, which drops the event, if it cannot be read. Never throws.
 */
export const scrubSentryEvent = <E extends object>(event: E, hint?: SentryHintLike): E | null => {
  try {
    if (!isRecord(event)) return null;
    return scrubEventInner(event, hint) as E;
  } catch {
    return null;
  }
};
