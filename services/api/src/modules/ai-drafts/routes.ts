// AI drafting requests (spec m1 §6.4, M1-8, §3.2 ai_draft_jobs, §4.4, §6.11 `POST/GET …/bank/ai-drafts`; R5-51 f, R5-56 c,
// R5-61 d; ABH-8). The api writes the `ai_draft_jobs` row as the caller (RLS and the guard: queued, requested_by from the
// JWT) and enqueues AuthoringQueueMessage on AUTHORING_QUEUE; workers/jobs drafts behind LlmDrafter and stores each
// passing draft `in_review` (never approved: a human approves every AI item, AT-M1-07/09). The topic is scrubbed first
// (`scrubDraftTopic`: emails, URLs and phone-like runs removed, capped at 500) and travels only in the message; the row
// keeps `topic_sha256` = SHA-256 hex of the UTF-8 of the scrubbed topic (R5-61 d), and the topic is never stored, logged,
// returned or put in an error. The drafter's provider, model and prompt version are pinned here (R5-51 f), never chosen
// by a client; the job id is the database's.
import { AiDraftJobView, AiDraftRequest, AuthoringQueueMessage } from '@trace/shared/contracts/m1';
import { scrubDraftTopic } from '@trace/shared/item-hash';
import { DRAFT_PROMPT_VERSION, MOCK_DRAFTER_MODEL_ID, MOCK_DRAFTER_PROVIDER } from '@trace/vendors';
import { Hono } from 'hono';
import { z } from 'zod';
import { AUTHORS, defaultWorkspace } from '../bank/content.js';
import { sha256Hex } from '../candidate/encoding.js';
import { parseRows } from '../tests/authoring.js';
import { answer, parseBody, readJson } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import { eq, handleOrg, orgFail, pathId, type OrgDeps } from '../tests/org-context.js';

/** The trace-authoring queue producer (`AUTHORING_QUEUE`, trace-authoring-<env>). */
export interface AuthoringQueue {
  send(message: AuthoringQueueMessage): Promise<void>;
}

export interface AiDraftsDeps {
  org: OrgDeps;
  /** The AUTHORING_QUEUE producer, or null when unbound (requests answer 503 before any write). */
  queue(env: Env): AuthoringQueue | null;
}

export const authoringQueueFromEnv = (env: Env): AuthoringQueue | null => {
  const queue = env.AUTHORING_QUEUE;
  if (queue === undefined) return null;
  return { send: async (message) => void (await queue.send(message)) };
};

/**
 * The drafter M1 runs (R5-3, R5-52 g: MockLlmDrafter is the only implementation until ABH-87). Pinned by the api so the
 * job row records the versions used (CLAUDE.md "Everything is versioned").
 */
export const DRAFTER = {
  provider: MOCK_DRAFTER_PROVIDER,
  modelId: MOCK_DRAFTER_MODEL_ID,
  promptVersion: DRAFT_PROMPT_VERSION,
} as const;

export const AI_DRAFTS_PATH = '/v1/orgs/:orgId/bank/ai-drafts';
export const AI_DRAFT_PATH = '/v1/orgs/:orgId/bank/ai-drafts/:jobId';

const JOB_COLS =
  'id,workspace_id,status,format,skill_key,difficulty,count,drafts_created,error_code,created_at';
const JobRow = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  status: z.string(),
  format: z.string(),
  skill_key: z.string(),
  difficulty: z.union([z.number(), z.string()]).transform(Number),
  count: z.coerce.number().int(),
  drafts_created: z.coerce.number().int(),
  error_code: z.string().nullable(),
  created_at: z.string(),
});
type JobRow = z.infer<typeof JobRow>;

const viewOf = (j: JobRow) => ({
  id: j.id,
  status: j.status,
  format: j.format,
  skillKey: j.skill_key,
  difficulty: j.difficulty,
  count: j.count,
  draftsCreated: j.drafts_created,
  ...(j.error_code === null ? {} : { errorCode: j.error_code }),
});

export const createAiDraftsRoutes = (deps: AiDraftsDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.post(AI_DRAFTS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const req = parseBody(AiDraftRequest, await readJson(c.req.raw));
      // No job without a way to run it: the queue is checked before any write.
      const queue = deps.queue(c.env) ?? orgFail('unavailable');
      const workspaceId = req.workspaceId ?? (await defaultWorkspace(ctx, orgId));
      const topic = scrubDraftTopic(req.topic);
      const [row] = parseRows(
        JobRow,
        await ctx.rest.insert(
          'ai_draft_jobs',
          {
            org_id: orgId,
            workspace_id: workspaceId,
            format: req.format,
            skill_key: req.skillKey,
            difficulty: req.difficulty,
            count: req.count,
            topic_sha256: await sha256Hex(topic),
            provider: DRAFTER.provider,
            model_id: DRAFTER.modelId,
            prompt_version: DRAFTER.promptVersion,
          },
          { select: JOB_COLS },
        ),
      );
      if (row === undefined) return orgFail('not_found');
      const message = AuthoringQueueMessage.safeParse({
        v: 1,
        kind: 'ai_draft',
        jobId: row.id,
        orgId,
        workspaceId: row.workspace_id,
        format: req.format,
        skillKey: req.skillKey,
        difficulty: req.difficulty,
        count: req.count,
        topic,
      });
      try {
        if (!message.success) throw new Error('bad_message');
        await queue.send(message.data);
      } catch {
        // The row stays queued with no message (an org user cannot fail a job; Lead ask). Nothing keeps the topic.
        return orgFail('unavailable');
      }
      return answer(AiDraftJobView, viewOf(row), 201);
    }),
  );

  app.get(AI_DRAFT_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const jobId = pathId(c.req.param('jobId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, AUTHORS);
      const [row] = parseRows(
        JobRow,
        await ctx.rest.select('ai_draft_jobs', {
          select: JOB_COLS,
          id: eq(jobId),
          org_id: eq(orgId),
        }),
      );
      return answer(AiDraftJobView, viewOf(row ?? orgFail('not_found')));
    }),
  );

  return app;
};
