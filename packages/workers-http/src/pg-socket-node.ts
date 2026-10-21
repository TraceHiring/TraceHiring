// A Node TCP socket in the cloudflare:sockets `Socket` shape, for Node tests of the capped postgres.js transport
// (src/pg-socket.ts): its own unit tests and the jobs real-database tests (workers/jobs/db-test). Node only, never
// bundled into a Worker (the Workers pass cloudflare:sockets `connect`). A peer that closes ends the readable stream
// cleanly, as cloudflare:sockets does, so postgres.js sees a close, not an error.
import { Socket as NodeSocket } from 'node:net';
import type { ConnectFn } from './pg-socket.js';

export const nodeConnect: ConnectFn = ({ hostname, port }) => {
  const s = new NodeSocket();
  const opened = new Promise<void>((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('error', reject);
  });
  const closed = new Promise<void>((resolve, reject) => {
    s.once('close', (hadError) => (hadError ? reject(new Error('socket error')) : resolve()));
  });
  s.on('error', () => {});
  s.connect(port, hostname);
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      s.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      s.once('close', () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write: (chunk) =>
      new Promise<void>((resolve, reject) => {
        s.write(chunk, (err) => (err ? reject(err) : resolve()));
      }),
  });
  return {
    opened,
    closed,
    readable,
    writable,
    close: async () => {
      s.destroy();
    },
  };
};
