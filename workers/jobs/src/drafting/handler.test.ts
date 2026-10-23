// The AI drafting job (specs/m1-test-authoring.md §4.4, §6.4, R5-50 draft cap, R5-51 d, R5-56 c/e; AT-M1-09): drafts land
// in_review only and never approved, written drafts are discarded, the cap holds, a re-delivery reproduces the same drafts
// and never duplicates them, and no topic or draft text reaches a log. In-memory store; the real schema is
// db-test/drafting.db.test.ts.
import { DRAFT_PROMPT_VERSION, MOCK_DRAFTER_MODEL_ID, MockLlmDrafter } from '@trace/vendors';
import { describe, expect, it } from 'vitest';
import {
  JOB,
  ORG,
  capturedLog,
  fakeDb,
  job,
  message,
  result,
  scriptedDrafter,
  synthMcq,
  world,
} from './fakes.test-helpers.js';
import { handleDraftMessage, type DraftingDeps } from './handler.js';
import { draftItemId, jobSeed } from './seed.js';

const mockDrafterFor: DraftingDeps['drafterFor'] = (spec) =>
  new MockLlmDrafter('dev', { seed: spec.seed });

const depsFor = (w: ReturnType<typeof world>, patch: Partial<DraftingDeps> = {}) => {
  const db = fakeDb(w);
  const { log, lines } = capturedLog();
  const deps: DraftingDeps = { db, drafterFor: mockDrafterFor, log, ...patch };
  return { deps, db, lines };
};

