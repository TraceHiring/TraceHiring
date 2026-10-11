// Error serialiser for logs and error reports (spec §9.1, §9.2).
// Messages are dropped: PostgREST, Postgres and zod messages can echo input such as Key (email)=(…).
// That includes the stack, whose header repeats the message (and a message can span lines that
// look like frames), so only V8 frames after the message that end in line:column are kept.

export interface SerializedError {
  name: string;
  code?: string;
  stack?: string[];
}

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;
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

/** The frames among lines (trimmed), at most MAX_FRAMES; a line the message holds is dropped. */
const framesOf = (lines: readonly string[], message: string): string[] => {
  const frames: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!isStackFrame(line)) continue;
    if (message !== '' && message.includes(line)) continue;
    frames.push(line);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
};

/** How V8 prints each frame of err.stack: on its own line after the header, indented 4 spaces. */
const V8_FRAME_LINE = /^ {4}at /;

/**
 * The frames of err.stack: only the trailing run of lines that V8 printed as frames. The header
 * before it (the message, which can span lines and was fixed when the stack was captured, so a
 * message changed later no longer matches it) never counts, even where a line is frame-shaped
 * (spec review L2). A frame-shaped line the current message holds is dropped as well.
 */
const errorFrames = (stack: string, message: string): string[] => {
  const lines = stack.split('\n');
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') end--;
  let start = end;
  while (start > 0 && V8_FRAME_LINE.test(lines[start - 1] ?? '')) start--;
  return framesOf(lines.slice(start, end), message);
};

/**
 * The frames of a stack whose message is unknown (a stack logged as data): every line that is not
 * a frame goes, so the header and message lines do too (redact.ts, stack-like keys). Lines need
 * no indentation here: redacted output holds trimmed frames, and a second pass must keep them.
 */
export const stackFrames = (stack: string): string[] => framesOf(stack.split('\n'), '');

export const serializeError = (err: unknown): SerializedError => {
  if (!(err instanceof Error)) return { name: 'NonError' };
  const out: SerializedError = { name: SAFE_NAME.test(err.name) ? err.name : 'Error' };
  const code: unknown = (err as { code?: unknown }).code;
  if ((typeof code === 'string' || typeof code === 'number') && SAFE_CODE.test(String(code))) {
    out.code = String(code);
  }
  const message: unknown = err.message;
  if (typeof err.stack === 'string') {
    out.stack = errorFrames(err.stack, typeof message === 'string' ? message : '');
  }
  return out;
};
