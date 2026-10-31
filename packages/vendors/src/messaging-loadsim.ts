// LoadSimMessaging (specs/m2-scheduling-invites.md M2-1, §6.3, §6.4, R3-5; AT-M2-01): the "sandbox" email adapter
// for the 2,000-invite run. It never sends anything anywhere. dev and staging (CI runs as dev) only; recipients only
// under @example.test or @loadsim.test.
// - Latency: log-normal with p50 300 ms and p99 2 s by default (capped at 30 s).
// - Failures: 2 % transient (send() rejects with the retryable provider_unavailable) and 0.5 % permanent (accepted,
//   then a `bounced` event, the way SES reports a hard bounce) by default; both configurable; AT-M2-01 runs with
//   permanentFailureRate 0 (transient only).
// - Events: delivered / bounced, sent to the injected sink only after send() has resolved, on their own timer of at
//   least 1 s (R3-5: the consumer stores provider_message_id first). A sink failure is counted, never thrown.
// - Idempotent on the idempotency key: a repeat returns the first result, counts a duplicate and emits nothing new
//   (E17, AT-M2-01 duplicate-send count).
// - Clock, RNG, scheduler and id source are injected (deterministic tests); declares 50 msg/s (§6.3).
import {
  MessagingConfigError,
  MessagingSendError,
  assertNonProductionMessagingEnv,
  parseMessageV2,
} from './messaging-v2.js';
import type { ChannelMessaging, OutboundMessageV2, SendResultV2 } from './messaging-v2.js';

export const LOADSIM_SEND_RATE_PER_SECOND = 50;
export const LOADSIM_DEFAULTS = {
  transientFailureRate: 0.02,
  permanentFailureRate: 0.005,
  latencyP50Ms: 300,
  latencyP99Ms: 2000,
  eventDelayMinMs: 1000,
} as const;
/** No simulated latency is longer than this. */
export const LOADSIM_LATENCY_CAP_MS = 30_000;
/** The idempotency memory is bounded (oldest key forgotten first); far above a 2,000-message run. */
export const LOADSIM_IDEMPOTENCY_KEYS_MAX = 100_000;
/** Synthetic recipients only (RFC 2606 `.test`). */
export const LOADSIM_RECIPIENT_RE = /^[a-z0-9._+-]{1,64}@(?:example|loadsim)\.test$/;

export interface LoadSimDeliveryEvent {
  provider: 'loadsim';
  providerEventId: string;
  providerMessageId: string;
  orgId: string;
  outboundMessageId: string | null;
  event: 'delivered' | 'bounced';
  occurredAt: string;
}

/** Where delivery events go: the jobs wiring passes the same ingestion function the SES webhook uses (M2-1). */
export interface LoadSimEventSink {
  emit(event: LoadSimDeliveryEvent): void | Promise<void>;
}

export interface LoadSimScheduler {
  schedule(delayMs: number, fn: () => void): void;
}

export interface LoadSimOptions {
  sink: LoadSimEventSink;
  /** Uniform [0, 1). Default Math.random; tests pass seededRandom(seed). */
  random?: () => number;
  /** Epoch milliseconds, for event timestamps. Default Date.now. */
  now?: () => number;
  /**
   * Default setTimeout, for direct (test) construction only: createMessagingV2 requires it, because a Worker
   * cancels plain timers once the handler returns (the jobs wiring passes one backed by ctx.waitUntil; B1 fix 5).
   */
  scheduler?: LoadSimScheduler;
  /** Default crypto.randomUUID. */
  newId?: () => string;
  transientFailureRate?: number;
  permanentFailureRate?: number;
  latencyP50Ms?: number;
  latencyP99Ms?: number;
}

export interface LoadSimStats {
  accepted: number;
  duplicates: number;
  transientFailures: number;
  permanentFailures: number;
  eventsEmitted: number;
  sinkErrors: number;
}

/** mulberry32: a small seeded PRNG for deterministic runs (not for anything secret). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** z of the 99th percentile of the standard normal. */
const Z99 = 2.3263478740408408;

/** One log-normal latency sample with the given p50 and p99 (two uniform draws, Box–Muller), in [1, 30 000] ms. */
export function sampleLatencyMs(random: () => number, p50Ms: number, p99Ms: number): number {
  const sigma = Math.log(p99Ms / p50Ms) / Z99;
  const u1 = 1 - random(); // (0, 1]
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const ms = p50Ms * Math.exp(sigma * z);
  return Math.min(LOADSIM_LATENCY_CAP_MS, Math.max(1, Math.round(ms)));
}

const rate = (v: unknown, fallback: number): number => {
  const r = v === undefined ? fallback : v;
  if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r > 1) {
    throw new MessagingConfigError('bad_options');
  }
  return r;
};
const positiveMs = (v: unknown, fallback: number): number => {
  const r = v === undefined ? fallback : v;
  if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0 || r > LOADSIM_LATENCY_CAP_MS) {
    throw new MessagingConfigError('bad_options');
  }
  return r;
};
const fn = <T>(v: T | undefined, fallback: T): T => {
  const r = v === undefined ? fallback : v;
  if (typeof r !== 'function') throw new MessagingConfigError('bad_options');
  return r;
};

const defaultScheduler: LoadSimScheduler = {
  schedule: (delayMs, cb) => {
    setTimeout(cb, delayMs);
  },
};

