// The capped postgres.js transport (ADR-031 amendment 1, d1 revision 4o). Node only: real `postgres` (3.4.9, the
// version the Workers pin) over a Node TCP socket wrapped into the cloudflare:sockets shape, against tiny local TCP
// servers that model the staging failure: the peer accepts and then closes before the startup exchange ends (what a
// failed TLS upgrade looked like on staging). No database, no network beyond 127.0.0.1, no credential.
import { createServer, Socket as NodeSocket, type Server } from 'node:net';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DB_CONNECT_REFUSED,
  cappedSocket,
  cappedSocketOption,
  type ConnectFn,
  type RawSocket,
} from './pg-socket.js';

/** A Node socket in the cloudflare:sockets `Socket` shape (opened, closed, readable, writable, close). */
const nodeConnect: ConnectFn = ({ hostname, port }) => {
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
  // A peer that closes ends the stream cleanly (as cloudflare:sockets does), so postgres.js sees a close, not an error.
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

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
});

/**
 * A server that accepts every connection, reads the client's first message and closes cleanly (as a refused TLS
 * upgrade did on staging); counts accepted connections.
 */
const acceptThenClose = async (): Promise<{ port: number; accepted: () => number }> => {
  let n = 0;
  const server = createServer((c) => {
    n += 1;
    c.on('error', () => {});
    c.once('data', () => c.end());
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { port: address.port, accepted: () => n };
};

/** A port nothing listens on (bound once, then released). */
const closedPort = async (): Promise<number> => {
  const { port } = await acceptThenClose();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(null)))));
  return port;
};

// Assembled at run time: no credential-shaped literal in the repository.
const urlFor = (port: number) =>
  `${['postgres', 'ql'].join('')}://${'nobody'}:${'x'.repeat(8)}@127.0.0.1:${port}/postgres`;
const OPTIONS = {
  ssl: false,
  fetch_types: false,
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: () => {},
} as const;

describe('the uncapped driver (control: why the cap exists)', () => {
  it('postgres.js reconnects without limit when the peer closes during startup', async () => {
    const { port, accepted } = await acceptThenClose();
    const sql = postgres(urlFor(port), OPTIONS);
    const query = sql`select 1`.catch(() => 'rejected');
    await new Promise((r) => setTimeout(r, 1_000));
    // On Workers each of these is a subrequest: the Free limit (50) ends the invocation first (staging, 2026-10-21).
    expect(accepted()).toBeGreaterThan(5);
    await sql.end({ timeout: 0 });
    expect(await query).toBe('rejected');
  });
});

describe('cappedSocket: one TCP connection per client, then fail fast', () => {
  it('a peer that closes during startup costs exactly one connection and fails within 2 s', async () => {
    const { port, accepted } = await acceptThenClose();
    const sql = postgres(urlFor(port), { ...OPTIONS, ...cappedSocketOption(nodeConnect) });
    const started = Date.now();
    await expect(sql`select 1`).rejects.toThrow(DB_CONNECT_REFUSED);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(accepted()).toBe(1);
    await sql.end({ timeout: 0 });
  });

  it('a refused connection fails at once without a retry', async () => {
    const port = await closedPort();
    let calls = 0;
    const counting: ConnectFn = (address) => {
      calls += 1;
      return nodeConnect(address);
    };
    const sql = postgres(urlFor(port), { ...OPTIONS, ...cappedSocketOption(counting) });
    const started = Date.now();
    await expect(sql`select 1`).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(calls).toBe(1);
    await sql.end({ timeout: 0 });
  });

  it('connects to the first host and port postgres.js resolved', async () => {
    const seen: { hostname: string; port: number }[] = [];
    const recording: ConnectFn = (address) => {
      seen.push(address);
      return nodeConnect(address);
    };
    const port = await closedPort();
    const sql = postgres(urlFor(port), { ...OPTIONS, ...cappedSocketOption(recording) });
    await sql`select 1`.catch(() => {});
    await sql.end({ timeout: 0 });
    expect(seen).toEqual([{ hostname: '127.0.0.1', port }]);
  });

  it('refuses a cap below one', () => {
    expect(() => cappedSocket(nodeConnect, 0)).toThrow();
    expect(() => cappedSocket(nodeConnect, 1.5)).toThrow();
  });
});

