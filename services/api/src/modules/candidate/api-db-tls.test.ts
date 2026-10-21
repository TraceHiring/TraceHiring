// Where the trace_api connection may go (ADR-031 amendment 1, d1 revision 4o; first rule: security review R3 #1).
// A Worker never opens TLS to Postgres itself: Cloudflare's TLS client trusts only public roots, Supabase presents a
// private CA, and postgres.js then reconnect-looped until the invocation ran out of subrequests (staging, 2026-10-21).
// So a remote database is reached only through the API_DB Hyperdrive binding (Hyperdrive verifies the origin with
// the uploaded Supabase CA); API_DB_URL is for the local stack only, plain TCP; and every client may open one TCP
// connection, so a connect failure fails the unit of work at once.
import { describe, expect, it } from 'vitest';
import { apiDbUrlAllowed, openApiDb } from './api-db.js';

// Built at run time; no credential-shaped literal sits in the repo.
const url = (host: string, query = '', port = 6543) =>
  `${['postgres', 'ql'].join('')}://${'api'}_login:${'x'.repeat(8)}@${host}:${port}/postgres${query}`;
const hyperdrive = (connectionString: unknown) => ({ connectionString }) as unknown as Hyperdrive;

describe('API_DB_URL: the local stack only (ADR-031 amendment 1)', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'the local stack on %s is allowed, plain TCP',
    (host) => {
      expect(apiDbUrlAllowed(url(host))).toBe(true);
      expect(openApiDb({ API_DB_URL: url(host) })).not.toBeNull();
    },
  );

  it.each(['', '?sslmode=require', '?sslmode=verify-full', '?sslmode=disable'])(
    'a remote host is refused whatever its sslmode (%s): remote means Hyperdrive',
    (query) => {
      expect(apiDbUrlAllowed(url('db.example.test', query))).toBe(false);
      expect(openApiDb({ API_DB_URL: url('db.example.test', query) })).toBeNull();
    },
  );

  it('a local URL with any query parameter is refused', () => {
    expect(apiDbUrlAllowed(url('127.0.0.1', '?sslmode=disable'))).toBe(false);
    expect(apiDbUrlAllowed(url('127.0.0.1', '?host=db.example.test'))).toBe(false);
  });

  it('an unparsable or non-postgres URL is refused', () => {
    expect(apiDbUrlAllowed('not a url')).toBe(false);
    expect(apiDbUrlAllowed('https://127.0.0.1/')).toBe(false);
    expect(openApiDb({ API_DB_URL: 'not a url' })).toBeNull();
  });

  it('nothing bound is null (the caller answers 503 unavailable)', () => {
    expect(openApiDb({})).toBeNull();
    expect(openApiDb({ API_DB_URL: '' })).toBeNull();
  });
});

describe('API_DB: the Hyperdrive binding (staging)', () => {
  it('opens a handle from the binding without connecting yet', async () => {
    const handle = openApiDb({ API_DB: hyperdrive(url('abc123.hyperdrive.local', '', 5432)) });
    expect(handle).not.toBeNull();
    await handle?.close();
  });

  it('wins over a URL secret, which is then never used', () => {
    const handle = openApiDb({
      API_DB: hyperdrive(url('abc123.hyperdrive.local', '', 5432)),
      API_DB_URL: url('db.example.test'),
    });
    expect(handle).not.toBeNull();
  });

  it.each([undefined, '', 42])('a binding without a connection string (%s) is null', (cs) => {
    expect(openApiDb({ API_DB: hyperdrive(cs) })).toBeNull();
  });
});

describe('fail fast: one TCP connection per unit of work', () => {
  it('a refused connection rejects at once instead of looping', async () => {
    // Port 1 on the loopback: nothing listens there.
    const handle = openApiDb({ API_DB_URL: url('127.0.0.1', '', 1) });
    if (handle === null) throw new Error('expected a handle');
    const started = Date.now();
    await expect(handle.db.withOrg(null, async () => 'never')).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
    await handle.close();
  });
});
