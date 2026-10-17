// The Messaging mock's write path (spec D1-2, L-11, AT-D18 api half): the demo outbox only, never a real address,
// never production. TRACE_ENV must be set and not `production`, DEMO_OUTBOX must be '1' and the OUTBOX binding must
// exist; otherwise there is no writer and the caller answers 503 `unavailable` (fail closed). The recipient is checked
// against the D1-1 pattern and then dropped: the outbox stores no address.
// TODO(lead): when @trace/vendors ships `Messaging` (stream R1), wrap this writer as its mock implementation.
import type { OutboxEntry, OutboxEntryInput, OutboxKind } from './outbox-store.js';

export const DEMO_CONTACT = /^[a-z0-9._+-]{1,64}@example\.test$/;

export interface OutboxMessage {
  kind: OutboxKind;
  /** Checked against DEMO_CONTACT, never stored. */
  to: string;
  candidateLabel: string;
  bodyText: string;
  idempotencyKey: string;
}

export interface OutboxWriter {
  write(orgId: string, message: OutboxMessage): Promise<void>;
}

export interface OutboxReader {
  list(orgId: string): Promise<OutboxEntry[]>;
}

/** The DO RPC surface the writer uses (DemoOutboxDO implements it). */
interface OutboxStub {
  append(entry: OutboxEntryInput): Promise<void> | void;
  list(limit?: number): Promise<OutboxEntry[]> | OutboxEntry[];
}
export interface OutboxNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): OutboxStub;
}

export interface OutboxEnv {
  TRACE_ENV?: string | undefined;
  DEMO_OUTBOX?: string | undefined;
}

/** True only on a named non-production environment with the demo outbox switched on. */
export const demoOutboxEnabled = (env: OutboxEnv): boolean =>
  typeof env.TRACE_ENV === 'string' &&
  env.TRACE_ENV !== '' &&
  env.TRACE_ENV !== 'production' &&
  env.DEMO_OUTBOX === '1';

export const createDemoOutbox = (
  env: OutboxEnv,
  namespace: OutboxNamespace | undefined,
): (OutboxWriter & OutboxReader) | null => {
  if (!demoOutboxEnabled(env) || namespace === undefined) return null;
  const stub = (orgId: string) => namespace.get(namespace.idFromName(orgId));
  return {
    async write(orgId, message) {
      if (!DEMO_CONTACT.test(message.to)) throw new Error('outbox_recipient_refused');
      await stub(orgId).append({
        kind: message.kind,
        candidateLabel: message.candidateLabel,
        bodyText: message.bodyText,
        idempotencyKey: message.idempotencyKey,
      });
    },
    async list(orgId) {
      return await stub(orgId).list();
    },
  };
};

/**
 * The OUTBOX binding as the writer's structural type. The generated Env types the namespace with the class that
 * src/index.ts exports, which is the Wave 0 stub until the lead re-exports DemoOutboxDO from this module.
 */
export const outboxNamespace = (env: { OUTBOX?: unknown }): OutboxNamespace | undefined =>
  env.OUTBOX === undefined ? undefined : (env.OUTBOX as OutboxNamespace);
