// The capped postgres.js transport (ADR-031 amendment 1; @trace/workers-http/pg-socket) against the real local
// database: authentication, transactions with SET LOCAL ROLE (to Supabase's authenticated and anon, which the
// operator may set; the trace_* roles are reachable only from their own logins, MT-14) and a transaction-local
// setting, two of them on the same client, all over the one TCP connection the cap allows. Node stands in for workerd
// here (a Node socket in the cloudflare:sockets shape); e2e-local runs the same code in workerd. Nothing is written;
// no value is printed.
import { cappedSocketOption, type ConnectFn } from '@trace/workers-http/pg-socket';
import { nodeConnect } from '@trace/workers-http/pg-socket-node';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withStageConnection } from '../src/queue/stage-db.js';
import { newId, openHarness, operatorUrl, type Harness } from './harness.js';

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
      expect(after[0]?.['who']).toBe('postgres');
      expect(after[0]?.['req']).toBe('');
      expect(connects).toBe(1);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});

// Database review Minor 2: the production path itself (withStageConnection: its driver options, the capped
// transport, SET LOCAL ROLE and the org binding) on a real `with inherit false, set true` login, not a copy of it.
describe('withStageConnection on a real stage login', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await openHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  const counting = () => {
    const seen = { connects: 0 };
    const connect: ConnectFn = (address) => {
      seen.connects += 1;
      return nodeConnect(address);
    };
    return { seen, connect };
  };
  const envFor = (url: string) => ({ JOBS_QUALITY_DB_URL: url }) as unknown as Env;

  it('runs the quality stage as trace_quality_worker with its org bound, on one connection', async () => {
    const org = newId();
    const { seen, connect } = counting();
    const rows = await withStageConnection(
      envFor(h.loginUrl('trace_quality_worker')),
      'quality',
      org,
      (tx) =>
        tx.query<{ who: string; org: string }>(
          "select current_user as who, current_setting('trace.job_org_id') as org",
        ),
      connect,
    );
    expect(rows[0]).toEqual({ who: 'trace_quality_worker', org });
    expect(seen.connects).toBe(1);
  });

  it('cannot cross the rule 1 wall: the quality login may not become trace_integrity_worker (42501)', async () => {
    const { seen, connect } = counting();
    await expect(
      withStageConnection(
        envFor(h.loginUrl('trace_quality_worker')),
        'quality',
        newId(),
        (tx) => tx.query('set local role trace_integrity_worker'),
        connect,
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(seen.connects).toBe(1);
  });
});
