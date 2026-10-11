// PII redactor for logs and error reports (spec specs/m0-foundations.md §9.1).
// No dependencies: it runs in the browser, Workers and Node.
//
// Every value pattern runs in linear time (security review S1.7, ReDoS):
// - a pattern whose first quantifier could start anywhere inside a run of its own characters is
//   anchored with a negative lookbehind of that class, so it starts at most once per run;
// - neighbouring quantifiers never share characters, or are bounded;
// - the quoted-value scanner reads each body at most once, and at most MAX_STRING characters.
// redact.test.ts times applyPatterns on ~100 KB adversarial inputs to keep it that way.
import { serializeError, type SerializedError } from './serialize-error.js';

export const REDACTED = '[REDACTED]';
export const TRUNCATED = '[TRUNCATED]';
export const CIRCULAR = '[CIRCULAR]';
export const UNSUPPORTED = '[UNSUPPORTED]';
export const MAX_STRING = 2000;
export const MAX_DEPTH = 6;
/** Arrays and objects keep at most this many entries; the rest becomes one TRUNCATED marker. */
export const MAX_ENTRIES = 100;
/** Values visited per redact() call; shared references would otherwise multiply the work. */
export const MAX_NODES = 5000;

const KEY_STEMS = [
  // contact and identity
  'name', 'email', 'phone', 'mobile', 'whatsapp', 'address', 'pincode', 'dob', 'birth', 'age', 'gender',
  // government IDs and protected traits
  'aadhaar', 'aadhar', 'pan', 'passport', 'voter', 'epic', 'caste', 'religion', 'disability',
  // background and network
  'college', 'ip', 'forwardedfor', 'connectingip', 'realip', 'referer', 'referrer', 'asorganization',
  // location (implied by address, pincode and ip)
  'city', 'location', 'latitude', 'longitude', 'geo', 'postal', 'zip',
  // credentials and secrets
  'otp', 'code', 'password', 'passwd', 'pwd', 'passcode', 'pin', 'token', 'secret', 'key',
  'authorization', 'cookie', 'session', 'nonce', 'invite', 'signedurl', 'jwt', 'signature',
  'credential',
  // answer content and media
  'answer', 'finaltext', 'transcript', 'scratchpad', 'jdtext', 'photo', 'image', 'audio', 'video',
  'accommodation',
  // free text that can echo answers or PII (implied by answer, finaltext and transcript)
  'text', 'content', 'body', 'message', 'msg', 'detail', 'hint', 'note', 'comment', 'feedback',
  'essay', 'prompt', 'completion', 'response', 'resume', 'reason', 'description', 'query', 'search',
]; // prettier-ignore

/** Exact keys (normalised) that contain a stem but only ever hold IDs, versions or counts. */
const SAFE_KEYS = new Set([
  'orgid', 'requestid', 'sessionid', 'keyversion', 'attemptid', 'invitationid', 'workspaceid',
  'statuscode', 'errorcode', 'stage', 'page', 'pagesize', 'contenttype', 'contentlength',
  'responsestatus', 'responsetimems',
]); // prettier-ignore

/**
 * Invisible characters that could split a key or a value: zero-width marks and joiners, bidi
 * controls, variation selectors, Hangul fillers, tags. Every one of them is in this property.
 */
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;

/**
 * Keys are compared after NFKC (fullwidth and other compatibility forms), dropping invisible
 * characters (some are letters), lower-casing, and removing every character that is not a letter
 * or digit (spaces, `_`, `-`, marks).
 */
