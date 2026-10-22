// DC-D7 (a): porsager `postgres` over Workers TCP sockets. Everything runs inside one transaction that is
// rolled back (a sentinel throw makes sql.begin issue ROLLBACK).
import postgres from 'postgres';

class RollbackSentinel extends Error {}

export default {
  async fetch(_req: Request, env: { PG_URL: string }): Promise<Response> {
    const t0 = Date.now();
    const sql = postgres(env.PG_URL, {
      max: 1,
      fetch_types: false,
      ssl: false,
      connect_timeout: 10,
    });
    try {
      let inTx: unknown;
      try {
        await sql.begin(async (tx) => {
          const [before] = await tx`select current_user as cu, session_user as su`;
          await tx`set local role authenticated`;
          const [after] = await tx`select current_user as cu, session_user as su`;
          inTx = { before, after };
          throw new RollbackSentinel('rollback on purpose');
        });
      } catch (e) {
        if (!(e instanceof RollbackSentinel)) throw e;
      }
      const [outside] = await sql`select current_user as cu`;
      return Response.json({
        driver: 'postgres@3.4.9',
        ok: true,
        inTx,
        afterRollback: outside,
        ms: Date.now() - t0,
      });
    } catch (e) {
      return Response.json(
        { driver: 'postgres@3.4.9', ok: false, error: String(e), ms: Date.now() - t0 },
        { status: 500 },
      );
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  },
};
