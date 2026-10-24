// Spike jobs Worker: queue consumer (max_retries 5 + DLQ) and a DLQ consumer. Events go to a SQLite DO.
import { DurableObject } from 'cloudflare:workers';

export class StatsDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.ctx.storage.sql.exec(
      'create table if not exists ev (n integer primary key autoincrement, line text)',
    );
  }
  async add(line: string) {
    this.ctx.storage.sql.exec('insert into ev (line) values (?)', line);
  }
  async list() {
    return this.ctx.storage.sql
      .exec('select line from ev order by n')
      .toArray()
      .map((r) => r.line as string);
  }
}

interface Env {
  STATS: DurableObjectNamespace<StatsDO>;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname === '/stats') {
      const lines = await env.STATS.get(env.STATS.idFromName('x')).list();
      return new Response(JSON.stringify(lines), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  },
  async queue(batch: MessageBatch<{ id: string; fail: boolean }>, env: Env) {
    const stats = env.STATS.get(env.STATS.idFromName('x'));
    for (const msg of batch.messages) {
      if (batch.queue === 'd1-spike-dlq') {
        await stats.add(`DLQ received id=${msg.body.id} (queue=${batch.queue})`);
        msg.ack();
        continue;
      }
      await stats.add(`main attempt=${msg.attempts} id=${msg.body.id} fail=${msg.body.fail}`);
      if (msg.body.fail) msg.retry();
      else msg.ack();
    }
  },
};
