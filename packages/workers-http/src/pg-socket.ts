// The TCP transport postgres.js uses in services/api and workers/jobs (ADR-031 amendment 1; d1 revision 4o).
//
// Why: postgres.js 3.4.9 (cf/src/connection.js `closed`) reconnects at once and without limit when the socket closes
// before the startup exchange ends (`if (initial) return reconnect()`, no backoff). On staging a refused TLS upgrade
// did exactly that, and every attempt was a Workers subrequest until the invocation died ("Too many subrequests").
// postgres.js takes a `socket` factory and calls it for every connection attempt; this one allows `maxConnects`
// TCP connections per client (one: every client here runs one transaction and is closed) and throws
// DB_CONNECT_REFUSED on the next call, which postgres.js turns into a rejected query at once. A Worker never opens
// TLS to Postgres itself: remote databases are reached through Hyperdrive (which verifies the origin with the
// Supabase CA), and only the local stack is reached directly, so this transport is plain TCP only.
//
// The socket shape follows postgres.js's own Workers polyfill (cf/polyfills.js `Socket`): an EventEmitter with
// readyState, write(data, cb), end(data), destroy(), and the events 'data' (a Buffer), 'error' then 'close' on a
// failure, 'close' once on an orderly end. `connect` is injected (cloudflare:sockets in a Worker, a Node socket in
// tests), so this file has no runtime-specific import. It never sees a URL, a user or a password: postgres.js does
// the authentication over the socket.
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';

/** The part of a cloudflare:sockets `Socket` this transport uses. */
export interface RawSocket {
  readonly opened: Promise<unknown>;
  readonly closed: Promise<unknown>;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

/** `connect` of cloudflare:sockets, narrowed to a host name and a port (plain TCP). */
export type ConnectFn = (address: { hostname: string; port: number }) => RawSocket;

/** The constant error of a second connection attempt by one client. */
export const DB_CONNECT_REFUSED = 'db_connect_refused';

/** The socket postgres.js drives. */
export interface PgSocket extends EventEmitter {
  readyState: 'open' | 'closed';
  write(data: Uint8Array, cb?: () => void): boolean;
  end(data?: Uint8Array): void;
  destroy(): void;
}

/** The fields postgres.js passes to its `socket` option (parsed hosts and ports; one host is used). */
export interface PgSocketOptions {
  readonly host: readonly string[];
  readonly port: readonly number[];
}

const wrap = (raw: RawSocket): PgSocket => {
  const socket = new EventEmitter() as PgSocket;
  const writer = raw.writable.getWriter();
  const reader = raw.readable.getReader();
  socket.readyState = 'open';

  const close = () => {
    if (socket.readyState === 'closed') return;
    socket.readyState = 'closed';
    socket.emit('close');
  };
  const fail = (err: unknown) => {
    if (socket.readyState === 'closed') return;
    socket.emit('error', err instanceof Error ? err : new Error(DB_CONNECT_REFUSED));
    close();
  };
  const shut = () => {
    raw.close().catch(() => {});
  };

  socket.write = (data, cb) => {
    writer.write(data).then(() => cb?.(), fail);
    return true;
  };
  socket.end = (data) => {
    if (data === undefined) shut();
    else socket.write(data, shut);
  };
  socket.destroy = () => {
    shut();
  };

  raw.closed.then(close, fail);
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        socket.emit('data', Buffer.from(value));
      }
    } catch (err) {
      fail(err);
    }
  })();
  return socket;
};

/**
 * The postgres.js `socket` option for one client: at most `maxConnects` TCP connections, then DB_CONNECT_REFUSED.
 * Create one per `postgres(...)` call; the count is the client's.
 */
export const cappedSocket = (connect: ConnectFn, maxConnects = 1) => {
  if (!Number.isInteger(maxConnects) || maxConnects < 1) {
    throw new Error('cappedSocket: maxConnects must be a positive integer');
  }
  let used = 0;
  return async (options: PgSocketOptions): Promise<PgSocket> => {
    if (used >= maxConnects) throw new Error(DB_CONNECT_REFUSED);
    used += 1;
    const hostname = options.host[0];
    const port = options.port[0];
    if (hostname === undefined || port === undefined) throw new Error(DB_CONNECT_REFUSED);
    const raw = connect({ hostname, port });
    // A socket that never opens also rejects `closed`; nobody else would handle that.
    raw.closed.then(undefined, () => {});
    await raw.opened;
    return wrap(raw);
  };
};

/**
 * `{ socket }` to spread into postgres.js options: a fresh capped factory for one client. postgres.js documents the
 * option (README "Custom socket", options list `socket: fn`) but its 3.4.9 type definitions omit it, so it is
 * returned as a separate object, never as an object literal inside the options.
 */
export const cappedSocketOption = (
  connect: ConnectFn,
): { readonly socket: ReturnType<typeof cappedSocket> } => ({ socket: cappedSocket(connect) });
