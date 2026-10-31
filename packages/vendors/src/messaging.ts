// Messaging (specs/d1-demo-slice.md §5.3, D1-1, D1-2, R-9, L-11): the interface invites and OTP codes are sent
// through, and its only D1 implementation, OutboxMessaging, which writes to a per-org demo outbox (DemoOutboxDO in
// services/api implements OutboxStore; InMemoryOutboxStore here serves tests and local dev).
// Production guard, fail closed: the mock runs only in 'dev' and 'staging'. createMessaging and the OutboxMessaging
// constructor (and every send) refuse any other environment value, 'production' included. Recipients must match the
// RFC 2606 pattern `^[a-z0-9._+-]{1,64}@example\.test$`, so no real person can receive a message.
// No error message ever contains an address, subject, body or code.

export type MessagingEnv = 'dev' | 'staging' | 'production';

export interface OutboundMessage {
  orgId: string;
  kind: 'invite' | 'otp';
  to: string;
  subject: string;
  bodyText: string;
  idempotencyKey: string;
}
export interface Messaging {
  send(msg: OutboundMessage): Promise<{ id: string; status: 'queued' }>;
}
/**
 * One outbox row. `append` receives the validated message; the store assigns `id` and `createdAt`, and `list`
 * returns them. The store is idempotent on `(orgId, idempotencyKey)`: the same key returns the same id.
 */
export interface OutboxEntry extends OutboundMessage {
  id?: string;
  createdAt?: string;
}
export interface OutboxStore {
  append(e: OutboxEntry): Promise<{ id: string; created: boolean }>;
  list(orgId: string, limit: number): Promise<OutboxEntry[]>;
}

/** The D1-1 recipient pattern (RFC 2606 reserved domain). Anchored, case-sensitive, no flags. */
export const DEMO_RECIPIENT_RE = /^[a-z0-9._+-]{1,64}@example\.test$/;

const ALLOWED_ENVS: readonly string[] = ['dev', 'staging'];
const MESSAGE_KEYS = ['orgId', 'kind', 'to', 'subject', 'bodyText', 'idempotencyKey'] as const;
const LIMITS = { orgId: 64, subject: 200, bodyText: 5000, idempotencyKey: 200, list: 100 } as const;
const PRINTABLE_LINE = /^[^\p{Cc}]+$/u;

export class MessagingMockInProductionError extends Error {
  constructor() {
    super('messaging: the demo-outbox mock runs only in dev and staging');
    this.name = 'MessagingMockInProductionError';
  }
}

export type MessagingInputErrorCode =
  | 'not_object'
  | 'unknown_key'
  | 'missing_key'
  | 'bad_org'
  | 'bad_kind'
  | 'bad_recipient'
  | 'bad_subject'
  | 'bad_body'
  | 'bad_idempotency_key'
  | 'bad_store'
  | 'bad_limit';

/** Names the failed check only; never a value. */
export class MessagingInputError extends Error {
  readonly code: MessagingInputErrorCode;
  constructor(code: MessagingInputErrorCode) {
    super(`messaging: ${code}`);
    this.name = 'MessagingInputError';
    this.code = code;
  }
}

function assertMockEnv(env: unknown): asserts env is 'dev' | 'staging' {
  if (typeof env !== 'string' || !ALLOWED_ENVS.includes(env)) {
    throw new MessagingMockInProductionError();
  }
}

const boundedLine = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= max &&
  PRINTABLE_LINE.test(value);

function parseMessage(raw: unknown): OutboundMessage {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new MessagingInputError('not_object');
  }
  const m = raw as Record<string, unknown>;
  for (const key of Object.keys(m)) {
    if (!(MESSAGE_KEYS as readonly string[]).includes(key))
      throw new MessagingInputError('unknown_key');
  }
  for (const key of MESSAGE_KEYS) {
    if (m[key] === undefined) throw new MessagingInputError('missing_key');
  }
  const { orgId, kind, to, subject, bodyText, idempotencyKey } = m;
  if (!boundedLine(orgId, LIMITS.orgId)) throw new MessagingInputError('bad_org');
  if (kind !== 'invite' && kind !== 'otp') throw new MessagingInputError('bad_kind');
  if (typeof to !== 'string' || !DEMO_RECIPIENT_RE.test(to)) {
    throw new MessagingInputError('bad_recipient');
  }
  if (!boundedLine(subject, LIMITS.subject)) throw new MessagingInputError('bad_subject');
  if (typeof bodyText !== 'string' || bodyText.length < 1 || bodyText.length > LIMITS.bodyText) {
    throw new MessagingInputError('bad_body');
  }
  if (!boundedLine(idempotencyKey, LIMITS.idempotencyKey)) {
    throw new MessagingInputError('bad_idempotency_key');
  }
  return { orgId, kind, to, subject, bodyText, idempotencyKey };
}

/** The D1 Messaging: validates, then appends to the demo outbox. Refuses to exist outside dev and staging. */
export class OutboxMessaging implements Messaging {
  readonly #env: 'dev' | 'staging';
  readonly #store: OutboxStore;

  constructor(env: MessagingEnv, store: OutboxStore) {
    assertMockEnv(env);
    if (
      typeof store !== 'object' ||
      store === null ||
      typeof store.append !== 'function' ||
      typeof store.list !== 'function'
    ) {
      throw new MessagingInputError('bad_store');
    }
    this.#env = env;
    this.#store = store;
  }

  async send(msg: OutboundMessage): Promise<{ id: string; status: 'queued' }> {
    assertMockEnv(this.#env);
    const parsed = parseMessage(msg);
    const { id } = await this.#store.append(parsed);
    return { id, status: 'queued' };
  }
}

/** The one factory callers use. `'production'` (or any value other than dev/staging) throws. */
export function createMessaging(env: MessagingEnv, store: OutboxStore): Messaging {
  assertMockEnv(env);
  return new OutboxMessaging(env, store);
}

/** In-memory OutboxStore for tests and local dev: per-org, idempotent on (orgId, idempotencyKey), newest first. */
export class InMemoryOutboxStore implements OutboxStore {
  readonly #entries: Required<OutboxEntry>[] = [];
  readonly #byKey = new Map<string, string>();
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(opts: { now?: () => Date; newId?: () => string } = {}) {
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? (() => crypto.randomUUID());
  }

  append(e: OutboxEntry): Promise<{ id: string; created: boolean }> {
    const key = JSON.stringify([e.orgId, e.idempotencyKey]);
    const existing = this.#byKey.get(key);
    if (existing !== undefined) return Promise.resolve({ id: existing, created: false });
    const id = this.#newId();
    this.#byKey.set(key, id);
    this.#entries.push({
      orgId: e.orgId,
      kind: e.kind,
      to: e.to,
      subject: e.subject,
      bodyText: e.bodyText,
      idempotencyKey: e.idempotencyKey,
      id,
      createdAt: this.#now().toISOString(),
    });
    return Promise.resolve({ id, created: true });
  }

  list(orgId: string, limit: number): Promise<OutboxEntry[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.list) {
      return Promise.reject(new MessagingInputError('bad_limit'));
    }
    const rows = this.#entries
      .filter((entry) => entry.orgId === orgId)
      .reverse()
      .slice(0, limit)
      .map((entry) => ({ ...entry }));
    return Promise.resolve(rows);
  }
}
