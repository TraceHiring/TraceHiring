// DC-D7 (b): node-postgres `pg` with nodejs_compat. BEGIN ... ROLLBACK only.
import { Client } from 'pg';

export default {
  async fetch(_req: Request, env: { PG_URL: string }): Promise<Response> {
    const t0 = Date.now();
    const client = new Client({ connectionString: env.PG_URL, connectionTimeoutMillis: 10000 });
    try {
      await client.connect();
      await client.query('begin');
      const before = (await client.query('select current_user as cu, session_user as su')).rows[0];
      await client.query('set local role authenticated');
      const after = (await client.query('select current_user as cu, session_user as su')).rows[0];
      await client.query('rollback');
      const outside = (await client.query('select current_user as cu')).rows[0];
      return Response.json({
        driver: 'pg@8.23.0',
        ok: true,
        inTx: { before, after },
        afterRollback: outside,
        ms: Date.now() - t0,
      });
    } catch (e) {
      return Response.json(
        { driver: 'pg@8.23.0', ok: false, error: String(e), ms: Date.now() - t0 },
        { status: 500 },
      );
    } finally {
      await client.end().catch(() => {});
    }
  },
};
