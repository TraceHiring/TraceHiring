// LoadSimMessaging (specs/m2-scheduling-invites.md M2-1, §6.4, R3-5; AT-M2-01 runs it with transient failures only):
// never sends; synthetic recipients only; realistic latency (p50 300 ms, p99 2 s) and injected failures (2 % transient,
// 0.5 % permanent by default) from an injected RNG; delivery events go to an injected sink only after send() resolved.
// Clock, RNG and scheduler are injected, so every number here is deterministic. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  LOADSIM_SEND_RATE_PER_SECOND,
  LoadSimMessaging,
  sampleLatencyMs,
  seededRandom,
} from './messaging-loadsim.js';
import type { LoadSimDeliveryEvent, LoadSimOptions } from './messaging-loadsim.js';
import { MessagingConfigError, MessagingSendError } from './messaging-v2.js';
import type { OutboundMessageV2 } from './messaging-v2.js';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const NOW = Date.UTC(2026, 9, 31, 12, 0, 0);

/** A manual scheduler: timers run only when the test advances time. */
class ManualScheduler {
  now = NOW;
  readonly delays: number[] = [];
  #timers: { at: number; fn: () => void; seq: number }[] = [];
  #seq = 0;
  schedule = (delayMs: number, fn: () => void): void => {
    this.delays.push(delayMs);
    this.#timers.push({ at: this.now + delayMs, fn, seq: this.#seq++ });
  };
  /** Runs every timer due by `now + ms`, in time order, letting promise reactions settle between them. */
  async advance(ms: number): Promise<void> {
    const until = this.now + ms;
    for (;;) {
      await flush();
      this.#timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.#timers[0];
      if (next === undefined || next.at > until) break;
      this.#timers.shift();
      this.now = next.at;
      next.fn();
    }
    this.now = until;
    await flush();
  }
  get pending(): number {
    return this.#timers.length;
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** An immediate scheduler for the statistical runs: delays are recorded, callbacks run at once. */
const immediate = () => {
  const delays: number[] = [];
  return { delays, schedule: (d: number, fn: () => void) => (delays.push(d), fn()) };
};

const message = (i: number, patch: Partial<OutboundMessageV2> = {}): OutboundMessageV2 => ({
  orgId: ORG_A,
  channel: 'email',
  purpose: 'invite',
  to: `candidate.${i}@loadsim.test`,
  subject: 'Invitation [synthetic]',
  bodyText: 'Synthetic body.',
  idempotencyKey: `msg-${i}:claim-1`,
  outboundMessageId: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
  ...patch,
});

const make = (patch: Partial<LoadSimOptions> = {}) => {
  const events: LoadSimDeliveryEvent[] = [];
  const sched = new ManualScheduler();
  let n = 0;
  const sim = new LoadSimMessaging('dev', {
    sink: { emit: (e) => void events.push(e) },
    random: seededRandom(42),
    now: () => sched.now,
    scheduler: sched,
    newId: () => `id-${++n}`,
    ...patch,
  });
  return { sim, events, sched };
};

describe('LoadSimMessaging: event ordering (R3-5)', () => {
  it('resolves send() after its latency and emits the delivery event only after that, through the sink', async () => {
    const { sim, events, sched } = make({ transientFailureRate: 0, permanentFailureRate: 0 });
    let resolved: unknown = null;
    void sim.send(message(1)).then((r) => (resolved = r));
    await flush();
    expect(resolved).toBeNull();
    expect(events).toHaveLength(0);
    const latency = sched.delays[0]!;
    await sched.advance(latency);
    expect(resolved).toEqual({
      provider: 'loadsim',
      providerMessageId: 'loadsim-id-1',
      status: 'accepted',
    });
    // The send has resolved, and still no event: it waits on its own timer.
    expect(events).toHaveLength(0);
    expect(sched.pending).toBe(1);
    await sched.advance(60_000);
    const eventDelay = sched.delays[1]!;
    expect(eventDelay).toBeGreaterThanOrEqual(1000);
    expect(events).toEqual([
      {
        provider: 'loadsim',
        providerEventId: 'loadsim-event-id-2',
        providerMessageId: 'loadsim-id-1',
        orgId: ORG_A,
        outboundMessageId: message(1).outboundMessageId,
        event: 'delivered',
        occurredAt: new Date(NOW + latency + eventDelay).toISOString(),
      },
    ]);
  });

  it('never emits an event for a send that failed', async () => {
    const { sim, events, sched } = make({ transientFailureRate: 1, permanentFailureRate: 0 });
    const p = sim.send(message(1)).catch((e: unknown) => e);
    await sched.advance(10_000);
    const e = await p;
    expect(e).toBeInstanceOf(MessagingSendError);
    expect((e as MessagingSendError).code).toBe('provider_unavailable');
    expect((e as MessagingSendError).retryable).toBe(true);
    await sched.advance(60_000);
    expect(events).toHaveLength(0);
  });

  it('a permanent failure is accepted and then bounces (as SES reports it)', async () => {
    const { sim, events, sched } = make({ transientFailureRate: 0, permanentFailureRate: 1 });
    const p = sim.send(message(1));
    await sched.advance(60_000);
    await expect(p).resolves.toMatchObject({ status: 'accepted' });
    expect(events.map((e) => e.event)).toEqual(['bounced']);
  });

  it('a sink that throws is counted, never thrown out of a timer', async () => {
    const sched = new ManualScheduler();
    const sim = new LoadSimMessaging('dev', {
      sink: { emit: () => Promise.reject(new Error('sink down')) },
      random: seededRandom(1),
      now: () => sched.now,
      scheduler: sched,
      transientFailureRate: 0,
      permanentFailureRate: 0,
    });
    const p = sim.send(message(1));
    await sched.advance(60_000);
    await p;
    expect(sim.stats().sinkErrors).toBe(1);
  });
});

describe('LoadSimMessaging: idempotency (E17)', () => {
  it('the same idempotency key returns the same id, counts a duplicate and emits one event', async () => {
    const { sim, events, sched } = make({ transientFailureRate: 0, permanentFailureRate: 0 });
    const a = sim.send(message(1));
    const b = sim.send(message(1));
    await sched.advance(60_000);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.providerMessageId).toBe(rb.providerMessageId);
    const rc = sim.send(message(1));
    await sched.advance(60_000);
    expect((await rc).providerMessageId).toBe(ra.providerMessageId);
    expect(events).toHaveLength(1);
    expect(sim.stats()).toMatchObject({ accepted: 1, duplicates: 2 });
  });

  it('a key whose send failed transiently can be retried', async () => {
    let calls = 0;
    const { sim, sched } = make({
      random: () => (calls++ === 0 ? 0 : 0.5), // the first draw is the first outcome: a transient failure
      transientFailureRate: 0.02,
      permanentFailureRate: 0,
    });
    const first = sim.send(message(1)).catch((e: unknown) => e);
    await sched.advance(60_000);
    expect(await first).toBeInstanceOf(MessagingSendError);
    const second = sim.send(message(1));
    await sched.advance(60_000);
    await expect(second).resolves.toMatchObject({ status: 'accepted' });
    expect(sim.stats()).toMatchObject({ accepted: 1, transientFailures: 1, duplicates: 0 });
  });
});

describe('LoadSimMessaging: latency and failure rates with a seeded RNG', () => {
  const N = 10_000;

  const run = async (patch: Partial<LoadSimOptions>) => {
    const sched = immediate();
    const events: LoadSimDeliveryEvent[] = [];
    const sim = new LoadSimMessaging('staging', {
      sink: { emit: (e) => void events.push(e) },
      random: seededRandom(2026),
      now: () => NOW,
      scheduler: sched,
      ...patch,
    });
    let transient = 0;
    for (let i = 0; i < N; i++) {
      await sim.send(message(i)).catch((e: unknown) => {
        if (e instanceof MessagingSendError && e.retryable) transient++;
        else throw e;
      });
    }
    return { sim, events, transient, delays: sched.delays };
  };

  it('defaults to 2 % transient and 0.5 % permanent failures', async () => {
    const { sim, events, transient, delays } = await run({});
    expect(transient).toBeGreaterThan(N * 0.015);
    expect(transient).toBeLessThan(N * 0.025);
    const bounced = events.filter((e) => e.event === 'bounced').length;
    expect(bounced).toBeGreaterThan(N * 0.003);
    expect(bounced).toBeLessThan(N * 0.007);
    expect(events.length).toBe(N - transient);
    expect(sim.stats()).toMatchObject({ accepted: N - transient, transientFailures: transient });
    expect(delays.every((d) => Number.isFinite(d) && d >= 0)).toBe(true);
  });

  it('transient-only mode (AT-M2-01): no permanent failures, every accepted message is delivered', async () => {
    const { events, transient } = await run({ permanentFailureRate: 0 });
    expect(transient).toBeGreaterThan(0);
    expect(events.every((e) => e.event === 'delivered')).toBe(true);
    expect(events.length).toBe(N - transient);
  });

  it('samples latency with p50 ≈ 300 ms and p99 ≈ 2 s, capped at 30 s', () => {
    const r = seededRandom(7);
    const sorted = Array.from({ length: N }, () => sampleLatencyMs(r, 300, 2000)).sort(
      (a, b) => a - b,
    );
    const p50 = sorted[Math.floor(N * 0.5)]!;
    const p99 = sorted[Math.floor(N * 0.99)]!;
    expect(p50).toBeGreaterThan(270);
    expect(p50).toBeLessThan(330);
    expect(p99).toBeGreaterThan(1700);
    expect(p99).toBeLessThan(2300);
    expect(sorted[0]!).toBeGreaterThanOrEqual(1);
    expect(sorted[N - 1]!).toBeLessThanOrEqual(30_000);
    expect(sampleLatencyMs(() => 0, 300, 2000)).toBeGreaterThanOrEqual(1);
    expect(sampleLatencyMs(() => 0.999999, 300, 2000)).toBeLessThanOrEqual(30_000);
  });

  it('is deterministic for a seed', async () => {
    const a = await run({});
    const b = await run({});
    expect(a.transient).toBe(b.transient);
    expect(a.events.map((e) => e.event)).toEqual(b.events.map((e) => e.event));
  });

  it('declares 50 messages per second', () => {
    expect(LOADSIM_SEND_RATE_PER_SECOND).toBe(50);
    expect(make().sim.sendRatePerSecond).toBe(50);
  });
});

describe('LoadSimMessaging: guards', () => {
  it.each(['candidate.1@example.test', 'a+b_c-d.e@loadsim.test'])(
    'accepts the synthetic address %s',
    async (to) => {
      const { sim, sched } = make({ transientFailureRate: 0, permanentFailureRate: 0 });
      const p = sim.send(message(1, { to }));
      await sched.advance(10_000);
      await expect(p).resolves.toMatchObject({ status: 'accepted' });
    },
  );

  it.each([
    'someone@example.com',
    'success@simulator.amazonses.com',
    'Candidate@LoadSim.test',
    'a@sub.loadsim.test',
    'a@loadsim.test.example.com',
    '@loadsim.test',
  ])('refuses %j with bad_recipient (never sends anywhere)', async (to) => {
    const { sim } = make();
    const e = await sim.send(message(1, { to })).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(MessagingSendError);
    expect((e as MessagingSendError).code).toBe('bad_recipient');
  });

  it('refuses a non-email channel', async () => {
    const { sim } = make();
    const e = await sim.send(message(1, { channel: 'sms' })).catch((err: unknown) => err);
    expect((e as MessagingSendError).code).toBe('channel_refused');
  });

  it.each(['production', '', undefined, 'prod'])('refuses traceEnv %j', (env) => {
    expect(() => new LoadSimMessaging(env as never, { sink: { emit: () => undefined } })).toThrow(
      MessagingConfigError,
    );
  });

  it.each([
    [{ transientFailureRate: -0.1 }],
    [{ transientFailureRate: 1.1 }],
    [{ transientFailureRate: 0.6, permanentFailureRate: 0.6 }],
    [{ permanentFailureRate: Number.NaN }],
    [{ latencyP50Ms: 0 }],
    [{ latencyP50Ms: 500, latencyP99Ms: 400 }],
    [{ sink: undefined as never }],
  ])('refuses bad options %j', (patch) => {
    let caught: unknown;
    try {
      make(patch as Partial<LoadSimOptions>);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MessagingConfigError);
    expect((caught as MessagingConfigError).code).toBe('bad_options');
  });
});
