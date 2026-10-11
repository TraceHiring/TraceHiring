// Error serialiser for logs and error reports (spec §9.1, §9.2).
// Messages are dropped: PostgREST, Postgres and zod messages can echo input such as Key (email)=(…).
// That includes the stack, whose header repeats the message (and a message can span lines that
// look like frames), so only V8 frames after the message that end in line:column are kept.

export interface SerializedError {
  name: string;
  code?: string;
  stack?: string[];
}

/**
 * An error class name (`TypeError`, `ValidationError`, `DOMException`): it ends in Error or
 * Exception, so it is not a person's name. Any other name is logged as 'Error', and redact keeps
 * such a name on a second pass although `name` is a PII stem (spec review L4).
 */
const ERROR_NAME = /^(?:[A-Za-z][A-Za-z0-9_.]{0,54})?(?:Error|Exception)$/;
export const isErrorName = (name: unknown): name is string =>
  typeof name === 'string' && ERROR_NAME.test(name);
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,32}$/;
const MAX_FRAMES = 20;
const MAX_FRAME_LENGTH = 300;
/** A V8 frame: `at fn (file:line:col)` or `at file:line:col`. Other engines' frames are dropped. */
// The function (optionally `async `/`new `-prefixed, with an optional `[as name]`) and the location are
// single tokens without spaces, so a message line shaped like a frame (`at 12:30 <words>:1:1`) is dropped,
// as are paths with spaces (fail safe; redactor security review #1). Lines are capped first.
const FRAME = /^at (?:(?:async |new )?[^\s()]+(?: \[as [^\s\]]+\])? \()?[^\s()]+:\d+:\d+\)?$/;

/** True for one trimmed line that is a V8 frame within the length cap. */
export const isStackFrame = (line: string): boolean =>
  line.length <= MAX_FRAME_LENGTH && FRAME.test(line);

/**
 * The frames among lines (trimmed) that pass `keep`, at most MAX_FRAMES; a line the message holds
 * is dropped.
 */
const framesOf = (
  lines: readonly string[],
  message: string,
  keep: (frame: string) => boolean = () => true,
): string[] => {
  const frames: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!isStackFrame(line) || !keep(line)) continue;
    if (message !== '' && message.includes(line)) continue;
    frames.push(line);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
};

/** How V8 prints each frame of err.stack: on its own line after the header, indented 4 spaces. */
const V8_FRAME_LINE = /^ {4}at /;

/**
 * The header V8 prints before the frames: the name and message, joined as Error.prototype.toString
 * joins them (an own toString is not used), as they are when err.stack is first read. Undefined
 * unless both are strings.
 */
const v8Header = (name: unknown, message: unknown): string | undefined => {
  if (typeof name !== 'string' || typeof message !== 'string') return undefined;
  if (name === '') return message;
  return message === '' ? name : `${name}: ${message}`;
};

/**
 * True for a frame whose location is a path or a URL: it holds '/' or '\' (`/app/a.js:1:2`,
 * `file:///app/a.js:1:2`, `node:internal/x:1:2`, `C:\app\a.js:1:2`). The location is the text in
 * the frame's parentheses, or the whole frame when it has none (isStackFrame allows no other).
 */
const hasPathLocation = (frame: string): boolean => {
  const open = frame.lastIndexOf('(');
  return /[/\\]/.test(open < 0 ? frame : frame.slice(open));
};

/**
 * The frames of err.stack: only the trailing run of lines that V8 printed as frames, and never a
 * line of the header before it (the message, which can span lines), even where one is frame-shaped
 * (spec review L2). A frame-shaped line the current message holds is dropped as well.
 *
 * When the stack starts with the header of the current name and message, its lines are skipped
 * exactly. Otherwise the header was fixed with an older name or message (the stack was read before
 * one of them changed) or the stack was set by hand, and an older message's last lines, indented
 * like frames, cannot be told apart from the frames after them; so a frame must then also have a
 * path or URL location (redactor lows review F6). Frames of a bundle without one (`index.js:1:2`)
 * are dropped in that case, which is the safe side.
 *
 * Not covered: a message line that is itself a frame with a path location, and a message changed,
 * after the stack was read, to its own first lines (the stack then starts with the current header,
 * and the old message's later lines follow it).
 */
const errorFrames = (stack: string, header: string | undefined, message: string): string[] => {
  const lines = stack.split('\n');
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') end--;
  let start = end;
  while (start > 0 && V8_FRAME_LINE.test(lines[start - 1] ?? '')) start--;
  if (header !== undefined && (stack === header || stack.startsWith(`${header}\n`))) {
    return framesOf(lines.slice(Math.max(start, header.split('\n').length), end), message);
  }
  return framesOf(lines.slice(start, end), message, hasPathLocation);
};

/**
 * The frames of a stack whose message is unknown (a stack logged as data): every line that is not
 * a frame goes, so the header and message lines do too (redact.ts, stack-like keys). Lines need
 * no indentation here: redacted output holds trimmed frames, and a second pass must keep them.
 */
export const stackFrames = (stack: string): string[] => framesOf(stack.split('\n'), '');

export const serializeError = (err: unknown): SerializedError => {
  if (!(err instanceof Error)) return { name: 'NonError' };
  const name: unknown = err.name;
  const out: SerializedError = { name: isErrorName(name) ? name : 'Error' };
  const code: unknown = (err as { code?: unknown }).code;
  if ((typeof code === 'string' || typeof code === 'number') && SAFE_CODE.test(String(code))) {
    out.code = String(code);
  }
  const message: unknown = err.message;
  if (typeof err.stack === 'string') {
    const header = v8Header(name, message);
    out.stack = errorFrames(err.stack, header, typeof message === 'string' ? message : '');
  }
  return out;
};
