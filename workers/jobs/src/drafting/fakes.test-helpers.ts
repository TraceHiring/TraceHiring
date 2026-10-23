// Test fakes for the AI drafting job: an in-memory DraftStore that behaves like the M1 schema for the paths the job
// takes (a transaction rolls back on throw; the item_versions guard stores an AI draft as in_review only while its job is
// running and has room; a finished job is frozen; an item id is unique across orgs), a scripted LlmDrafter and a
// capturing logger. Synthetic data only.
import type { AuthoringQueueMessage } from '@trace/shared/contracts/m1';
import { createLogger, type Logger } from '@trace/shared/log';
import type { DraftRequest, DraftResult, DraftedItem, LlmDrafter } from '@trace/vendors';
import { draftTopicSha256, type DraftingDb } from './handler.js';
import type { DraftJobRow, DraftOutcomeWrite, DraftStore, StoredDraft } from './store.js';

export const ORG = '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b101';
export const WORKSPACE = '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b102';
export const JOB = '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b103';
export const TOPIC = '[synthetic] planning a small team week';
/** ai_draft_jobs.topic_sha256 of TOPIC, as the api writes it (R5-61 d). */
export const TOPIC_SHA256 = await draftTopicSha256(TOPIC);

export interface FakeJob extends DraftJobRow {
  org_id: string;
  drafts_discarded: number;
  error_code: string | null;
}

export interface FakeVersion {
  id: string;
  itemId: string;
  jobId: string;
  status: 'in_review';
  approved_by: null;
  stem: string;
  options: readonly { id: string; text: string }[];
  keyOptionId: string;
  skill_key: string;
  difficulty: string;
  contentSha256: string;
}

export interface FakeWorld {
  jobs: Map<string, FakeJob>;
  items: Set<string>;
  versions: FakeVersion[];
  idempotency: Set<string>;
  /** Normalised stems of other versions of the org (the exact-duplicate lookup). */
  orgStems: Set<string>;
  /** Approved stems of the job's skill, most recent first. */
  approved: string[];
}

export const job = (patch: Partial<FakeJob> = {}): FakeJob => ({
  id: JOB,
  org_id: ORG,
  workspace_id: WORKSPACE,
  format: 'mcq',
  skill_key: 'logical',
  difficulty: '0.50',
  count: 3,
  status: 'queued',
  provider: 'mock',
  model_id: 'mock-drafter-v1',
  prompt_version: 'draft-v1',
  topic_sha256: TOPIC_SHA256,
  drafts_discarded: 0,
  error_code: null,
  ...patch,
});

export const world = (jobs: readonly FakeJob[] = [job()]): FakeWorld => ({
  jobs: new Map(jobs.map((j) => [j.id, j])),
  items: new Set(),
  versions: [],
  idempotency: new Set(),
  orgStems: new Set(),
  approved: [],
});

export const message = (patch: Partial<AuthoringQueueMessage> = {}): AuthoringQueueMessage => ({
  v: 1,
  kind: 'ai_draft',
  jobId: JOB,
  orgId: ORG,
  workspaceId: WORKSPACE,
  format: 'mcq',
  skillKey: 'logical',
  difficulty: 0.5,
  count: 3,
  topic: TOPIC,
  ...patch,
});

const guard = (reason: string): Error =>
  Object.assign(new Error(`TRACE_GUARD: ${reason}`), { code: '42501' });

const clone = (w: FakeWorld): FakeWorld => ({
  jobs: new Map([...w.jobs].map(([k, v]) => [k, { ...v }])),
  items: new Set(w.items),
  versions: w.versions.map((v) => ({ ...v })),
  idempotency: new Set(w.idempotency),
  orgStems: new Set(w.orgStems),
  approved: [...w.approved],
});

export type StoreMethod = keyof DraftStore;

export interface FakeDb extends DraftingDb {
  /** The org each transaction was bound to. */
  readonly orgs: string[];
  /** Throws a database-like error from `method` (once, or on every call when `always`). */
  failOn(method: StoreMethod, always?: boolean): void;
}

let versionSeq = 0;

