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

const framesOf = (stack: string, message: string): string[] => {
  // Skip the header: everything up to the end of the first copy of the message.
  const at = message === '' ? -1 : stack.indexOf(message);
  const body = at === -1 ? stack : stack.slice(at + message.length);
  const frames: string[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!isStackFrame(line)) continue;
    // A message changed after the stack was captured can still sit in it: drop any line it holds.
    if (message !== '' && message.includes(line)) continue;
    frames.push(line);
    if (frames.length === MAX_FRAMES) break;
  }
  return frames;
};

/**
 * The frames of a stack whose message is unknown (a stack logged as data): every line that is not
 * a frame goes, so the header and message lines do too (redact.ts, stack-like keys).
 */
export const stackFrames = (stack: string): string[] => framesOf(stack, '');

export const serializeError = (err: unknown): SerializedError => {
  if (!(err instanceof Error)) return { name: 'NonError' };
  const out: SerializedError = { name: SAFE_NAME.test(err.name) ? err.name : 'Error' };
  const code: unknown = (err as { code?: unknown }).code;
  if ((typeof code === 'string' || typeof code === 'number') && SAFE_CODE.test(String(code))) {
    out.code = String(code);
  }
  const message: unknown = err.message;
  if (typeof err.stack === 'string') {
    out.stack = framesOf(err.stack, typeof message === 'string' ? message : '');
  }
  return out;
};
