// Deterministic values of one drafting job, derived from its id with Web Crypto SHA-256 (no Math.random, no clock), so a
// re-delivery reproduces the same drafts and the same item ids (specs/m1-test-authoring.md §6.4, R5-52 g; CLAUDE.md
// "Exactly-once results from at-least-once delivery"). Ids are lower-case 36-character uuids, so plain concatenation
// with a fixed label is unambiguous.

const digest = async (text: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** The MockLlmDrafter seed of a job: the first 48 bits of SHA-256('ai_draft_seed:' ‖ jobId), a safe integer. */
export const jobSeed = async (jobId: string): Promise<number> => {
  const d = await digest(`ai_draft_seed:${jobId.toLowerCase()}`);
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + (d[i] ?? 0);
  return n;
};

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The bank item id of the draft at `position` of the drafter's answer: SHA-256('ai_draft_item:' ‖ jobId ‖ ':' ‖
 * position) shaped as an RFC 9562 version-8 uuid.
 */
export const draftItemId = async (jobId: string, position: number): Promise<string> => {
  if (!Number.isSafeInteger(position) || position < 0) throw new TypeError('draftItemId: position');
  const b = (await digest(`ai_draft_item:${jobId.toLowerCase()}:${String(position)}`)).slice(0, 16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
