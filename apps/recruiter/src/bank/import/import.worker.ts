// The import Web Worker (ADR-033, R5-48): a same-origin module bundled by Vite and started with
// `new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })` (worker-client.ts), so the CSP needs
// only `worker-src 'self'`. One request in, one answer out; the page terminates it afterwards. All work is in
// worker-handler.ts and zip-core.ts.
import { handleWorkerMessage } from './worker-handler';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  void handleWorkerMessage(event.data).then((reply) => {
    scope.postMessage(reply.answer, reply.transfer);
  });
});
