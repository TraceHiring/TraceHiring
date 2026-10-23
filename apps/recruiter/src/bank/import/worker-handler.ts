// What the import worker does with one message (R5-48): validate the request, run the extraction, answer with exactly
// one message. Kept apart from import.worker.ts so tests can run it without a Worker. Nothing here logs or throws a
// message; a failure is one constant code.
import { IMPORT_LIMITS, type ImportLimits } from './limits';
import { parseExtractRequest, type WorkerAnswer } from './protocol';
import { extractArchive } from './zip-core';

export interface WorkerReply {
  answer: WorkerAnswer;
  /** Buffers to hand over instead of copying. */
  transfer: ArrayBuffer[];
}

export async function handleWorkerMessage(
  data: unknown,
  limits: ImportLimits = IMPORT_LIMITS,
): Promise<WorkerReply> {
  const request = parseExtractRequest(data);
  if (request === null) return { answer: { type: 'error', code: 'bad_request' }, transfer: [] };
  let answer: WorkerAnswer;
  try {
    answer = await extractArchive(request.file, request.name, request.kind, limits);
  } catch {
    answer = { type: 'error', code: 'bad_archive' };
  }
  const transfer: ArrayBuffer[] = [];
  if (answer.type === 'result') {
    for (const image of answer.images) {
      if (image.bytes.buffer instanceof ArrayBuffer) transfer.push(image.bytes.buffer);
    }
  }
  return { answer, transfer };
}
