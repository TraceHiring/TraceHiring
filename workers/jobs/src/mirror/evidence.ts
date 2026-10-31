// R2 inputs of the mirror stage (spec d1 §4.4, §5.1 row `mirror`; carried C1b binding on the start photo).
// final.json is read from its canonical key and hash-checked against the message before anything is parsed; the
// start photo row is written only for a canonical start_photo.jpg whose stored sha256 (and size) equal the mirrored
// ones, otherwise no media row is written (fail closed: the report then shows no photo).
import { FinalAnswers, type SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import type { EvidenceReader } from '@trace/shared/jobs';

/** final.json holds at most 100 answers of at most 10 000 characters each; anything larger is refused unread. */
export const MAX_FINAL_BYTES = 8 * 1024 * 1024;

const fail = (code: string): never => {
  throw new Error(code);
};

const hex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');

export const sha256HexBytes = async (
  bytes: ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> => hex(await crypto.subtle.digest('SHA-256', bytes));
export const sha256Hex = (text: string): Promise<string> =>
  sha256HexBytes(new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>);

export const finalKeyOf = (orgId: string, sessionId: string): string =>
  `sessions/${orgId}/${sessionId}/final.json`;
export const startPhotoKeyOf = (orgId: string, sessionId: string): string =>
  `media/${orgId}/${sessionId}/start_photo.jpg`;

/** Reads, hash-checks and parses final.json. Every failure is a constant code. */
export const readFinalAnswers = async (
  evidence: EvidenceReader,
  message: SessionMirrorMessage,
): Promise<FinalAnswers> => {
  const key = finalKeyOf(message.orgId, message.sessionId);
  if (message.evidence.finalKey !== key) return fail('mirror_bad_message');
  const object = await evidence.get(key);
  if (object === null) return fail('mirror_final_missing');
  if (object.size > MAX_FINAL_BYTES) return fail('mirror_final_invalid');
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength > MAX_FINAL_BYTES) return fail('mirror_final_invalid');
  if ((await sha256HexBytes(bytes)) !== message.evidence.finalSha256) {
    return fail('mirror_final_hash_mismatch');
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return fail('mirror_final_invalid');
  }
  const parsed = FinalAnswers.safeParse(json);
  if (!parsed.success || parsed.data.sessionId !== message.sessionId) {
    return fail('mirror_final_invalid');
  }
  return parsed.data;
};

export interface VerifiedPhoto {
  key: string;
  sha256: string;
  bytes: number;
}

/**
 * The start photo to record, or null. Null when the message names none, names a key other than the canonical one,
 * or when the canonical object is missing or carries another sha256 or size (C1b residuals, fail closed).
 */
export const verifiedPhoto = async (
  evidence: EvidenceReader,
  message: SessionMirrorMessage,
): Promise<VerifiedPhoto | null> => {
  const photo = message.photo;
  if (photo === null) return null;
  const key = startPhotoKeyOf(message.orgId, message.sessionId);
  if (photo.key !== key) return null;
  const head = await evidence.head(key);
  if (head === null) return null;
  if (head.customMetadata['sha256'] !== photo.sha256 || head.size !== photo.bytes) return null;
  return { key, sha256: photo.sha256, bytes: photo.bytes };
};
