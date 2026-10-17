// MediaLinkDO (spec §4.2 Durable Objects, §4.5, §6.2 R3-4, R3-7). SQLite-backed; reached only by services/api over
// the DO RPC stub (no fetch route). Inputs are zod-checked again here.
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { LinkStore, type LinkRecord } from './link-store.js';

const Record = z.strictObject({
  mediaId: z.uuid(),
  orgId: z.uuid(),
  viewerUserId: z.uuid(),
  aal: z.enum(['aal1', 'aal2']),
  amr: z.array(z.string().regex(/^[a-z_]{1,32}$/)).max(10),
  exp: z.int().min(0),
});
const Jti = z.uuid();
const Seconds = z.int().min(0);

export class MediaLinkDO extends DurableObject<Env> {
  readonly #store: LinkStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#store = new LinkStore(ctx.storage.sql);
  }

  issue(jti: string, record: LinkRecord): void {
    const r = Record.safeParse(record);
    if (!Jti.safeParse(jti).success || !r.success) throw new Error('bad_request');
    this.#store.issue(jti, r.data);
  }

  burn(jti: string, nowSec: number): LinkRecord | null {
    if (!Jti.safeParse(jti).success || !Seconds.safeParse(nowSec).success) return null;
    return this.#store.burn(jti, nowSec);
  }

  allowIssue(nowSec: number): boolean {
    if (!Seconds.safeParse(nowSec).success) return false;
    return this.#store.allowIssue(nowSec);
  }
}
