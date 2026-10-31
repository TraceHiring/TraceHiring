// AI drafting requests (spec m1 §6.4, M1-8, §3.2 ai_draft_jobs, §4.4, §6.11 `POST/GET …/bank/ai-drafts`, R5-51 f,
// R5-56 c, R5-61 d; ABH-8): the api writes the job row as the caller (topic_sha256 = SHA-256 hex of the UTF-8 of the
// scrubbed topic; provider, model and prompt version pinned by the api) and enqueues AuthoringQueueMessage with the
// scrubbed topic. The topic is never stored, logged or echoed. Drafts land `in_review` in the jobs worker (AT-M1-07/09
// are db/jobs tests); nothing here approves anything. Synthetic data only.
import { AiDraftJobView, AuthoringQueueMessage } from '@trace/shared/contracts/m1';
import { scrubDraftTopic } from '@trace/shared/item-hash';
import { DRAFT_PROMPT_VERSION, MOCK_DRAFTER_MODEL_ID, MOCK_DRAFTER_PROVIDER } from '@trace/vendors';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A2a security S2: the scrubber is the lead's; a test may make it return a topic the message refuses.
const scrub = vi.hoisted(() => ({ override: null as string | null }));
vi.mock('@trace/shared/item-hash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@trace/shared/item-hash')>();
  return {
    ...actual,
    scrubDraftTopic: (topic: string) => scrub.override ?? actual.scrubDraftTopic(topic),
  };
});
import { sha256Hex } from '../candidate/encoding.js';
import { a2aDb, callerOf, codeOf, harness, ORG, WS, WS2 } from '../bank/a2a.test-helpers.js';
import { createAiDraftsRoutes, type AuthoringQueue } from './routes.js';

const PHONE = ['98765', '43210'].join('');
const MAIL = ['p-someone', 'example.test'].join('@');
const TOPIC = `[synthetic] Polite refunds; ask ${MAIL} or call ${PHONE}`;

const setup = (opts: { noQueue?: boolean; roles?: string[] } = {}) => {
  const db = a2aDb(opts.roles === undefined ? {} : { roles: opts.roles });
  const sent: AuthoringQueueMessage[] = [];
  const queue: AuthoringQueue & { fail: boolean } = {
    fail: false,
    async send(message) {
      if (queue.fail) throw new Error('queue down');
      sent.push(message);
    },
  };
  const { call } = harness(
    (org) => createAiDraftsRoutes({ org, queue: () => (opts.noQueue === true ? null : queue) }),
    db,
    callerOf(),
  );
  return { db, call, sent, queue };
};

const request = (patch: Record<string, unknown> = {}) => ({
  format: 'mcq',
  skillKey: 'customer_service_sjt',
  difficulty: 0.4,
  count: 3,
  topic: TOPIC,
  ...patch,
});

let logs: unknown[] = [];
beforeEach(() => {
  logs = [];
  scrub.override = null;
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
  }
});
afterEach(() => vi.restoreAllMocks());