describe('handleDraftMessage: the happy path (AT-M1-09)', () => {
  it('claims a queued job, stores count passing drafts in_review, never approved, and completes it', async () => {
    const w = world();
    const { deps, db } = depsFor(w);
    expect(await handleDraftMessage(message(), deps)).toBe('completed');
    expect(db.orgs.every((o) => o === ORG)).toBe(true);
    const j = w.jobs.get(JOB)!;
    expect(j.status).toBe('completed');
    expect(j.error_code).toBeNull();
    expect(w.versions).toHaveLength(3);
    for (const v of w.versions) {
      expect(v.status).toBe('in_review');
      expect(v.approved_by).toBeNull();
      expect(v.stem.startsWith('[synthetic] ')).toBe(true);
      expect(v.options.map((o) => o.id)).toContain(v.keyOptionId);
      expect(v.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(w.idempotency.has(`${ORG}:${JOB}:ai_draft`)).toBe(true);
  });

  it('item ids are derived from the job id and the draft position', async () => {
    const w = world();
    await handleDraftMessage(message(), depsFor(w).deps);
    const expected = await Promise.all([0, 1, 2].map((i) => draftItemId(JOB, i)));
    expect(w.versions.map((v) => v.itemId)).toEqual(expected);
  });

  it('passes the job row values and the re-scrubbed topic, and no identity field, to the drafter', async () => {
    const w = world();
    const drafter = scriptedDrafter(async () => result([synthMcq(1), synthMcq(2), synthMcq(3)]));
    const { deps } = depsFor(w, { drafterFor: () => drafter });
    await handleDraftMessage(
      message({ topic: '[synthetic] ask p-someone@example.test or see https://example.test/x' }),
      deps,
    );
    expect(drafter.requests).toHaveLength(1);
    const req = drafter.requests[0]!;
    expect(Object.keys(req).sort()).toEqual(['count', 'difficulty', 'format', 'skill', 'topic']);
    expect(req).toMatchObject({ format: 'mcq', skill: 'logical', difficulty: 0.5, count: 3 });
    expect(req.topic).not.toContain('@');
    expect(req.topic).not.toContain('https://');
    expect(req.topic).toContain('[removed]');
  });

  it('seeds the drafter from the job id, the same on every delivery', async () => {
    const seen: number[] = [];
    const w = world();
    const { deps } = depsFor(w, {
      drafterFor: (spec) => {
        seen.push(spec.seed);
        expect(spec).toMatchObject({
          provider: 'mock',
          modelId: MOCK_DRAFTER_MODEL_ID,
          promptVersion: DRAFT_PROMPT_VERSION,
        });
        return new MockLlmDrafter('dev', { seed: spec.seed });
      },
    });
    await handleDraftMessage(message(), deps);
    expect(seen).toEqual([await jobSeed(JOB)]);
    expect(Number.isSafeInteger(seen[0])).toBe(true);
    expect(await jobSeed(JOB)).not.toBe(await jobSeed(ORG));
  });
});

describe('handleDraftMessage: exactly once', () => {
  it('a re-delivery of a finished job does nothing and never calls the drafter', async () => {
    const w = world();
    await handleDraftMessage(message(), depsFor(w).deps);
    const drafter = scriptedDrafter(async () => result([synthMcq(9)]));
    expect(
      await handleDraftMessage(message(), depsFor(w, { drafterFor: () => drafter }).deps),
    ).toBe('skipped');
    expect(drafter.requests).toHaveLength(0);
    expect(w.versions).toHaveLength(3);
  });

  it('a delivery that died after the claim is resumed and stores the same drafts as one that did not', async () => {
    const crashed = world();
    const a = depsFor(crashed);
    a.db.failOn('insertDraft');
    await expect(handleDraftMessage(message(), a.deps)).rejects.toThrow();
    expect(crashed.jobs.get(JOB)!.status).toBe('running');
    expect(crashed.versions).toHaveLength(0);
    expect(await handleDraftMessage(message(), depsFor(crashed).deps)).toBe('completed');

    const clean = world();
    await handleDraftMessage(message(), depsFor(clean).deps);
    expect(crashed.versions.map((v) => [v.itemId, v.stem])).toEqual(
      clean.versions.map((v) => [v.itemId, v.stem]),
    );
  });

  it('a failure while finishing rolls the drafts back, so nothing is half stored', async () => {
    const w = world();
    const { deps, db } = depsFor(w);
    db.failOn('finish');
    await expect(handleDraftMessage(message(), deps)).rejects.toThrow();
    expect(w.versions).toHaveLength(0);
    expect(w.jobs.get(JOB)!.status).toBe('running');
    expect(await handleDraftMessage(message(), depsFor(w).deps)).toBe('completed');
    expect(w.versions).toHaveLength(3);
  });

  it('an unknown job (or one of another org: RLS hides it) is skipped', async () => {
    const w = world([job({ org_id: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b1ff' })]);
    expect(await handleDraftMessage(message(), depsFor(w).deps)).toBe('skipped');
    expect(w.versions).toHaveLength(0);
  });
});

describe('handleDraftMessage: the draft cap (R5-50, R5-51 d)', () => {
  it('stores at most count drafts when the drafter over-generates; discarded stays within count', async () => {
    const w = world([job({ count: 2 })]);
    const drafter = scriptedDrafter(async () =>
      result([{ junk: 1 }, synthMcq(1), { junk: 2 }, synthMcq(2), synthMcq(3), synthMcq(4)]),
    );
    const { deps } = depsFor(w, { drafterFor: () => drafter });
    expect(await handleDraftMessage(message({ count: 2 }), deps)).toBe('completed');
    expect(w.versions).toHaveLength(2);
    expect(w.jobs.get(JOB)!.drafts_discarded).toBe(2);
  });

  it('fills only the room left by drafts already stored for the job', async () => {
    const w = world([job({ status: 'running' })]);
    w.versions.push(
      ...[1, 2].map((n) => ({
        id: `3f2b8c1e-9a47-4d6b-8e15-7c0a2d94c00${n}`,
        itemId: `3f2b8c1e-9a47-4d6b-8e15-7c0a2d94d00${n}`,
        jobId: JOB,
        status: 'in_review' as const,
        approved_by: null,
        stem: `[synthetic] earlier ${n}`,
        options: [],
        keyOptionId: 'a',
        skill_key: 'logical',
        difficulty: '0.50',
        contentSha256: 'a'.repeat(64),
      })),
    );
    expect(await handleDraftMessage(message(), depsFor(w).deps)).toBe('completed');
    expect(w.versions).toHaveLength(3);
  });

  it('counts at most count discarded drafts (the ai_draft_jobs CHECK)', async () => {
    const w = world([job({ count: 1 })]);
    const junk = Array.from({ length: 5 }, (_, i) => ({ junk: i }));
    const drafter = scriptedDrafter(async () => result(junk));
    const { deps } = depsFor(w, { drafterFor: () => drafter });
    expect(await handleDraftMessage(message({ count: 1 }), deps)).toBe('failed');
    expect(w.jobs.get(JOB)!).toMatchObject({ error_code: 'no_draft_passed', drafts_discarded: 1 });
  });
});

describe('handleDraftMessage: failures end the job with a code', () => {
  it('R5-56 e: a written job discards every draft and fails no_draft_passed', async () => {
    const w = world([job({ format: 'written' })]);
    expect(await handleDraftMessage(message({ format: 'written' }), depsFor(w).deps)).toBe(
      'failed',
    );
    expect(w.versions).toHaveLength(0);
    expect(w.jobs.get(JOB)!).toMatchObject({
      status: 'failed',
      error_code: 'no_draft_passed',
      drafts_discarded: 3,
    });
  });

  it('fails no_draft_passed when every draft duplicates an org version', async () => {
    const w = world();
    const first = world();
    await handleDraftMessage(message(), depsFor(first).deps);
    for (const v of first.versions) w.orgStems.add(v.stem.toLowerCase());
    expect(await handleDraftMessage(message(), depsFor(w).deps)).toBe('failed');
    expect(w.jobs.get(JOB)!).toMatchObject({ error_code: 'no_draft_passed', drafts_discarded: 3 });
  });

  it('fails drafter_error when no drafter serves the pinned provider (the mock refuses production)', async () => {
    const w = world();
    const { deps } = depsFor(w, {
      drafterFor: () => {
        try {
          return new MockLlmDrafter('production');
        } catch {
          return null;
        }
      },
    });
    expect(await handleDraftMessage(message(), deps)).toBe('failed');
    expect(w.jobs.get(JOB)!).toMatchObject({ status: 'failed', error_code: 'drafter_error' });
  });

  it('fails drafter_error when the drafter throws', async () => {
    const w = world();
    const drafter = scriptedDrafter(() => Promise.reject(new Error('[synthetic] upstream')));
    expect(
      await handleDraftMessage(message(), depsFor(w, { drafterFor: () => drafter }).deps),
    ).toBe('failed');
    expect(w.jobs.get(JOB)!.error_code).toBe('drafter_error');
  });

  it('fails timeout when the drafter does not answer in time', async () => {
    const w = world();
    const drafter = scriptedDrafter(
      (_req, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const { deps } = depsFor(w, { drafterFor: () => drafter, timeoutMs: 5 });
    expect(await handleDraftMessage(message(), deps)).toBe('failed');
    expect(w.jobs.get(JOB)!.error_code).toBe('timeout');
  });

  it.each([
    [
      'items that are not a list',
      { items: 'nope', modelId: 'mock-drafter-v1', promptVersion: 'draft-v1' },
    ],
    ['another model than the job pinned', result([synthMcq(1)], { modelId: 'other-model' })],
    [
      'another prompt version than the job pinned',
      result([synthMcq(1)], { promptVersion: 'draft-v9' }),
    ],
    ['no result at all', null],
  ])('fails bad_output on %s', async (_label, answer) => {
    const w = world();
    const drafter = scriptedDrafter(async () => answer as never);
    expect(
      await handleDraftMessage(message(), depsFor(w, { drafterFor: () => drafter }).deps),
    ).toBe('failed');
    expect(w.jobs.get(JOB)!.error_code).toBe('bad_output');
    expect(w.versions).toHaveLength(0);
  });

  it.each([
    ['workspace', { workspaceId: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b1aa' }],
    ['format', { format: 'written' as const }],
    ['skill', { skillKey: 'verbal' }],
    ['difficulty', { difficulty: 0.9 }],
    ['count', { count: 4 }],
  ])('fails internal when the message %s differs from the job row', async (_label, patch) => {
    const w = world();
    const drafter = scriptedDrafter(async () => result([synthMcq(1)]));
    const { deps } = depsFor(w, { drafterFor: () => drafter });
    expect(await handleDraftMessage(message(patch), deps)).toBe('failed');
    expect(w.jobs.get(JOB)!.error_code).toBe('internal');
    expect(drafter.requests).toHaveLength(0);
  });
});

describe('handleDraftMessage: nothing of the topic or the drafts in logs', () => {
  it('logs ids and codes only', async () => {
    const topic = '[synthetic] zebra-topic-marker';
    for (const setup of [
      () => depsFor(world()),
      () => depsFor(world([job({ format: 'written' })])),
      () =>
        depsFor(world(), {
          drafterFor: () => scriptedDrafter(() => Promise.reject(new Error(topic))),
        }),
    ]) {
      const { deps, lines } = setup();
      const w = await handleDraftMessage(message({ topic }), deps).catch(() => 'threw');
      expect(w).not.toBe('threw');
      const text = lines.join('\n');
      expect(text).not.toContain('zebra');
      expect(text).not.toContain('[synthetic]');
      expect(text).not.toContain('Case ');
    }
  });
});