const normaliseKey = (key: string): string =>
  key
    .normalize('NFKC')
    .replace(IGNORABLE, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/** One alternation of the stems (plain lower-case letters): a single scan instead of one per stem. */
const STEM = new RegExp(KEY_STEMS.join('|'));

export const isSensitiveKey = (key: string): boolean => {
  const k = normaliseKey(key);
  return !SAFE_KEYS.has(k) && STEM.test(k);
};

/** A decimal digit of any script other than ASCII (Devanagari, Arabic-Indic, Ol Chiki, \u2026). */
const NON_ASCII_DIGIT = /(?![0-9])\p{Nd}/gu;
const IS_DIGIT = /^\p{Nd}$/u;
/** Every dash, and the minus sign, other than '-' itself. */
const DASH = /(?!-)[\p{Pd}\u2212]/gu;

/**
 * Unicode encodes each script's digits 0-9 at consecutive code points, and digit sets that touch
 * (the mathematical ones, up to 50 in a row) each start at a 0. So a digit's value is its distance
 * from the start of its run, mod 10.
 */
const toAsciiDigit = (ch: string): string => {
  const cp = ch.codePointAt(0) ?? 0;
  let start = cp;
  while (cp - start < 50 && IS_DIGIT.test(String.fromCodePoint(start - 1))) start--;
  return String((cp - start) % 10);
};

/**
 * The text the patterns see: compatibility forms folded, invisible characters dropped, every
 * digit ASCII and every dash '-'. NFKC runs again after the drop, because a dropped character can
 * let marks compose; that also keeps canonical idempotent. Internal (not exported from index.ts).
 */
export const canonical = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(IGNORABLE, '')
    .normalize('NFKC')
    .replace(NON_ASCII_DIGIT, toAsciiDigit)
    .replace(DASH, '-');

type Replacer = (match: string, ...groups: string[]) => string;
const keepPrefix: Replacer = (_m, prefix = '') => `${prefix}${REDACTED}`;

/** Builds a digit pattern; SEP is one gap between digit groups: up to two spaces, dots or dashes. */
const digits = (source: string): RegExp =>
  new RegExp(source.replaceAll('SEP', '[\\s.-]{0,2}'), 'g');

/** A key, `=` or `:` (the key may be quoted or escaped-quoted), then an opening quote. */
const KEY_THEN_QUOTE = /(?<![\w-])([\w-]{1,64})(\\?["']?\s{0,3}[=:]\s{0,3})(\\"|["'])/g;

/**
 * Where a quoted value's body ends: the index of its closing quote, or the end of the text, or
 * MAX_STRING characters on (the bound keeps it linear). A backslash escapes the next character;
 * inside an escaped quote (`\"`, JSON inside a JSON string) `\\` and an escape form one unit.
 */
const quotedEnd = (text: string, from: number, open: string): number => {
  const limit = Math.min(text.length, from + MAX_STRING);
  let i = from;
  if (open === '\\"') {
    while (i < limit && !(text[i] === '\\' && text[i + 1] === '"')) {
      i += text[i] !== '\\' ? 1 : text[i + 1] !== '\\' ? 2 : text[i + 2] === '\\' ? 4 : 3;
    }
  } else {
    while (i < limit && text[i] !== open) i += text[i] === '\\' ? 2 : 1;
  }
  return Math.min(i, limit);
};

/**
 * `key="…"`, `key='…'` and escaped `key=\"…\"` in free text, when the key would be redacted as an
 * object key: the whole quoted value goes, spaces and all. Only a sensitive key's body is scanned,
 * and the scan resumes after it, so bodies are scanned at most once (linear time).
 */
const redactQuotedValues = (text: string): string => {
  let out = '';
  let last = 0;
  KEY_THEN_QUOTE.lastIndex = 0;
  for (let m = KEY_THEN_QUOTE.exec(text); m !== null; m = KEY_THEN_QUOTE.exec(text)) {
    const [head, key = '', , open = ''] = m;
    if (!isSensitiveKey(key)) continue; // a non-sensitive value is still scanned for inner pairs
    const from = m.index + head.length;
    const end = quotedEnd(text, from, open);
    if (end === from) continue;
    const close = text.startsWith(open, end) ? open : '';
    out += text.slice(last, from) + REDACTED + close;
    last = end + close.length;
    KEY_THEN_QUOTE.lastIndex = last;
  }
  return out + text.slice(last);
};

type Step = (text: string) => string;
const sub =
  (re: RegExp, rep: string | Replacer): Step =>
  (text) =>
    text.replace(re, rep as string);

const STEPS: readonly Step[] = [
  // secrets and tokens first, so later patterns never see their pieces
  sub(/(?<![\w-])eyJ[\w-]*\.[\w-]*\.[\w-]*/g, REDACTED),
  sub(/\b(?:Bearer|Basic|Token)\s{1,8}[^\s"',;]+/gi, REDACTED),
  sub(/\bsb_secret_[\w-]*/g, REDACTED),
  sub(/\bpostgres(?:ql)?:\/\/[^\s"']+/gi, REDACTED),
  // quoted values under sensitive keys, before anything else can take a piece of them
  redactQuotedValues,
  // query strings and fragments that carry parameters: keep the '?' or '#', drop the rest
  sub(/([?#])[^\s?#"'<>]*=[^\s"'<>]*/g, keepPrefix),
  // `key=value` and `key: value` in free text, when the key would be redacted as an object key
  sub(/(?<![\w-])([\w-]{1,64})("?\s{0,3}[=:]\s{0,3}"?)([^\s"'&,;)]+)/g, (m, key = '', sep = '') =>
    isSensitiveKey(key) ? `${key}${sep}${REDACTED}` : m,
  ),
  // email (also percent-encoded), then UPI (handle@psp without a dot after the psp)
  sub(/(?<![\w.%+-])[\w.%+-]+(?:@|%40)(?:[a-z0-9-]+\.)+[a-z]{2,}/gi, REDACTED),
  sub(/(?<![\w.-])[\w.-]{2,}(?:@|%40)[a-z]{2,32}(?![\w.@-])/gi, REDACTED),
  // bank account numbers next to account keywords (a short, bounded non-digit gap)
  sub(/(\b(?:a\/c|acct|account|bank)\D{0,24}?)\d{9,18}(?!\d)/gi, keepPrefix),
  // IPv4 (before the digit patterns, which could otherwise take part of an address)
  sub(
    /(?<!\d)(?<!\d\.)(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\d)(?!\.\d)/g,
    REDACTED,
  ),
  // Aadhaar VID (16 digits), Aadhaar (12, starting 2-9), Indian mobile numbers
  sub(digits('(?<!\\d)\\d{4}SEP\\d{4}SEP\\d{4}SEP\\d{4}(?!\\d)'), REDACTED),
  sub(digits('(?<!\\d)[2-9]\\d{3}SEP\\d{4}SEP\\d{4}(?!\\d)'), REDACTED),
  sub(digits('(?<!\\d)(?:(?:\\+|00)?91SEP|0)?[6-9](?:SEP\\d){9}(?!\\d)'), REDACTED),
  // PAN, voter EPIC, IFSC, passport
  sub(/(?<![a-z0-9])[a-z]{5}\d{4}[a-z](?![a-z0-9])/gi, REDACTED),
  sub(/(?<![a-z0-9])[a-z]{3}\d{7}(?![a-z0-9])/gi, REDACTED),
  sub(/(?<![a-z0-9])[a-z]{4}0[a-z0-9]{6}(?![a-z0-9])/gi, REDACTED),
  sub(/(?<![a-z0-9])[a-z]\d{7}(?![a-z0-9])/gi, REDACTED),
  // IPv6 (needs "::" or at least three colons, so clock times are left alone)
  sub(/(?<![0-9a-z:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![0-9a-z:])/gi, (m) =>
    m.includes('::') || (m.match(/:/g)?.length ?? 0) >= 3 ? REDACTED : m,
  ),
  // long hex, and long base64 that mixes upper case, lower case and digits (random tokens)
  sub(/(?<![a-z0-9])[0-9a-f]{32,}(?![a-z0-9])/gi, REDACTED),
  sub(/(?<![\w+/-])[\w+/-]{32,}={0,2}/g, (m) =>
    /[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m) ? REDACTED : m,
  ),
];

/**
 * Runs every value pattern over canonical text. No length cap, so it is internal (not exported
 * from index.ts) and only redactString calls it, after the cap.
 */
export const applyPatterns = (text: string): string => STEPS.reduce((out, step) => step(out), text);

/**
 * Redacts PII and secret patterns inside one string. Strings over the cap become TRUNCATED.
 * Text with no match comes back unchanged; otherwise the canonical text with its redactions does.
 */
export const redactString = (input: string): string => {
  if (input.length > MAX_STRING) return TRUNCATED;
  const text = canonical(input);
  const out = applyPatterns(text);
  if (out === text) return input;
  return out.length > MAX_STRING ? TRUNCATED : out;
};

const PII_NUMBER = /^(?:[6-9]\d{9}|[2-9]\d{11}|\d{16})$/;

interface State {
  seen: WeakSet<object>;
  budget: number;
}

const redactInner = (value: unknown, depth: number, state: State): unknown => {
  if (--state.budget < 0) return TRUNCATED;
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
  if (state.seen.has(obj)) return CIRCULAR;
  state.seen.add(obj);
  try {
    if (obj instanceof Error) return redactSerializedError(serializeError(obj));
    if (obj instanceof Date) {
      // Built-ins only: an own getTime or toISOString on the object is never called.
      const t = Date.prototype.getTime.call(obj);
      return Number.isNaN(t) ? 'Invalid Date' : Date.prototype.toISOString.call(obj);
    }
    if (Array.isArray(obj)) {
      const out = obj.slice(0, MAX_ENTRIES).map((v) => redactInner(v, depth + 1, state));
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
        : redactInner((obj as Record<string, unknown>)[key], depth + 1, state);
    }
    if (keys.length > MAX_ENTRIES) out[TRUNCATED] = TRUNCATED;
    return out;
  } catch {
    return UNSUPPORTED;
  } finally {
    state.seen.delete(obj);
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
    return redactInner(value, 0, { seen: new WeakSet(), budget: MAX_NODES });
  } catch {
    return UNSUPPORTED;
  }
};
