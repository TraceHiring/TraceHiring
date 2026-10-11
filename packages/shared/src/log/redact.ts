// PII redactor for logs and error reports (spec specs/m0-foundations.md §9.1).
// No dependencies: it runs in the browser, Workers and Node.
//
// Every value pattern runs in linear time (security review S1.7, ReDoS):
// - a pattern whose first quantifier could start anywhere inside a run of its own characters is
//   anchored with a negative lookbehind of that class, so it starts at most once per run;
// - neighbouring quantifiers never share characters, or are bounded;
// - the quoted-value scanner reads each body at most once, and at most MAX_STRING characters.
// redact.test.ts times applyPatterns on ~100 KB adversarial inputs to keep it that way.
import {
  isErrorName,
  isStackFrame,
  serializeError,
  stackFrames,
  type SerializedError,
} from './serialize-error.js';

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
/** Keys of ASCII letters, digits, `_` and `-` (most keys) need no Unicode normalisation. */
const ASCII_KEY = /^[\w-]*$/;

/**
 * Keys are compared after NFKC (fullwidth and other compatibility forms), dropping invisible
 * characters (some are letters), lower-casing, and removing every character that is not a letter
 * or digit (spaces, `_`, `-`, marks).
 */
const normaliseKey = (key: string): string =>
  ASCII_KEY.test(key)
    ? key.toLowerCase().replace(/[_-]/g, '') // the same result, without the Unicode passes
    : key
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

/** A decimal digit of any script other than ASCII (Devanagari, Arabic-Indic, Ol Chiki and more). */
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
 * Stands in for a run of invisible characters between two ASCII letters, or an ASCII letter and a
 * digit (redactor review #3). There the run may sit inside one value (a soft hyphen in a copied
 * PAN or email) or between a value and the next word (`<PAN>\u3164ok`), so applyPatterns reads
 * the text both ways. It is itself an invisible character, so canonical text never has one
 * otherwise, and it is not a word, space or digit character to any pattern.
 */
const SPLIT = '\u2063';
/**
 * A run of invisible characters; the first two alternatives capture a run between an ASCII letter
 * and an ASCII letter or digit, or between a digit and an ASCII letter. Each run is read once:
 * inside a run the lookbehinds fail, and no invisible character is a letter or digit to them.
 */
const IGNORABLE_RUN =
  /(?<=[A-Za-z])(\p{Default_Ignorable_Code_Point}+)(?=[A-Za-z\p{Nd}])|(?<=\p{Nd})(\p{Default_Ignorable_Code_Point}+)(?=[A-Za-z])|\p{Default_Ignorable_Code_Point}+/gu;
const splitOrDrop = (_run: string, letters?: string, digitThenLetter?: string): string =>
  letters === undefined && digitThenLetter === undefined ? '' : SPLIT;

/**
 * The text the patterns see: compatibility forms folded, invisible characters dropped (or marked
 * with SPLIT where they may separate two values), every digit ASCII and every dash '-'. NFKC runs
 * again after the drop, because a dropped character can let marks compose; that also keeps
 * canonical idempotent. Internal (not exported from index.ts).
 */
export const canonical = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(IGNORABLE_RUN, splitOrDrop)
    .normalize('NFKC')
    .replace(NON_ASCII_DIGIT, toAsciiDigit)
    .replace(DASH, '-');

type Replacer = (match: string, ...groups: string[]) => string;
const keepPrefix: Replacer = (_m, prefix = '') => `${prefix}${REDACTED}`;

/** Builds a digit pattern; SEP is one gap between digit groups: up to two spaces, dots or dashes. */
const digits = (source: string): RegExp =>
  new RegExp(source.replaceAll('SEP', '[\\s.-]{0,2}'), 'g');

/**
 * A key in free text (redactor review #8), as two capture groups:
 * 1. a run of word characters and dashes, of any length, with optional `[name]` segments
 *    (`user[password]`, `a[0]["otp"]`); the lookbehind starts it once per run;
 * 2. the text of a quoted key, which may hold spaces (`"Address Line 1"`), up to its closing
 *    quote (which may be escaped); the text holds no quote or backslash, so it is read once.
 */
