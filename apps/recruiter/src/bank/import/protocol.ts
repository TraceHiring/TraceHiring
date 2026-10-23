// The messages between the page and the import worker (R5-48). Both sides validate what they receive: the worker
// checks the request, the page checks the answer, and anything that does not fit is a failure, never a guess.
// (Hand-written guards: zod is not a dependency of apps/recruiter and package.json is not this stream's to change.)

export const EXTRACT_KINDS = ['xlsx', 'docx', 'zip'] as const;
export type ExtractKind = (typeof EXTRACT_KINDS)[number];

/** Why an extraction stopped. One code per stop; no message, name or content travels with it. */
export const EXTRACT_ERROR_CODES = [
  'bad_request',
  'bad_extension',
  'macro_file',
  'file_too_large',
  'archive_too_large',
  'too_many_entries',
  'too_many_images',
  'bad_archive',
  'worker_failed',
] as const;
export type ExtractErrorCode = (typeof EXTRACT_ERROR_CODES)[number];

export interface ExtractRequest {
  type: 'extract';
  kind: ExtractKind;
  file: Blob;
  name: string;
}

export interface XmlPart {
  name: string;
  text: string;
}
export interface ImagePart {
  name: string;
  bytes: Uint8Array;
}
/** An image the worker saw but did not post: its declared size is over the per-image cap. */
export interface SkippedImage {
  name: string;
  reason: 'too_large';
}

export interface ExtractResult {
  type: 'result';
  kind: ExtractKind;
  xml: XmlPart[];
  images: ImagePart[];
  skippedImages: SkippedImage[];
}
export interface ExtractFailure {
  type: 'error';
  code: ExtractErrorCode;
}
export type WorkerAnswer = ExtractResult | ExtractFailure;

const MAX_NAME = 300;
const MAX_XML_PARTS = 512;
const MAX_POSTED_IMAGES = 2000;
const MAX_SKIPPED = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasOnly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
const isName = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= MAX_NAME;
const isKind = (value: unknown): value is ExtractKind =>
  typeof value === 'string' && (EXTRACT_KINDS as readonly string[]).includes(value);
const isErrorCode = (value: unknown): value is ExtractErrorCode =>
  typeof value === 'string' && (EXTRACT_ERROR_CODES as readonly string[]).includes(value);

/** The request as the worker may trust it, or null. */
export function parseExtractRequest(data: unknown): ExtractRequest | null {
  if (!isRecord(data) || !hasOnly(data, ['type', 'kind', 'file', 'name'])) return null;
  const { type, kind, file, name } = data;
  if (type !== 'extract' || !isKind(kind) || !(file instanceof Blob)) return null;
  if (typeof name !== 'string' || name.length > 260) return null;
  return { type: 'extract', kind, file, name };
}

/** The worker's answer as the page may trust it, or null. */
export function parseWorkerAnswer(data: unknown): WorkerAnswer | null {
  if (!isRecord(data)) return null;
  if (data['type'] === 'error') {
    if (!hasOnly(data, ['type', 'code']) || !isErrorCode(data['code'])) return null;
    return { type: 'error', code: data['code'] };
  }
  if (
    data['type'] !== 'result' ||
    !hasOnly(data, ['type', 'kind', 'xml', 'images', 'skippedImages'])
  ) {
    return null;
  }
  const { kind, xml, images, skippedImages } = data;
  if (!isKind(kind)) return null;
  if (!Array.isArray(xml) || xml.length > MAX_XML_PARTS) return null;
  if (!Array.isArray(images) || images.length > MAX_POSTED_IMAGES) return null;
  if (!Array.isArray(skippedImages) || skippedImages.length > MAX_SKIPPED) return null;
  const xmlOut: XmlPart[] = [];
  for (const part of xml as unknown[]) {
    if (!isRecord(part) || !hasOnly(part, ['name', 'text'])) return null;
    if (!isName(part['name']) || typeof part['text'] !== 'string') return null;
    xmlOut.push({ name: part['name'], text: part['text'] });
  }
  const imagesOut: ImagePart[] = [];
  for (const image of images as unknown[]) {
    if (!isRecord(image) || !hasOnly(image, ['name', 'bytes'])) return null;
    if (!isName(image['name']) || !(image['bytes'] instanceof Uint8Array)) return null;
    imagesOut.push({ name: image['name'], bytes: image['bytes'] });
  }
  const skippedOut: SkippedImage[] = [];
  for (const skipped of skippedImages as unknown[]) {
    if (!isRecord(skipped) || !hasOnly(skipped, ['name', 'reason'])) return null;
    if (!isName(skipped['name']) || skipped['reason'] !== 'too_large') return null;
    skippedOut.push({ name: skipped['name'], reason: 'too_large' });
  }
  return { type: 'result', kind, xml: xmlOut, images: imagesOut, skippedImages: skippedOut };
}