describe('POST …/bank/ai-drafts', () => {
  it('writes the queued job with the scrubbed topic hash and pinned drafter, then enqueues the message', async () => {
    const { db, call, sent } = setup();
    const res = await call('POST', '/bank/ai-drafts', request());
    expect(res.status).toBe(201);
    const text = await res.text();
    const view = AiDraftJobView.parse(JSON.parse(text));
    expect(view).toMatchObject({ status: 'queued', count: 3, draftsCreated: 0 });
    const scrubbed = scrubDraftTopic(TOPIC);
    expect(scrubbed).not.toContain(PHONE);
    const [row] = db.tables.ai_draft_jobs ?? [];
    expect(row).toMatchObject({
      org_id: ORG,
      workspace_id: WS,
      topic_sha256: await sha256Hex(scrubbed),
      provider: MOCK_DRAFTER_PROVIDER,
      model_id: MOCK_DRAFTER_MODEL_ID,
      prompt_version: DRAFT_PROMPT_VERSION,
    });
    // The client never chooses the job id (R5-51 f): the insert carries none.
    const inserts = db.sentInserts.filter((c) => c.table === 'ai_draft_jobs');
    expect(inserts).toHaveLength(1);
    for (const sentRow of inserts[0]?.body ?? []) {
      expect(Object.keys(sentRow)).not.toContain('id');
      expect(Object.keys(sentRow)).not.toContain('topic');
    }
    expect(Object.keys(row ?? {})).not.toContain('topic');
    expect(sent).toEqual([
      AuthoringQueueMessage.parse({
        v: 1,
        kind: 'ai_draft',
        jobId: view.id,
        orgId: ORG,
        workspaceId: WS,
        format: 'mcq',
        skillKey: 'customer_service_sjt',
        difficulty: 0.4,
        count: 3,
        topic: scrubbed,
      }),
    ]);
    // The topic is never echoed or logged.
    expect(text).not.toContain('refunds');
    expect(logs).toEqual([]);
  });

  it('uses a named workspace', async () => {
    const { db, call, sent } = setup();
    await call('POST', '/bank/ai-drafts', request({ workspaceId: WS2 }));
    expect(db.tables.ai_draft_jobs?.[0]?.workspace_id).toBe(WS2);
    expect(sent[0]?.workspaceId).toBe(WS2);
  });

  it('answers 503 before any write when the queue is unbound, and 503 when the enqueue fails', async () => {
    const unbound = setup({ noQueue: true });
    const r1 = await unbound.call('POST', '/bank/ai-drafts', request());
    expect(r1.status).toBe(503);
    expect(unbound.db.tables.ai_draft_jobs).toEqual([]);
    const down = setup();
    down.queue.fail = true;
    const r2 = await down.call('POST', '/bank/ai-drafts', request());
    expect(r2.status).toBe(503);
    expect(await codeOf(r2)).toBe('unavailable');
  });

  it('parses the queue message before the job insert: a message it refuses answers 400 and writes no job (S2, R5-64 m)', async () => {
    const { db, call, sent } = setup();
    scrub.override = 'x'.repeat(501);
    const res = await call('POST', '/bank/ai-drafts', request());
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe('bad_request');
    expect(db.tables.ai_draft_jobs).toEqual([]);
    expect(db.calls.some((c) => c.table === 'ai_draft_jobs')).toBe(false);
    expect(sent).toEqual([]);
    scrub.override = `${String.fromCharCode(0xd800)} lone`;
    const lone = await call('POST', '/bank/ai-drafts', request());
    expect(lone.status).toBe(400);
    expect(db.tables.ai_draft_jobs).toEqual([]);
  });

  it('sends the message built before the insert, with the stored job id', async () => {
    const { db, call, sent } = setup();
    const res = await call('POST', '/bank/ai-drafts', request());
    expect(res.status).toBe(201);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.jobId).toBe(db.tables.ai_draft_jobs?.[0]?.id);
  });

  it('refuses a bad request and a reviewer', async () => {
    const { call } = setup();
    expect((await call('POST', '/bank/ai-drafts', request({ count: 11 }))).status).toBe(400);
    expect((await call('POST', '/bank/ai-drafts', request({ topic: '' }))).status).toBe(400);
    const r = setup({ roles: ['reviewer'] });
    expect((await r.call('POST', '/bank/ai-drafts', request())).status).toBe(404);
  });
});

describe('GET …/bank/ai-drafts/:id', () => {
  it('answers the job view with its counts and error code', async () => {
    const { db, call } = setup();
    const created = AiDraftJobView.parse(
      await (await call('POST', '/bank/ai-drafts', request())).json(),
    );
    const row = db.tables.ai_draft_jobs?.[0];
    if (row !== undefined) Object.assign(row, { status: 'failed', error_code: 'no_draft_passed' });
    const res = await call('GET', `/bank/ai-drafts/${created.id}`);
    expect(res.status).toBe(200);
    expect(AiDraftJobView.parse(await res.json())).toMatchObject({
      status: 'failed',
      errorCode: 'no_draft_passed',
    });
    expect((await call('GET', '/bank/ai-drafts/c8000000-0000-4000-8000-0000000000ff')).status).toBe(
      404,
    );
  });
});