export class LoadSimMessaging implements ChannelMessaging {
  readonly provider = 'loadsim' as const;
  readonly sendRatePerSecond = LOADSIM_SEND_RATE_PER_SECOND;
  readonly #env: 'dev' | 'staging';
  readonly #sink: LoadSimEventSink;
  readonly #random: () => number;
  readonly #now: () => number;
  readonly #schedule: (delayMs: number, cb: () => void) => void;
  readonly #newId: () => string;
  readonly #transient: number;
  readonly #permanent: number;
  readonly #p50: number;
  readonly #p99: number;
  readonly #byKey = new Map<string, Promise<SendResultV2>>();
  readonly #stats: LoadSimStats = {
    accepted: 0,
    duplicates: 0,
    transientFailures: 0,
    permanentFailures: 0,
    eventsEmitted: 0,
    sinkErrors: 0,
  };

  constructor(traceEnv: unknown, options: LoadSimOptions) {
    assertNonProductionMessagingEnv(traceEnv);
    if (typeof options !== 'object' || options === null)
      throw new MessagingConfigError('bad_options');
    const { sink } = options;
    if (typeof sink !== 'object' || sink === null || typeof sink.emit !== 'function') {
      throw new MessagingConfigError('bad_options');
    }
    this.#transient = rate(options.transientFailureRate, LOADSIM_DEFAULTS.transientFailureRate);
    this.#permanent = rate(options.permanentFailureRate, LOADSIM_DEFAULTS.permanentFailureRate);
    if (this.#transient + this.#permanent > 1) throw new MessagingConfigError('bad_options');
    this.#p50 = positiveMs(options.latencyP50Ms, LOADSIM_DEFAULTS.latencyP50Ms);
    this.#p99 = positiveMs(options.latencyP99Ms, LOADSIM_DEFAULTS.latencyP99Ms);
    if (this.#p99 < this.#p50) throw new MessagingConfigError('bad_options');
    const scheduler = options.scheduler ?? defaultScheduler;
    if (typeof scheduler !== 'object' || scheduler === null)
      throw new MessagingConfigError('bad_options');
    const schedule = fn(scheduler.schedule, defaultScheduler.schedule);
    this.#schedule = (d, cb) => schedule.call(scheduler, d, cb);
    this.#env = traceEnv;
    this.#sink = sink;
    this.#random = fn(options.random, Math.random);
    this.#now = fn(options.now, Date.now);
    this.#newId = fn(options.newId, () => crypto.randomUUID());
  }

  /** Counters for the AT-M2-01 record (duplicate sends expected 0). A copy. */
  stats(): LoadSimStats {
    return { ...this.#stats };
  }

  send(msg: OutboundMessageV2): Promise<SendResultV2> {
    try {
      assertNonProductionMessagingEnv(this.#env);
      const m = parseMessageV2(msg);
      if (m.channel !== 'email') throw new MessagingSendError('channel_refused');
      if (!LOADSIM_RECIPIENT_RE.test(m.to)) throw new MessagingSendError('bad_recipient');
      const key = JSON.stringify([m.orgId, m.idempotencyKey]);
      const existing = this.#byKey.get(key);
      if (existing !== undefined) {
        this.#stats.duplicates++;
        return existing;
      }
      const attempt = this.#attempt(m);
      if (this.#byKey.size >= LOADSIM_IDEMPOTENCY_KEYS_MAX) {
        const oldest = this.#byKey.keys().next();
        if (oldest.done !== true) this.#byKey.delete(oldest.value);
      }
      this.#byKey.set(key, attempt);
      // A transient failure frees the key, so the consumer's retry is a new attempt, not a duplicate.
      attempt.catch(() => this.#byKey.delete(key));
      return attempt;
    } catch (e) {
      return Promise.reject(
        e instanceof Error ? e : new MessagingSendError('provider_unavailable'),
      );
    }
  }

  async #attempt(m: OutboundMessageV2): Promise<SendResultV2> {
    const outcome = this.#random();
    const latency = sampleLatencyMs(this.#random, this.#p50, this.#p99);
    await new Promise<void>((resolve) => this.#schedule(latency, resolve));
    if (outcome < this.#transient) {
      this.#stats.transientFailures++;
      throw new MessagingSendError('provider_unavailable');
    }
    const bounced = outcome < this.#transient + this.#permanent;
    if (bounced) this.#stats.permanentFailures++;
    this.#stats.accepted++;
    const providerMessageId = `loadsim-${this.#newId()}`;
    const eventDelay = Math.max(
      LOADSIM_DEFAULTS.eventDelayMinMs,
      sampleLatencyMs(this.#random, this.#p50, this.#p99),
    );
    // Scheduled on its own timer (≥ 1 s): it fires after this send has resolved to its caller.
    this.#schedule(eventDelay, () => this.#emit(m, providerMessageId, bounced));
    return { provider: 'loadsim', providerMessageId, status: 'accepted' };
  }

  #emit(m: OutboundMessageV2, providerMessageId: string, bounced: boolean): void {
    const event: LoadSimDeliveryEvent = {
      provider: 'loadsim',
      providerEventId: `loadsim-event-${this.#newId()}`,
      providerMessageId,
      orgId: m.orgId,
      outboundMessageId: m.outboundMessageId ?? null,
      event: bounced ? 'bounced' : 'delivered',
      occurredAt: new Date(this.#now()).toISOString(),
    };
    const onError = () => {
      this.#stats.sinkErrors++;
    };
    try {
      const r = this.#sink.emit(event);
      this.#stats.eventsEmitted++;
      if (r instanceof Promise) r.catch(onError);
    } catch {
      onError();
    }
  }
}
