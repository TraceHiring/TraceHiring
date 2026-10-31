// MediaLinkDO (spec §4.2 Durable Objects, §4.5, §6.2 R3-4, R3-7). SQLite-backed; reached only by services/api over
// the DO RPC stub (no fetch route). Inputs are zod-checked again here, by the exported `linkGuard` functions (tested
// on a fake of the SQLite surface; the test pool has no MEDIA_LINKS binding).
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { LinkStore, type LinkRecord } from './link-store.js';

const RecordSchema = z.strictObject({
  mediaId: z.uuid(),
  orgId: z.uuid(),
  viewerUserId: z.uuid(),
  aal: z.enum(['aal1', 'aal2']),
  // Verbatim from the verified JWT (R3-1); the claim parser caps the list at 20 and the token at 8 KiB.
  amr: z.array(z.string().max(8192)).max(20),
  exp: z.int().min(0),
});
const Jti = z.uuid();
const Seconds = z.int().min(0);

/** The checked DO methods over one LinkStore. */
export const linkGuard = (store: LinkStore) => ({
  issue(jti: string, record: LinkRecord): void {
    const r = RecordSchema.safeParse(record);
    if (!Jti.safeParse(jti).success || !r.success) throw new Error('bad_request');
    store.issue(jti, r.data);
  },
  burn(jti: string, nowSec: number): LinkRecord | null {
    if (!Jti.safeParse(jti).success || !Seconds.safeParse(nowSec).success) return null;
    return store.burn(jti, nowSec);
  },
  allowIssue(nowSec: number): boolean {
    if (!Seconds.safeParse(nowSec).success) return false;
    return store.allowIssue(nowSec);
  },
});

export class MediaLinkDO extends DurableObject<Env> {
  readonly #guard: ReturnType<typeof linkGuard>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#guard = linkGuard(new LinkStore(ctx.storage.sql));
  }

  issue(jti: string, record: LinkRecord): void {
    this.#guard.issue(jti, record);
  }

  burn(jti: string, nowSec: number): LinkRecord | null {
    return this.#guard.burn(jti, nowSec);
  }

  allowIssue(nowSec: number): boolean {
    return this.#guard.allowIssue(nowSec);
  }
}