const storeOf = (w: FakeWorld, org: string, fail: (m: StoreMethod) => void): DraftStore => {
  const visible = (jobId: string): FakeJob | null => {
    const j = w.jobs.get(jobId);
    return j !== undefined && j.org_id === org ? j : null;
  };
  return {
    async lockJob(jobId) {
      fail('lockJob');
      const j = visible(jobId);
      if (j === null) return null;
      return {
        id: j.id,
        workspace_id: j.workspace_id,
        format: j.format,
        skill_key: j.skill_key,
        difficulty: j.difficulty,
        count: j.count,
        status: j.status,
        provider: j.provider,
        model_id: j.model_id,
        prompt_version: j.prompt_version,
        topic_sha256: j.topic_sha256,
      };
    },
    async claim(jobId) {
      fail('claim');
      const j = visible(jobId);
      if (j?.status === 'queued') j.status = 'running';
    },
    async keyExists(jobId) {
      fail('keyExists');
      return w.idempotency.has(`${org}:${jobId}:ai_draft`);
    },
    async storedDrafts(jobId) {
      fail('storedDrafts');
      return w.versions.filter((v) => v.jobId === jobId).length;
    },
    async existingStems(normalised) {
      fail('existingStems');
      return new Set(normalised.filter((n) => w.orgStems.has(n)));
    },
    async approvedStems(skillKey, limit) {
      fail('approvedStems');
      void skillKey;
      return w.approved.slice(0, limit);
    },
    async insertDraft(j: DraftJobRow, draft: StoredDraft) {
      fail('insertDraft');
      const live = visible(j.id);
      const stored = w.versions.filter((v) => v.jobId === j.id).length;
      if (live?.status !== 'running' || stored >= live.count) {
        throw guard('an AI draft needs its running drafting job');
      }
      if (w.items.has(draft.itemId)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        });
      }
      w.items.add(draft.itemId);
      versionSeq += 1;
      const id = `3f2b8c1e-9a47-4d6b-8e15-${versionSeq.toString(16).padStart(12, '0')}`;
      w.versions.push({
        id,
        itemId: draft.itemId,
        jobId: j.id,
        status: 'in_review',
        approved_by: null,
        stem: draft.item.stem,
        options: draft.item.options,
        keyOptionId: draft.item.correctOptionId,
        skill_key: j.skill_key,
        difficulty: j.difficulty,
        contentSha256: draft.contentSha256,
      });
      return id;
    },
    async finish(jobId, outcome: DraftOutcomeWrite) {
      fail('finish');
      const j = visible(jobId);
      if (j === null) throw guard('job not found');
      if (j.status === 'completed' || j.status === 'failed') {
        throw guard('a finished drafting job is frozen');
      }
      if (outcome.status === 'completed' && j.status !== 'running') {
        throw guard('drafting job status change not allowed');
      }
      if (outcome.discarded < 0) {
        throw Object.assign(new Error('check violation'), { code: '23514' });
      }
      j.status = outcome.status;
      j.drafts_discarded = outcome.discarded;
      j.error_code = outcome.status === 'failed' ? outcome.errorCode : null;
      w.idempotency.add(`${org}:${jobId}:ai_draft`);
    },
  };
};

/** A DraftingDb over `w`: each run() is one transaction that rolls back when fn throws. */
export const fakeDb = (w: FakeWorld): FakeDb => {
  const orgs: string[] = [];
  const failures = new Map<StoreMethod, boolean>();
  const fail = (m: StoreMethod): void => {
    const always = failures.get(m);
    if (always === undefined) return;
    if (!always) failures.delete(m);
    throw Object.assign(new Error('connection reset [synthetic]'), { code: '08006' });
  };
  return {
    orgs,
    failOn: (m, always = false) => {
      failures.set(m, always);
    },
    run: async (orgId, fn) => {
      orgs.push(orgId);
      const before = clone(w);
      try {
        return await fn(storeOf(w, orgId, fail));
      } catch (err) {
        const b = before;
        w.jobs = b.jobs;
        w.items = b.items;
        w.versions = b.versions;
        w.idempotency = b.idempotency;
        throw err;
      }
    },
  };
};

/** A drafter that records its requests and answers from `answer`. */
export const scriptedDrafter = (
  answer: (req: DraftRequest, signal?: AbortSignal) => Promise<DraftResult>,
): LlmDrafter & { readonly requests: DraftRequest[] } => {
  const requests: DraftRequest[] = [];
  return {
    requests,
    draft: (req, opts) => {
      requests.push(req);
      return answer(req, opts?.signal);
    },
  };
};

export const result = (
  items: readonly unknown[],
  patch: Partial<DraftResult> = {},
): DraftResult => ({
  items: items as DraftedItem[],
  modelId: 'mock-drafter-v1',
  adapterVersion: 'mock-1',
  promptVersion: 'draft-v1',
  ...patch,
});

export const synthMcq = (n: number): DraftedItem => ({
  format: 'mcq',
  stem: `[synthetic] Case ${100 + n}. A clerk gets ${10 + n} requests in one morning. What should be done first?`,
  options: [
    { id: 'a', text: 'Do the most urgent task first' },
    { id: 'b', text: 'Wait until the last day to start' },
    { id: 'c', text: 'Ignore the deadline' },
  ],
  correctOptionId: 'a',
});

export interface CapturedLog {
  log: Logger;
  lines: string[];
}

export const capturedLog = (): CapturedLog => {
  const lines: string[] = [];
  return {
    lines,
    log: createLogger({ service: 'jobs', version: 'dev', sink: (l) => lines.push(l) }),
  };
};
