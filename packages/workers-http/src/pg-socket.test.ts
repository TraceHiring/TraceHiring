// The capped postgres.js transport (ADR-031 amendment 1, d1 revision 4o). Node only: real `postgres` (3.4.9, the
// version the Workers pin) over a Node TCP socket wrapped into the cloudflare:sockets shape, against tiny local TCP
// servers that model the staging failure: the peer accepts and then closes before the startup exchange ends (what a
// failed TLS upgrade looked like on staging). No database, no network beyond 127.0.0.1, no credential.
import { createServer, type Server } from 'node:net';
import postgres from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DB_CONNECT_REFUSED,
  cappedSocket,
  cappedSocketOption,
  localDbUrlAllowed,
  pgConnectionString,
  type ConnectFn,
  type RawSocket,
} from './pg-socket.js';
import { nodeConnect } from './pg-socket-node.js';

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

  // Database review Minor 3: the connection drops after BEGIN, inside the transaction. The unit of work must reject
  // quickly on its one connection, and COMMIT must never be sent, so nothing commits partially (the queue retries).
  // Known driver quirk, pinned here: after the drop, sql.begin's ROLLBACK is queued on the closed connection, and
  // postgres.js 3.4.9 (connection.js nextWrite, `socket` already null) throws an uncaught TypeError from a timer. The
  // unit of work has already rejected by then; on Workers this shows as an uncaught exception in the invocation log.
  it('a connection lost inside a transaction rejects within 2 s, on one connection, without a COMMIT', async () => {
    const { port, accepted, received } = await fakePostgresThatDiesAfterBegin();
    const saved = process.listeners('uncaughtException');
    const stray: unknown[] = [];
    process.removeAllListeners('uncaughtException');
    process.on('uncaughtException', (e) => stray.push(e));
    try {
      const sql = postgres(urlFor(port), { ...OPTIONS, ...cappedSocketOption(nodeConnect) });
      const started = Date.now();
      await expect(
        sql.begin(async (tx) => {
          await tx`select 1`;
        }),
      ).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(2_000);
      await new Promise((r) => setTimeout(r, 100));
      expect(accepted()).toBe(1);
      expect(received().toLowerCase()).toContain('begin');
      expect(received().toLowerCase()).not.toContain('commit');
      await sql.end({ timeout: 0 });
    } finally {
      process.removeAllListeners('uncaughtException');
      for (const l of saved) process.on('uncaughtException', l);
    }
    for (const e of stray) expect(String(e)).toMatch(/reading 'write'/);
  });
});

/**
 * A minimal Postgres wire peer: answers the startup with AuthenticationOk + ReadyForQuery, answers the simple-query
 * BEGIN with CommandComplete + ReadyForQuery (in transaction), then closes on the next message. Records every byte
 * the client sent (as latin1 text) and counts connections.
 */