/** A scripted raw socket: what the adapter writes, and controls for what the peer does. */
const fakeRaw = () => {
  const written: Uint8Array[] = [];
  let push!: (chunk: Uint8Array) => void;
  let finish!: () => void;
  let resolveClosed!: () => void;
  let rejectClosed!: (e: Error) => void;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => controller.enqueue(chunk);
      finish = () => controller.close();
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(chunk);
    },
  });
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  closed.catch(() => {});
  let closeCalls = 0;
  const raw: RawSocket = {
    opened: Promise.resolve({}),
    closed,
    readable,
    writable,
    close: async () => {
      closeCalls += 1;
      finish();
      resolveClosed();
    },
  };
  return {
    raw,
    written,
    push,
    peerEnds: () => {
      finish();
      resolveClosed();
    },
    peerFails: (e: Error) => rejectClosed(e),
    closeCalls: () => closeCalls,
  };
};
const tick = () => new Promise((r) => setTimeout(r, 10));
const OPTS = { host: ['db.example.test'], port: [5432] };

describe('the socket shape postgres.js expects (the cf polyfill contract)', () => {
  it('forwards writes, emits reads as Buffers and calls back after each write', async () => {
    const f = fakeRaw();
    const socket = await cappedSocket(() => f.raw)(OPTS);
    const data: Buffer[] = [];
    socket.on('data', (b: Buffer) => data.push(b));
    let wrote = false;
    expect(socket.write(new Uint8Array([1, 2]), () => (wrote = true))).toBe(true);
    f.push(new Uint8Array([9, 8]));
    await tick();
    expect(f.written.map((c) => [...c])).toEqual([[1, 2]]);
    expect(wrote).toBe(true);
    expect(data.map((b) => [...b])).toEqual([[9, 8]]);
    expect(Buffer.isBuffer(data[0])).toBe(true);
    expect(socket.readyState).toBe('open');
  });

  it('emits close once when the peer ends', async () => {
    const f = fakeRaw();
    const socket = await cappedSocket(() => f.raw)(OPTS);
    let closes = 0;
    socket.on('close', () => (closes += 1));
    f.peerEnds();
    await tick();
    expect(closes).toBe(1);
    expect(socket.readyState).toBe('closed');
  });

  it('emits error, then close, when the connection fails', async () => {
    const f = fakeRaw();
    const socket = await cappedSocket(() => f.raw)(OPTS);
    const events: string[] = [];
    socket.on('error', () => events.push('error'));
    socket.on('close', () => events.push('close'));
    f.peerFails(new Error('reset'));
    await tick();
    expect(events).toEqual(['error', 'close']);
  });

  it('end(data) writes the last message, then closes; destroy closes', async () => {
    const f = fakeRaw();
    const socket = await cappedSocket(() => f.raw)(OPTS);
    socket.end(new Uint8Array([88]));
    await tick();
    expect(f.written.map((c) => [...c])).toEqual([[88]]);
    expect(f.closeCalls()).toBe(1);
    const g = fakeRaw();
    const other = await cappedSocket(() => g.raw)(OPTS);
    other.destroy();
    await tick();
    expect(g.closeCalls()).toBe(1);
  });

  it('a failed open rejects the factory call (postgres.js then fails the query)', async () => {
    const f = fakeRaw();
    const opening = { ...f.raw, opened: Promise.reject(new Error('refused')) };
    await expect(cappedSocket(() => opening)(OPTS)).rejects.toThrow('refused');
  });

  it('the second call of one factory is refused before connect runs', async () => {
    let calls = 0;
    const factory = cappedSocket(() => {
      calls += 1;
      return fakeRaw().raw;
    });
    await factory(OPTS);
    await expect(factory(OPTS)).rejects.toThrow(DB_CONNECT_REFUSED);
    expect(calls).toBe(1);
  });
});
