// The capped postgres.js transport (ADR-031 amendment 1; @trace/workers-http/pg-socket) against the real local
// database: authentication, transactions with SET LOCAL ROLE (to Supabase's authenticated and anon, which the
// operator may set; the trace_* roles are reachable only from their own logins, MT-14) and a transaction-local
// setting, two of them on the same client, all over the one TCP connection the cap allows. Node stands in for workerd
// here (a Node socket in the cloudflare:sockets shape); e2e-local runs the same code in workerd. Nothing is written;
// no value is printed.
import { cappedSocketOption } from '@trace/workers-http/pg-socket';
import { nodeConnect } from '@trace/workers-http/pg-socket-node';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { operatorUrl } from './harness.js';

describe('the capped transport on the local database', () => {
  it('authenticates, runs two transactions with SET LOCAL ROLE, and uses one connection', async () => {
    let connects = 0;
    const sql = postgres(operatorUrl(), {
      ssl: false,
      fetch_types: false,
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 5,
      onnotice: () => {},
      ...cappedSocketOption((address) => {
        connects += 1;
        return nodeConnect(address);
      }),
    });
    try {
      for (const role of ['authenticated', 'anon'] as const) {
        const rows = await sql.begin(async (t) => {
          await t.unsafe(`set local role ${role}`);
          await t.unsafe("select set_config('trace.request_id', $1, true)", [
            '9b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e',
          ]);
          return t.unsafe("select current_user as who, current_setting('trace.request_id') as req");
        });
        expect(rows[0]).toEqual({ who: role, req: '9b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e' });
      }
      // Transaction-local: nothing survives the COMMIT.
      const after = await sql.unsafe(
        "select current_user as who, coalesce(current_setting('trace.request_id', true), '') as req",
      );
      expect(after[0]?.['who']).not.toBe('anon');
      expect(after[0]?.['req']).toBe('');
      expect(connects).toBe(1);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});
