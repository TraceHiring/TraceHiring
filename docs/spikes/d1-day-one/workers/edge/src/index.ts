// Spike edge Worker: SQLite-backed DO + alarm, Queue producer, RPC client, cron handler, DC-D4 verify.
import { DurableObject } from 'cloudflare:workers';
import { verifyEs256Jwt } from '../../../src/crypto-checks.ts';

export class SessionDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.ctx.storage.sql.exec('create table if not exists kv (k text primary key, v text)');
  }
  private put(k: string, v: string) {
    this.ctx.storage.sql.exec('insert or replace into kv (k, v) values (?, ?)', k, v);
  }
  private all() {
    return Object.fromEntries(
      this.ctx.storage.sql
        .exec('select k, v from kv')
        .toArray()
        .map((r) => [r.k as string, r.v as string]),
    );
  }
  async set(value: string, alarmInMs: number) {
    this.put('value', value);
    this.put('storage_kind', 'sqlite');
    await this.ctx.storage.setAlarm(Date.now() + alarmInMs);
    return this.all();
  }
  async alarm() {
    this.put('alarm_fired_at', new Date().toISOString());
  }
  async cronTick() {
    const n = Number(this.all()['cron_count'] ?? '0') + 1;
    this.put('cron_count', String(n));
  }
  async dump() {
    return this.all();
  }
}

interface Env {
  SESSION: DurableObjectNamespace<SessionDO>;
  MAIN_QUEUE: { send(body: unknown): Promise<void> };
  API: {
    ping(who: string): Promise<string>;
    whoami(): Promise<{ service: string; entrypoint: string }>;
  };
  API_HTTP: { fetch(input: string | Request): Promise<Response> };
  JOBS: { fetch(input: string | Request): Promise<Response> };
}

const json = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const stub = env.SESSION.get(env.SESSION.idFromName('s1'));
    switch (url.pathname) {
      case '/health':
        return json({ ok: true });
      // DC-D2: DO storage + alarm
      case '/d2/do/set':
        return json(await stub.set('hello', 500));
      case '/d2/do/dump':
        return json(await stub.dump());
      // DC-D2: producer
      case '/d2/enqueue': {
        const fail = url.searchParams.get('fail') === '1';
        await env.MAIN_QUEUE.send({ id: url.searchParams.get('id') ?? 'm1', fail });
        return json({ enqueued: true, fail });
      }
      case '/d2/jobs-stats':
        return env.JOBS.fetch('http://jobs/stats');
      // DC-D3: RPC over a WorkerEntrypoint binding
      case '/d3/rpc':
        return json({ ping: await env.API.ping('edge'), whoami: await env.API.whoami() });
      // DC-D3: the same method names over plain HTTP against the api worker
      case '/d3/http-probe': {
        const probes: Record<string, unknown> = {};
        for (const p of ['/ping', '/whoami', '/CandidateRpc/ping', '/health']) {
          const r = await env.API_HTTP.fetch(`http://api${p}`);
          probes[p] = { status: r.status, body: (await r.text()).slice(0, 80) };
        }
        return json(probes);
      }
      // DC-D4 cross-runtime: a Node-signed JWT verified in workerd with the public JWK.
      case '/d4/verify': {
        const { jwt, publicJwk } = (await req.json()) as { jwt: string; publicJwk: JsonWebKey };
        return json({ verified: await verifyEs256Jwt(publicJwk, jwt) });
      }
      default:
        return json({ error: 'not found' }, 404);
    }
  },
  // DC-D2: cron. Triggered locally via /cdn-cgi/handler/scheduled with --test-scheduled.
  async scheduled(_event: unknown, env: Env) {
    await env.SESSION.get(env.SESSION.idFromName('s1')).cronTick();
    console.log('SCHEDULED handler fired');
  },
};