const KEY = String.raw`(?:(?<![\w-])([\w-]+(?:\[["']?[\w-]*["']?\])*)|"([^"\\\r\n]+)(?=\\*"))`;
/** Keys longer than this are treated as sensitive whatever they say (the safe choice). */
const MAX_KEY = 64;
const isSensitiveTextKey = (key: string): boolean => key.length > MAX_KEY || isSensitiveKey(key);

/**
 * A key, `=` or `:` (the key may be quoted or escaped-quoted), then an opening quote. JSON inside
 * a JSON string escapes each quote with 1, 3, 7, … backslashes (one level deeper each time), so
 * both quotes take any number of them (redactor review #4).
 */
const KEY_THEN_QUOTE = new RegExp(String.raw`${KEY}(\\*["']?\s{0,3}[=:]\s{0,3})(\\*["'])`, 'g');

/**
 * Where a quoted value's body ends: the index of its closing quote, or else the end of the text.
 * Only MAX_STRING characters are read (the bound keeps it linear); with no closing quote among
 * them, the value runs to the end of the text. The bound can be hit inside a value, because NFKC
 * can make text longer than the input cap (U+FDFA becomes 18 characters), and the rest of the
 * value must not be kept (redactor lows review F2). The opener is a quote after k backslashes
 * (k = 0 for a plain quote, 2^n - 1 for JSON n levels inside JSON strings). A quote after a run
 * of r backslashes closes the value when r = k plus an even number of escapes at the value's own
 * level, each of which is 2k + 2 backslashes: (r - k) % (2k + 2) === 0. Any other quote is
 * escaped inside the value, or belongs to an outer string (malformed text), and the scan goes on,
 * which redacts more, never less.
 */
