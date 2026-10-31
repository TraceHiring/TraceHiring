// The Messaging mock's write path (spec D1-2, L-11, §5.3, AT-D18 api half): the demo outbox only, never a real
// address, never production. Every send goes through `createMessaging(env.TRACE_ENV, …)` from @trace/vendors, which
// runs only for TRACE_ENV `dev` or `staging` (a missing or empty TRACE_ENV is treated as production and refused).
// On top of that, DEMO_OUTBOX must be '1' and the OUTBOX binding must exist; otherwise there is no writer and the
// caller answers 503 `unavailable` (fail closed). The recipient is checked against the D1-1 pattern (here and again
// in the vendors mock) and then dropped: the outbox stores no address and no subject.
import {
  createMessaging,
  type MessagingEnv,
  type OutboundMessage,
  type OutboxStore as VendorOutboxStore,
} from '@trace/vendors';
import type { AppendResult, OutboxEntry, OutboxEntryInput, OutboxKind } from './outbox-store.js';

export const DEMO_CONTACT = /^[a-z0-9._+-]{1,64}@example\.test$/;

/** Fixed subjects per kind (the vendors contract needs one; the outbox does not store it). */
export const OUTBOX_SUBJECTS: Readonly<Record<OutboxKind, string>> = {
  invite: 'Your Trace assessment invitation',
  otp: 'Your Trace sign-in code',
};

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
  append(entry: OutboxEntryInput): Promise<AppendResult | void> | AppendResult | void;
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

const MOCK_ENVS: readonly string[] = ['dev', 'staging'];

/** True only on `dev` or `staging` (the environments the vendors mock accepts) with the demo outbox switched on. */
export const demoOutboxEnabled = (env: OutboxEnv): boolean =>
  typeof env.TRACE_ENV === 'string' && MOCK_ENVS.includes(env.TRACE_ENV) && env.DEMO_OUTBOX === '1';

/**
 * The vendors OutboxStore over one org's DemoOutboxDO, for one message (the DO keeps the candidate label, which the
 * vendors message does not carry). `list` is not part of the send path; the demo-outbox route reads the DO directly.
 */
const doStore = (stub: OutboxStub, candidateLabel: string): VendorOutboxStore => ({
  async append(e) {
    // The vendors entry kind now names the four M2 purposes (B1); this D1 store and its list contract hold `invite`
    // and `otp` only until stream B2 widens both (build-notes "B1 first reviews" a). Anything else fails closed.
    if (e.kind !== 'invite' && e.kind !== 'otp') throw new Error('outbox_kind_unsupported');
    const out = await stub.append({
      kind: e.kind,
      candidateLabel,
      bodyText: e.bodyText,
      idempotencyKey: e.idempotencyKey,
    });
    if (out === undefined || out === null) throw new Error('outbox_append_failed');
    return out;
  },
  list: () => Promise.reject(new Error('outbox_list_not_on_send_path')),
});

export const createDemoOutbox = (
  env: OutboxEnv,
  namespace: OutboxNamespace | undefined,
): (OutboxWriter & OutboxReader) | null => {
  if (!demoOutboxEnabled(env) || namespace === undefined) return null;
  const traceEnv = env.TRACE_ENV as MessagingEnv;
  const stub = (orgId: string) => namespace.get(namespace.idFromName(orgId));
  return {
    async write(orgId, message) {
      if (!DEMO_CONTACT.test(message.to)) throw new Error('outbox_recipient_refused');
      const outbound: OutboundMessage = {
        orgId,
        kind: message.kind,
        to: message.to,
        subject: OUTBOX_SUBJECTS[message.kind],
        bodyText: message.bodyText,
        idempotencyKey: message.idempotencyKey,
      };
      // createMessaging re-checks the environment on every send (production or a missing TRACE_ENV throws).
      await createMessaging(traceEnv, doStore(stub(orgId), message.candidateLabel)).send(outbound);
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
