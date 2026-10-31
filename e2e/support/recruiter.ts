// The recruiter side at the API level for specs that then drive the candidate UI: one published test (3 MCQ items,
// 1 written item, the editor's default cutoff 40) and one invitation, through the org endpoints of
// specs/d1-demo-slice.md §6.2 exactly as candidate-store.spec.ts calls them. The link token is returned once by the
// create answer (`inviteUrl`); nothing here prints it, a code or a body.
import type { APIRequestContext } from '@playwright/test';
import { jsonOf } from './http.js';
import { linkTokenOfUrl } from './outbox.js';

export interface RecruiterCtx {
  api: string;
  orgId: string;
  jwt: string;
}
export interface PublishedTest {
  testId: string;
  versionId: string;
  name: string;
}
export interface Invitation {
  invitationId: string;
  /** The candidate label the demo outbox shows (never an address). */
  label: string;
  status: string;
  /** The raw 43-character link token, or null (an inviter-"No" invitation has no link). */
  token: string | null;
}

/** MCQ option texts of the published test, in order (ids a, b, c); the first is the correct one. */
export const MCQ_OPTIONS = [
  'The correct option',
  'A wrong option',
  'Another wrong option',
] as const;
/** The anchors of the written item's rubric (also words a strong answer holds). */
export const WRITTEN_ANCHORS = ['queue', 'retry', 'idempotent'] as const;
/** The editor's default Answer Quality cutoff (spec §6.2, L-15). */
export const DEFAULT_CUTOFF = 40;

const org = (ctx: RecruiterCtx, path: string) => `${ctx.api}/v1/orgs/${ctx.orgId}${path}`;
const authed = (ctx: RecruiterCtx) => ({ Authorization: `Bearer ${ctx.jwt}` });

/** The fields of `GET /tests/:id` the specs read (hand-typed; e2e imports nothing from @trace/shared). */
export interface TestDetail {
  test: { id: string; name: string };
  version: {
    id: string;
    versionNo: number;
    status: string;
    qualityCutoff: number;
    sections: { items: unknown[] }[];
  };
}

export const getTestDetail = async (
  request: APIRequestContext,
  ctx: RecruiterCtx,
  testId: string,
): Promise<TestDetail> =>
  jsonOf<TestDetail>(
    await request.get(org(ctx, `/tests/${testId}`), { headers: authed(ctx) }),
    200,
    'reading the test',
  );

/**
 * Saves the content into an existing draft (30 minutes, 3 MCQ items, 1 written item with rubric anchors, cutoff 40)
 * and publishes it. Returns the publish answer's status and cutoff.
 */
export const fillAndPublish = async (
  request: APIRequestContext,
  ctx: RecruiterCtx,
  draft: PublishedTest,
): Promise<{ status: string; qualityCutoff: number }> => {
  const { testId, versionId, name } = draft;
  const mcq = (n: number) => ({
    format: 'mcq',
    prompt: `Synthetic question ${n}: which option is marked correct?`,
    options: MCQ_OPTIONS.map((text, i) => ({ id: ['a', 'b', 'c'][i], text })),
    correctOptionId: 'a',
  });
  await jsonOf<unknown>(
    await request.put(org(ctx, `/tests/${testId}`), {
      headers: authed(ctx),
      data: {
        name,
        durationMinutes: 30,
        qualityCutoff: DEFAULT_CUTOFF,
        sections: [
          { format: 'mcq', name: 'Reasoning', weight: 60, items: [mcq(1), mcq(2), mcq(3)] },
          {
            format: 'written',
            name: 'Writing',
            weight: 40,
            items: [
              {
                format: 'written',
                prompt: 'Synthetic task: explain how a background job avoids doing work twice.',
                rubric: {
                  criteria: [
                    {
                      id: 'c1',
                      label: 'Names the delivery ideas',
                      maxPoints: 10,
                      anchors: [...WRITTEN_ANCHORS],
                      minHits: 2,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    }),
    200,
    'saving the draft',
  );
  return jsonOf<{ status: string; qualityCutoff: number }>(
    await request.post(org(ctx, `/tests/${testId}/publish`), {
      headers: authed(ctx),
      data: { testVersionId: versionId },
    }),
    200,
    'publishing the test',
  );
};

/** Creates a 30-minute test with 3 MCQ items and 1 written item, and publishes it. */
export const createPublishedTest = async (
  request: APIRequestContext,
  ctx: RecruiterCtx,
  name: string,
): Promise<PublishedTest> => {
  const created = await jsonOf<{ test: { id: string }; version: { id: string } }>(
    await request.post(org(ctx, '/tests'), {
      headers: authed(ctx),
      data: { name, durationMinutes: 30 },
    }),
    201,
    'creating the test',
  );
  const draft = { testId: created.test.id, versionId: created.version.id, name };
  await fillAndPublish(request, ctx, draft);
  return draft;
};

/** Invites one candidate (18+ confirmed by the inviter by default). */
export const inviteCandidate = async (
  request: APIRequestContext,
  ctx: RecruiterCtx,
  testId: string,
  contactEmail: string,
  adultConfirmedByInviter = true,
): Promise<Invitation> => {
  const res = await jsonOf<{
    invitationId: string;
    label: string;
    status: string;
    inviteUrl: string | null;
  }>(
    await request.post(org(ctx, `/tests/${testId}/invitations`), {
      headers: authed(ctx),
      data: { contactEmail, adultConfirmedByInviter },
    }),
    201,
    'inviting a candidate',
  );
  return {
    invitationId: res.invitationId,
    label: res.label,
    status: res.status,
    token: res.inviteUrl === null ? null : linkTokenOfUrl(res.inviteUrl),
  };
};