const quotedEnd = (text: string, from: number, open: string): number => {
  const limit = Math.min(text.length, from + MAX_STRING);
  const quote = open.at(-1);
  const k = open.length - 1;
  let i = from;
  while (i < limit) {
    if (text[i] === '\\') {
      let j = i;
      while (j < limit && text[j] === '\\') j++;
      const r = j - i;
      if (j < limit && text[j] === quote && r >= k && (r - k) % (2 * k + 2) === 0) return j - k;
      i = j + 1; // the run, and the character it escapes
    } else if (k === 0 && text[i] === quote) {
      return i;
    } else {
      i++;
    }
  }
  return text.length;
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
    const [head, bare, quoted, , open = ''] = m;
    // a non-sensitive value is still scanned for inner pairs
    if (!isSensitiveTextKey(bare ?? quoted ?? '')) continue;
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

/**
 * A key, `=` or `:` (the key's closing quote may be escaped: `\"otp\":123456` in nested JSON, review
 * #4), and an optional opening quote, before a value character. The value is not part of the
 * match: a non-sensitive key's value is read again for pairs of its own (redactor lows review F1).
 */
const KEY_THEN_VALUE = new RegExp(
  String.raw`${KEY}(\\*["']?\s{0,3}[=:]\s{0,3}"?)(?=[^\s"'&,;)])`,
  'g',
);
/** A free-text value: up to the next space, quote, `&`, `,`, `;` or `)`. */
const VALUE = /[^\s"'&,;)]+/y;

/**
 * `key=value` and `key: value` in free text, when the key would be redacted as an object key. The
 * scan resumes at the start of a non-sensitive key's value, so a pair inside it (`data:password=…`,
 * `{"event":"otp=…"}`) is still found; a sensitive key's value goes whole and the scan resumes after
 * it. Each match reads only a key and a separator, and each value is read once (linear time). A
 * value of only backslashes is the opener of a quoted value (handled by redactQuotedValues), and
 * backslashes that end a value are the escape of the quote after it, so both are kept.
 */
const redactKeyValues = (text: string): string => {
  let out = '';
  let last = 0;
  KEY_THEN_VALUE.lastIndex = 0;
  for (let m = KEY_THEN_VALUE.exec(text); m !== null; m = KEY_THEN_VALUE.exec(text)) {
    const [head, bare, quoted] = m;
    if (!isSensitiveTextKey(bare ?? quoted ?? '')) continue; // lastIndex is at the value
    const from = m.index + head.length;
    VALUE.lastIndex = from;
    const value = VALUE.exec(text)?.[0] ?? '';
    let end = value.length;
    while (end > 0 && value[end - 1] === '\\') end--;
    if (end > 0) {
      out += text.slice(last, from) + REDACTED;
      last = from + end;
    }
    KEY_THEN_VALUE.lastIndex = from + value.length;
  }
  return out + text.slice(last);
};

/**
 * An IPv6 address: hex groups of at most four digits and two to eight colons, with "::" or at
 * least three colons (so clock times are left alone). Never longer than MAX_IPV6 characters.
 */
const IPV6_SHAPE = /^(?:[0-9a-f]{0,4}:){2,8}[0-9a-f]{0,4}$/i;
const MAX_IPV6 = 44;
const isIpv6 = (s: string): boolean =>
  IPV6_SHAPE.test(s) && (s.includes('::') || (s.match(/:/g)?.length ?? 0) >= 3);

/**
 * Where the longest address that ends `part` starts (at 0 or right after a ':'), or -1. Only the
 * last MAX_IPV6 characters can hold it, so each part costs a bounded amount of work.
 */
const ipv6Start = (part: string): number => {
  for (let i = Math.max(0, part.length - MAX_IPV6); i < part.length - 1; i++) {
    if ((i === 0 || part[i - 1] === ':') && isIpv6(part.slice(i))) return i;
  }
  return -1;
};

/**
 * IPv6 in a token of word characters, dashes and colons with at least two colons (redactor review
 * #6): each piece between dashes and underscores loses its longest address suffix, and keeps the
 * prefix before it (`from:`, `via:from:`, `_src:`, `1st:`, a prefix of any length). A prefix of
 * hex groups (`a:b:`) reads as part of the address and goes with it. The lookbehind starts the
 * token once per run of its characters, and its two first runs exclude ':', so it is linear.
 */
const redactIpv6 = (text: string): string =>
  text.replace(/(?<![\w:-])[\w-]*:[\w-]*:[\w:-]*/g, (token) =>
    token.replace(/[^_-]+/g, (part) => {
      const at = ipv6Start(part);
      return at < 0 ? part : `${part.slice(0, at)}${REDACTED}`;
    }),
  );

type Step = (text: string) => string;
const sub =
  (re: RegExp, rep: string | Replacer): Step =>
  (text) =>
    text.replace(re, rep as string);

const STEPS: readonly Step[] = [
  // secrets and tokens first, so later patterns never see their pieces
  sub(/(?<![\w-])eyJ[\w-]*\.[\w-]*\.[\w-]*/g, REDACTED),
  sub(/\b(?:Bearer|Basic|Token)\s{1,8}[^\s"',;]+/gi, REDACTED),
  // free-text headers: any Authorization scheme, and every Cookie pair, not only the first
  sub(/\b((?:proxy-)?authorization\s{0,3}[=:]\s{0,3})[^\r\n"',;]+/gi, keepPrefix),
  sub(/\b((?:set-)?cookie\s{0,3}[=:]\s{0,3})[^\r\n"']+/gi, keepPrefix),
  sub(/\bsb_secret_[\w-]*/g, REDACTED),
  sub(/\bpostgres(?:ql)?:\/\/[^\s"']+/gi, REDACTED),
  // userinfo in any other URL (`scheme://user:password@host`): keep the scheme and the host. A
  // password may hold '/', '?', '#' and '@' (redactor review #8), so the userinfo runs to the last
  // '@' within 256 characters. It stops at the next '://', so no stretch is read twice (linear).
  sub(
    /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,31}:\/\/)(?:(?!:\/\/)[^\s"'<>]){0,256}@/gi,
    (_m, scheme = '') => `${scheme}${REDACTED}@`,
  ),
  // quoted values under sensitive keys, before anything else can take a piece of them
  redactQuotedValues,
  // query strings and fragments that carry parameters: keep the '?' or '#', drop the rest
  sub(/([?#])[^\s?#"'<>]*=[^\s"'<>]*/g, keepPrefix),
  // `key=value` and `key: value` in free text, including pairs inside a non-sensitive value
  redactKeyValues,
  // email (also percent-encoded), then UPI (handle@psp without a dot after the psp)
  sub(/(?<![\w.%+-])[\w.%+-]+(?:@|%40)(?:[a-z0-9-]+\.)+[a-z]{2,}/gi, REDACTED),
  // A trailing '.' (end of sentence) or dash ends the psp; only '.' followed by a letter or digit continues it.
  sub(/(?<![\w.-])[\w.-]{2,}(?:@|%40)[a-z]{2,32}(?![\w@]|\.[a-z0-9])/gi, REDACTED),
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
  // IPv6, alone or after a `word:` prefix (`from:fe80::1`); clock times are left alone
  redactIpv6,
  // long hex, and long base64 that mixes upper case, lower case and digits (random tokens)
  sub(/(?<![a-z0-9])[0-9a-f]{32,}(?![a-z0-9])/gi, REDACTED),
  sub(/(?<![\w+/-])[\w+/-]{32,}={0,2}/g, (m) =>
    /[A-Z]/.test(m) && /[a-z]/.test(m) && /\d/.test(m) ? REDACTED : m,
  ),
];

const runSteps = (text: string): string => STEPS.reduce((out, step) => step(out), text);

/**
 * Characters of a value that a SPLIT may have cut in two (word characters and the punctuation of
 * emails, URLs, tokens and IPv6), with SPLIT itself. The lookbehind starts GLUED_BEFORE once per
 * run, so both scans are linear.
 */
const GLUED = '[\\w.%+/=:@\\u2063-]';
const GLUED_BEFORE = new RegExp(`(?<!${GLUED})${GLUED}*\\u2063\\[REDACTED\\]`, 'g');
const GLUED_AFTER = new RegExp(`\\[REDACTED\\]\\u2063${GLUED}*`, 'g');

/**
 * Runs every value pattern over canonical text. No length cap, so it is internal (not exported
 * from index.ts) and only redactString calls it, after the cap.
 *
 * Where canonical left a SPLIT, the patterns first read it as a word break, so a value glued to
 * the next word is still found. Any piece joined to a redaction by a SPLIT is then redacted with
 * it (it may be the rest of the same value), and the patterns run again with every SPLIT dropped,
 * so a value that the SPLIT cut in two is found whole.
 */
export const applyPatterns = (text: string): string => {
  const split = runSteps(text);
  if (!split.includes(SPLIT)) return split;
  return runSteps(
    split.replace(GLUED_BEFORE, REDACTED).replace(GLUED_AFTER, REDACTED).replaceAll(SPLIT, ''),
  );
};

/**
 * Redacts PII and secret patterns inside one string. Strings over the cap become TRUNCATED.
 * Text with no match comes back unchanged; otherwise the canonical text with its redactions does.
 */
export const redactString = (input: string): string => {
  if (input.length > MAX_STRING) return TRUNCATED;
  const text = canonical(input);
  const out = applyPatterns(text);
  if (out === text.replaceAll(SPLIT, '')) return input;
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
  const primitive = unbox(obj);
  if (primitive !== obj) return redactInner(primitive, depth, state);
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
      // An index loop, not obj.slice or obj.map: an own slice or map, or a species constructor
      // (which Array.prototype.slice.call would still look up), never runs.
      const n = Math.min(obj.length, MAX_ENTRIES);
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(redactInner(obj[i], depth + 1, state));
      if (obj.length > MAX_ENTRIES) out.push(TRUNCATED);
      return out;
    }
    if (obj instanceof Map || obj instanceof Set || ArrayBuffer.isView(obj)) return UNSUPPORTED;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj);
    const errorShaped = isSerializedErrorShape(obj, keys);
    for (const key of keys.slice(0, MAX_ENTRIES)) {
      const safeKey = redactString(key);
      out[safeKey] =
        errorShaped && key === 'name'
          ? errorName((obj as Record<string, unknown>)[key])
          : isSensitiveKey(key)
            ? REDACTED
            : STACK_KEY.test(normaliseKey(key))
              ? redactStack((obj as Record<string, unknown>)[key], depth + 1, state)
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
 * True for an object with the keys of serializeError output: `name` and a `stack` array, and maybe
 * `code` (spec review L4). Its name is kept only if it is an error class name (errorName), so a
 * serialised error is stable on a second pass. Its code stays under the `code` stem: an object of
 * this shape may be plain data, and passing its code would weaken the stem rule.
 */
const isSerializedErrorShape = (obj: object, keys: readonly string[]): boolean =>
  keys.includes('name') &&
  keys.includes('stack') &&
  keys.every((k) => k === 'name' || k === 'stack' || k === 'code') &&
  Array.isArray((obj as { stack?: unknown }).stack);

/** An error class name (never a person's name) passes the string patterns; anything else goes. */
const errorName = (name: unknown): string =>
  isErrorName(name) || name === REDACTED ? redactString(name) : REDACTED;

/**
 * The primitive inside a String, Number, Boolean, BigInt or Symbol wrapper, read with the built-in
 * valueOf (so the text is redacted as a whole, not as one key per character); otherwise obj.
 */
const unbox = (obj: object): unknown => {
  try {
    const tag = Object.prototype.toString.call(obj);
    if (obj instanceof String || tag === '[object String]')
      return String.prototype.valueOf.call(obj);
    if (obj instanceof Number || tag === '[object Number]')
      return Number.prototype.valueOf.call(obj);
    if (obj instanceof Boolean || tag === '[object Boolean]') {
      return Boolean.prototype.valueOf.call(obj);
    }
    if (tag === '[object BigInt]') return BigInt.prototype.valueOf.call(obj);
    if (tag === '[object Symbol]') return Symbol.prototype.valueOf.call(obj);
  } catch {
    // A look-alike (a wrapper's prototype without its value, a spoofed tag): walk it as an object.
  }
  return obj;
};

/** Keys (normalised) that hold a stack trace: stack, stackTrace, stack_trace, errorStack, … */
const STACK_KEY = /stack(?:trace)?$/;

/** Redacts frames, then drops any line that no longer looks like a frame (keeps this idempotent). */
const redactFrames = (frames: readonly string[]): string[] =>
  frames.map(redactString).filter(isStackFrame);

/** What redact puts in place of a value; under a stack key a first pass can leave any of them. */
const MARKERS: ReadonlySet<string> = new Set([REDACTED, TRUNCATED, CIRCULAR, UNSUPPORTED]);

/** At most this many entries in a stack array, as serializeError keeps at most 20 frames. */
const MAX_STACK_ENTRIES = 20;

/**
 * The frames of an array of stack lines. Each string element is read like a stack string, but an
 * element over the cap is never split and filtered: it becomes one TRUNCATED entry in its place
 * (spec §9.1 caps, spec review M1), and a TRUNCATED entry from an earlier pass stays.
 */
const stackArrayFrames = (value: readonly unknown[]): string[] => {
  const out: string[] = [];
  let lines: string[] = [];
  const flush = (): void => {
    out.push(...redactFrames(stackFrames(lines.join('\n'))));
    lines = [];
  };
  const n = Math.min(value.length, MAX_ENTRIES);
  for (let i = 0; i < n; i++) {
    const line: unknown = value[i];
    if (typeof line !== 'string') continue;
    if (line === TRUNCATED || line.length > MAX_STRING) {
      flush();
      out.push(TRUNCATED);
    } else {
      lines.push(line);
    }
  }
  flush();
  return out.slice(0, MAX_STACK_ENTRIES);
};

/**
 * A stack logged as data, as a string or an array of lines: only the lines serializeError would
 * keep as frames survive, so no message text does. Any other value is redacted as usual.
 */
const redactStack = (value: unknown, depth: number, state: State): unknown => {
  // A marker from an earlier pass stays as it is, so a second pass is stable (spec review L3).
  if (typeof value === 'string' && MARKERS.has(value)) return value;
  if (typeof value === 'string') {
    // Over the cap, a stack string is truncated like any other string (spec §9.1: never passed through).
    if (value.length > MAX_STRING) return TRUNCATED;
    if (--state.budget < 0 || depth >= MAX_DEPTH) return TRUNCATED;
    return redactFrames(stackFrames(value));
  }
  if (Array.isArray(value)) {
    if (--state.budget < 0 || depth >= MAX_DEPTH) return TRUNCATED;
    return stackArrayFrames(value);
  }
  return redactInner(value, depth, state);
};

/**
 * Value-only redaction for serializeError output: its keys (name, code, stack) are fixed and safe,
 * but every value still passes the string patterns (a code or name can carry a PII-shaped value).
 */
export const redactSerializedError = (err: SerializedError): SerializedError => {
  const out: SerializedError = { name: redactString(err.name) };
  if (err.code !== undefined) out.code = redactString(err.code);
  if (err.stack !== undefined) out.stack = redactFrames(err.stack);
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
