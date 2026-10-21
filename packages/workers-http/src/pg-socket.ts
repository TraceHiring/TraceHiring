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
// The socket shape follows postgres.js's own Workers polyfill (cf/polyfills.js `Socket`): an event emitter with
// readyState, write(data, cb), end(data), destroy(), and the events 'data' (a Buffer), 'error' then 'close' on a
// failure, 'close' once on an orderly end. postgres.js calls only on, once, removeListener and removeAllListeners on
// a custom socket (pause and resume serve COPY streams, which nothing here uses), so a small emitter suffices.
// `connect` is injected (cloudflare:sockets in a Worker, a Node socket in tests) and Buffer is the runtime's global
// (workerd with nodejs_compat, Node), so this file has no runtime-specific import and the Worker sources keep their
// runtime-only types. It never sees a URL, a user or a password: postgres.js does the authentication over the socket.

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

// `never[]` lets a listener declare the argument it expects (a Buffer for data, an Error for error).
type Listener = (...args: never[]) => void;

/** The socket postgres.js drives. */
export interface PgSocket {
  readyState: 'open' | 'closed';
  on(event: string, fn: Listener): PgSocket;
  once(event: string, fn: Listener): PgSocket;
  removeListener(event: string, fn: Listener): PgSocket;
  removeAllListeners(event?: string): PgSocket;
  write(data: Uint8Array, cb?: () => void): boolean;
  end(data?: Uint8Array): void;
  destroy(): void;
}

/** The fields postgres.js passes to its `socket` option (parsed hosts and ports; one host is used). */
export interface PgSocketOptions {
  readonly host: readonly string[];
  readonly port: readonly number[];
}

/** The runtime's Buffer (postgres.js parses every 'data' chunk as one). */
const toBuffer = (bytes: Uint8Array): Uint8Array => {
  const B = (globalThis as { Buffer?: { from(v: Uint8Array): Uint8Array } }).Buffer;
  if (B === undefined) throw new Error(DB_CONNECT_REFUSED);
  return B.from(bytes);
};

const wrap = (raw: RawSocket): PgSocket => {
  const listeners = new Map<string, { fn: Listener; once: boolean }[]>();
  const emit = (event: string, ...args: unknown[]) => {
    for (const l of [...(listeners.get(event) ?? [])]) {
      if (l.once) socket.removeListener(event, l.fn);
      (l.fn as (...a: unknown[]) => void)(...args);
    }
  };
  const add = (event: string, fn: Listener, once: boolean) => {
    listeners.set(event, [...(listeners.get(event) ?? []), { fn, once }]);
    return socket;
  };
  const writer = raw.writable.getWriter();
  const reader = raw.readable.getReader();

  const close = () => {
    if (socket.readyState === 'closed') return;
    socket.readyState = 'closed';
    emit('close');
  };
  const fail = (err: unknown) => {
    if (socket.readyState === 'closed') return;
    emit('error', err instanceof Error ? err : new Error(DB_CONNECT_REFUSED));
    close();
  };
  const shut = () => {
    raw.close().catch(() => {});
  };

  const socket: PgSocket = {
    readyState: 'open',
    on: (event, fn) => add(event, fn, false),
    once: (event, fn) => add(event, fn, true),
    removeListener: (event, fn) => {
      const list = listeners.get(event) ?? [];
      const i = list.findIndex((l) => l.fn === fn);
      if (i >= 0) listeners.set(event, [...list.slice(0, i), ...list.slice(i + 1)]);
      return socket;
    },
    removeAllListeners: (event) => {
      if (event === undefined) listeners.clear();
      else listeners.delete(event);
      return socket;
    },
    write: (data, cb) => {
      writer.write(data).then(() => cb?.(), fail);
      return true;
    },
    end: (data) => {
      if (data === undefined) shut();
      else socket.write(data, shut);
    },
    destroy: () => {
      shut();
    },
  };

  raw.closed.then(close, fail);
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        emit('data', toBuffer(value));
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

const LOCAL_DB_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Whether a database URL secret may be used: a postgres(ql) URL on the local stack's loopback host with no query
 * parameter (so no sslmode, host or options override). Every remote database goes through Hyperdrive instead.
 */
export const localDbUrlAllowed = (url: string): boolean => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') return false;
  if (u.search !== '' || u.hash !== '') return false;
  return LOCAL_DB_HOSTS.has(u.hostname.toLowerCase());
};

/** The part of a Hyperdrive binding this code reads. */
export interface HyperdriveLike {
  readonly connectionString?: unknown;
}

/**
 * The connection string for one login: the Hyperdrive binding's when it is bound (it wins; staging), else the URL
 * secret when localDbUrlAllowed (the local stack), else null (the caller fails closed). Never echoes either value.
 */
export const pgConnectionString = (
  binding: HyperdriveLike | undefined,
  url: string | undefined,
): string | null => {
  if (binding !== undefined && binding !== null) {
    const cs = binding.connectionString;
    return typeof cs === 'string' && cs !== '' ? cs : null;
  }
  if (url === undefined || url === '') return null;
  return localDbUrlAllowed(url) ? url : null;
};

/**
 * `{ socket }` to spread into postgres.js options: a fresh capped factory for one client. postgres.js documents the
 * option (README "Custom socket", options list `socket: fn`) but its 3.4.9 type definitions omit it, so it is
 * returned as a separate object, never as an object literal inside the options.
 */
export const cappedSocketOption = (
  connect: ConnectFn,
): { readonly socket: ReturnType<typeof cappedSocket> } => ({ socket: cappedSocket(connect) });
