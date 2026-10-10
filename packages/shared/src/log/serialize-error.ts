// Error serialiser for logs and error reports (spec §9.1, §9.2).
// Messages are dropped: PostgREST, Postgres and zod messages can echo input such as Key (email)=(…).

export interface SerializedError {
  name: string;
  code?: string;
  stack?: string[];
}

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,32}$/;
const MAX_FRAMES = 20;

export const serializeError = (err: unknown): SerializedError => {
  if (!(err instanceof Error)) return { name: 'NonError' };
  const out: SerializedError = { name: SAFE_NAME.test(err.name) ? err.name : 'Error' };
  const code: unknown = (err as { code?: unknown }).code;
  if ((typeof code === 'string' || typeof code === 'number') && SAFE_CODE.test(String(code))) {
    out.code = String(code);
  }
  if (typeof err.stack === 'string') {
    // Frames only: the first stack line repeats the message, so keep only 'at …' lines.
    out.stack = err.stack
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('at '))
      .slice(0, MAX_FRAMES);
  }
  return out;
};
