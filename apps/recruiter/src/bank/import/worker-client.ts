// The page's side of the import worker (R5-48). The worker is created from a same-origin module URL (ADR-033 §4); every
// answer is checked with parseWorkerAnswer, and anything that does not fit is `worker_failed`.
import {
  parseWorkerAnswer,
  type ExtractFailure,
  type ExtractKind,
  type ExtractRequest,
  type ExtractResult,
} from './protocol';

/** The part of a Worker the client uses; tests pass a fake. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror: ((event: unknown) => void) | null;
}
export type CreateWorker = () => WorkerLike;

export const createImportWorker: CreateWorker = () => {
  const real = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      real.postMessage(message);
    },
    terminate() {
      real.terminate();
    },
  };
  real.onmessage = (event: MessageEvent<unknown>) => {
    worker.onmessage?.({ data: event.data });
  };
  real.onerror = (event) => {
    worker.onerror?.(event);
  };
  real.onmessageerror = (event) => {
    worker.onmessageerror?.(event);
  };
  return worker;
};

const FAILED: ExtractFailure = { type: 'error', code: 'worker_failed' };

/** Runs one extraction in a fresh worker and always terminates it. */
export function extractInWorker(
  create: CreateWorker,
  file: File,
  kind: ExtractKind,
): Promise<ExtractResult | ExtractFailure> {
  return new Promise((resolve) => {
    let worker: WorkerLike;
    try {
      worker = create();
    } catch {
      resolve(FAILED);
      return;
    }
    const finish = (answer: ExtractResult | ExtractFailure): void => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      resolve(answer);
    };
    worker.onmessage = (event) => {
      const answer = parseWorkerAnswer(event.data);
      // The answer must also be for the kind we asked about.
      finish(
        answer === null || (answer.type === 'result' && answer.kind !== kind) ? FAILED : answer,
      );
    };
    worker.onerror = () => {
      finish(FAILED);
    };
    worker.onmessageerror = () => {
      finish(FAILED);
    };
    const request: ExtractRequest = { type: 'extract', kind, file, name: file.name };
    try {
      worker.postMessage(request);
    } catch {
      finish(FAILED);
    }
  });
}
