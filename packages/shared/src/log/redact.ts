// PII redactor for logs and error reports (spec specs/m0-foundations.md §9.1).
// No dependencies: it runs in the browser, Workers and Node.
import { serializeError, type SerializedError } from './serialize-error.js';

export const REDACTED = '[REDACTED]';
export const TRUNCATED = '[TRUNCATED]';
export const CIRCULAR = '[CIRCULAR]';
export const UNSUPPORTED = '[UNSUPPORTED]';
export const MAX_STRING = 2000;
export const MAX_DEPTH = 6;
/** Arrays and objects keep at most this many entries; the rest becomes one TRUNCATED marker. */
export const MAX_ENTRIES = 100;

const KEY_STEMS = [
  // contact and identity
  'name', 'email', 'phone', 'mobile', 'whatsapp', 'address', 'pincode', 'dob', 'birth', 'age', 'gender',
  // government IDs and protected traits
  'aadhaar', 'aadhar', 'pan', 'passport', 'voter', 'epic', 'caste', 'religion', 'disability',
  // background and network
  'college', 'ip', 'forwardedfor', 'connectingip', 'realip',
  // credentials and secrets
  'otp', 'code', 'password', 'passcode', 'pin', 'token', 'secret', 'key', 'authorization', 'cookie',
  'session', 'nonce', 'invite', 'signedurl', 'jwt',
  // answer content and media
  'answer', 'finaltext', 'transcript', 'scratchpad', 'jdtext', 'photo', 'image', 'audio', 'video',
  'accommodation',
]; // prettier-ignore

/** Exact keys (normalised) that contain a stem but only ever hold IDs or versions. */
const SAFE_KEYS = new Set([
  'orgid',
  'requestid',
  'sessionid',
  'keyversion',
  'attemptid',
  'invitationid',
  'workspaceid',
  'statuscode',
  'errorcode',
  'stage',
  'page',
  'pagesize',
]);

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[\s_-]/g, '');

export const isSensitiveKey = (key: string): boolean => {
  const k = normaliseKey(key);
  return !SAFE_KEYS.has(k) && KEY_STEMS.some((stem) => k.includes(stem));
};

type Replacer = (match: string, ...groups: string[]) => string;
const PATTERNS: [RegExp, string | Replacer][] = [
  // secrets and tokens first, so later patterns never see their pieces
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, REDACTED],
  [/\bBearer\s+[^\s"',;]+/gi, REDACTED],
  [/\bsb_secret_[\w-]*/g, REDACTED],
  [/\bpostgres(?:ql)?:\/\/[^\s"']+/gi, REDACTED],
  // email, then UPI (handle@psp without a dot after the psp)
  [/[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi, REDACTED],
  [/[\w.-]{2,}@[a-z]{2,}(?![\w.@-])/gi, REDACTED],
  // bank account numbers next to account keywords
  [
    /(\b(?:a\/c|acct|account|bank)[\w.]*[\s:#.-]*(?:no\.?|number)?[\s:#.-]*)\d{9,18}(?!\d)/gi,
    (_m, prefix) => `${prefix}${REDACTED}`,
  ],
  // Aadhaar VID (16 digits), Aadhaar (12, starting 2-9), Indian mobile numbers
  [/(?<![\w])\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, REDACTED],
  [/(?<![\w])[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, REDACTED],
  [/(?<![\w+])(?:(?:\+|00)?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}(?!\d)/g, REDACTED],
  // PAN, voter EPIC, IFSC, passport
  [/(?<![a-z0-9])[a-z]{5}\d{4}[a-z](?![a-z0-9])/gi, REDACTED],
  [/(?<![a-z0-9])[a-z]{3}\d{7}(?![a-z0-9])/gi, REDACTED],
  [/(?<![a-z0-9])[a-z]{4}0[a-z0-9]{6}(?![a-z0-9])/gi, REDACTED],
  [/(?<![a-z0-9])[a-z]\d{7}(?![a-z0-9])/gi, REDACTED],
  // IPv4, then IPv6 (needs "::" or at least three colons, so clock times are left alone)
  [
    /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g,
    REDACTED,
  ],
  [
    /(?<![0-9a-z:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![0-9a-z:])/gi,
    (m) => (m.includes('::') || (m.match(/:/g)?.length ?? 0) >= 3 ? REDACTED : m),
  ],
  // long hex, and long base64 that mixes upper case, lower case and digits (random tokens)
  [/(?<![a-z0-9])[0-9a-f]{32,}(?![a-z0-9])/gi, REDACTED],
  [
    /(?<![\w+/=-])[\w+/-]{32,}={0,2}/g,
    (m) => (/[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m) ? REDACTED : m),
  ],
];

/** Redacts PII and secret patterns inside one string. Strings over the cap become TRUNCATED. */
export const redactString = (input: string): string => {
  if (input.length > MAX_STRING) return TRUNCATED;
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep as string);
  return out.length > MAX_STRING ? TRUNCATED : out;
};

const PII_NUMBER = /^(?:[6-9]\d{9}|[2-9]\d{11}|\d{16})$/;

const redactInner = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
  switch (typeof value) {
    case 'string':
      return redactString(value);
    case 'number':
      return Number.isInteger(value) && PII_NUMBER.test(String(Math.abs(value)))
        ? REDACTED
        : Number.isFinite(value)
          ? value
          : String(value);
    case 'bigint':
      return redactString(value.toString());
    case 'boolean':
    case 'undefined':
      return value;
    case 'function':
    case 'symbol':
      return UNSUPPORTED;
  }
  if (value === null) return null;
  const obj = value as object;
  if (depth >= MAX_DEPTH) return TRUNCATED;
  if (seen.has(obj)) return CIRCULAR;
  if (obj instanceof Error) return redactSerializedError(serializeError(obj));
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString();
  seen.add(obj);
  try {
    if (Array.isArray(obj)) {
      const out = obj.slice(0, MAX_ENTRIES).map((v) => redactInner(v, depth + 1, seen));
      if (obj.length > MAX_ENTRIES) out.push(TRUNCATED);
      return out;
    }
    if (obj instanceof Map || obj instanceof Set || ArrayBuffer.isView(obj)) return UNSUPPORTED;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    for (const key of keys.slice(0, MAX_ENTRIES)) {
      const safeKey = redactString(key);
      out[safeKey] = isSensitiveKey(key)
        ? REDACTED
        : redactInner((obj as Record<string, unknown>)[key], depth + 1, seen);
    }
    if (keys.length > MAX_ENTRIES) out[TRUNCATED] = TRUNCATED;
    return out;
  } catch {
    return UNSUPPORTED;
  } finally {
    seen.delete(obj);
  }
};

/**
 * Value-only redaction for serializeError output: its keys (name, code, stack) are fixed and safe,
 * but every value still passes the string patterns (a code or name can carry a PII-shaped value).
 */
export const redactSerializedError = (err: SerializedError): SerializedError => {
  const out: SerializedError = { name: redactString(err.name) };
  if (err.code !== undefined) out.code = redactString(err.code);
  if (err.stack !== undefined) out.stack = err.stack.map(redactString);
  return out;
};

/** Returns a JSON-safe, redacted copy. Never throws and never returns input beyond the caps. */
export const redact = (value: unknown): unknown => {
  try {
    return redactInner(value, 0, new WeakSet());
  } catch {
    return UNSUPPORTED;
  }
};