const fakePostgresThatDiesAfterBegin = async (): Promise<{
  port: number;
  accepted: () => number;
  received: () => string;
}> => {
  let n = 0;
  let text = '';
  const msg = (type: string, body: Buffer) => {
    const head = Buffer.alloc(5);
    head.write(type, 0, 'latin1');
    head.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([head, body]);
  };
  const int32 = (v: number) => {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v);
    return b;
  };
  const server = createServer((c) => {
    n += 1;
    c.on('error', () => {});
    let buf = Buffer.alloc(0);
    let started = false;
    let afterBegin = false;
    c.on('data', (chunk: Buffer) => {
      text += chunk.toString('latin1');
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!started) {
          if (buf.length < 4) return;
          const len = buf.readInt32BE(0);
          if (buf.length < len) return;
          buf = buf.subarray(len);
          started = true;
          c.write(Buffer.concat([msg('R', int32(0)), msg('Z', Buffer.from('I'))]));
          continue;
        }
        if (buf.length < 5) return;
        const type = String.fromCharCode(buf[0] ?? 0);
        const len = buf.readInt32BE(1);
        if (buf.length < len + 1) return;
        const body = buf.subarray(5, len + 1).toString('latin1');
        buf = buf.subarray(len + 1);
        if (!afterBegin && type === 'Q' && body.toLowerCase().startsWith('begin')) {
          afterBegin = true;
          c.write(
            Buffer.concat([msg('C', Buffer.from('BEGIN\0', 'latin1')), msg('Z', Buffer.from('T'))]),
          );
          continue;
        }
        c.destroy();
        return;
      }
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { port: address.port, accepted: () => n, received: () => text };
};

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

  it('once fires once, removeListener and removeAllListeners detach (the calls postgres.js makes)', async () => {
    const f = fakeRaw();
    const socket = await cappedSocket(() => f.raw)(OPTS);
    const seen: string[] = [];
    const kept = () => seen.push('kept');
    const dropped = () => seen.push('dropped');
    socket.once('data', () => seen.push('once'));
    socket.on('data', kept);
    socket.on('data', dropped);
    socket.removeListener('data', dropped);
    f.push(new Uint8Array([1]));
    f.push(new Uint8Array([2]));
    await tick();
    expect(seen).toEqual(['once', 'kept', 'kept']);
    socket.removeAllListeners('data');
    socket.on('close', () => seen.push('close'));
    socket.removeAllListeners();
    f.push(new Uint8Array([3]));
    f.peerEnds();
    await tick();
    expect(seen).toEqual(['once', 'kept', 'kept']);
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

describe('pgConnectionString: Hyperdrive for remote databases, a URL only for the local stack', () => {
  const cs = (host: string, query = '') =>
    `${['postgres', 'ql'].join('')}://${'login'}:${'x'.repeat(8)}@${host}:5432/postgres${query}`;

  it('takes the binding when it is bound, and ignores the URL then', () => {
    const binding = { connectionString: cs('abc.hyperdrive.local') };
    expect(pgConnectionString(binding, cs('db.example.test'))).toBe(cs('abc.hyperdrive.local'));
    expect(pgConnectionString(binding, undefined)).toBe(cs('abc.hyperdrive.local'));
  });

  it.each([undefined, '', 7, null])(
    'a bound binding without a string (%s) is null, never the URL',
    (v) => {
      expect(pgConnectionString({ connectionString: v }, cs('127.0.0.1'))).toBeNull();
    },
  );

  it.each(['127.0.0.1', 'localhost', 'LOCALHOST'])('a URL on %s is allowed', (host) => {
    expect(localDbUrlAllowed(cs(host))).toBe(true);
    expect(pgConnectionString(undefined, cs(host))).toBe(cs(host));
  });

  it('[::1] is refused: postgres.js splits the host on ":" and could never reach it (security review I-1)', () => {
    expect(localDbUrlAllowed(cs('[::1]'))).toBe(false);
  });

  // Security review L-1: the WHATWG parser takes the host after the LAST "@", postgres.js 3.4.9 parseUrl takes
  // everything after the FIRST "@" and splits it on "," into hosts, and the capped transport dials host[0].
  const scheme = ['postgres', 'ql'].join('');
  const pw = 'x'.repeat(8);
  it.each([
    [
      'a second "@" hides a remote first host',
      `${scheme}://u:${pw}@db.example.test:5432,x@127.0.0.1/postgres`,
    ],
    ['an empty second host after ","', `${scheme}://u@db.example.test,@127.0.0.1/postgres`],
    ['two local hosts', `${scheme}://u:${pw}@127.0.0.1:5432,127.0.0.1:5433/postgres`],
    ['a "," in the host', `${scheme}://u:${pw}@127.0.0.1,localhost/postgres`],
  ])('a multi-host or multi-"@" authority is refused (%s)', (_name, u) => {
    expect(localDbUrlAllowed(u)).toBe(false);
    expect(pgConnectionString(undefined, u)).toBeNull();
  });

  it.each(['127.0.0.1', 'localhost'])(
    'for an allowed URL on %s, the host postgres.js dials is that loopback host',
    async (host) => {
      const u = cs(host);
      expect(localDbUrlAllowed(u)).toBe(true);
      const dialled: string[] = [];
      const connect: ConnectFn = ({ hostname }) => {
        dialled.push(hostname);
        throw new Error('no network in this test');
      };
      const sql = postgres(u, { ...OPTIONS, ...cappedSocketOption(connect) });
      await sql`select 1`.catch(() => undefined);
      await sql.end({ timeout: 0 });
      expect(dialled).toEqual([host.toLowerCase()]);
    },
  );

  it.each([
    'db.example.test',
    '10.0.0.1',
    '127.0.0.1.example.test',
    'aws-0-ap-south-1.pooler.supabase.com',
  ])('a URL on %s is refused (remote means Hyperdrive)', (host) => {
    expect(localDbUrlAllowed(cs(host))).toBe(false);
    expect(pgConnectionString(undefined, cs(host))).toBeNull();
  });

  it.each(['?sslmode=require', '?sslmode=disable', '?host=db.example.test', '#x'])(
    'a local URL with a query or fragment (%s) is refused',
    (q) => {
      expect(localDbUrlAllowed(cs('127.0.0.1', q))).toBe(false);
    },
  );

  it('an unparsable, non-postgres or empty URL is refused', () => {
    expect(localDbUrlAllowed('not a url')).toBe(false);
    expect(localDbUrlAllowed('https://127.0.0.1/')).toBe(false);
    expect(pgConnectionString(undefined, '')).toBeNull();
    expect(pgConnectionString(undefined, undefined)).toBeNull();
  });
});
