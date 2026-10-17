// DemoOutboxDO (spec §4.2 Durable Objects, R-9): one per org (`idFromName(orgId)`), SQLite-backed. Reached only by
// services/api code over the DO RPC stub; it has no fetch route. Inputs are zod-checked again here.
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { OutboxStore, type OutboxEntry, type OutboxEntryInput } from './outbox-store.js';

const EntryInput = z.strictObject({
  kind: z.enum(['invite', 'otp']),
  candidateLabel: z.string().regex(/^Candidate [1-9][0-9]{0,8}$/),
  bodyText: z.string().min(1).max(5000),
  idempotencyKey: z.string().min(1).max(200),
});

export class DemoOutboxDO extends DurableObject<Env> {
  readonly #store: OutboxStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#store = new OutboxStore(ctx.storage.sql);
  }

  append(entry: OutboxEntryInput): void {
    const parsed = EntryInput.safeParse(entry);
    if (!parsed.success) throw new Error('bad_request');
    this.#store.append(parsed.data, crypto.randomUUID(), new Date().toISOString());
  }

  list(limit?: number): OutboxEntry[] {
    return this.#store.list(
      typeof limit === 'number' && Number.isInteger(limit) ? limit : undefined,
    );
  }
}
