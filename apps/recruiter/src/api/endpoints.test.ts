// The M1 typed calls (specs/m1-test-authoring.md §6.11, R5-53 c): method, path, query, body and the contract each
// answer is parsed with. A request that fails its contract is refused as bad_request before any request is sent;
// an answer that fails its contract is invalid_response. Synthetic data only.
import {
  INTEGRITY_SETTING_VALUES,
  encodePageCursor,
  type BankItemDraft,
  type ImportRow,
  type SaveTestDraftRequest,
} from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { ApiClient, type ApiResult, type FetchLike } from './client';
import * as m1 from './endpoints';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://trace-api-staging.example-sub.workers.dev';
const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-23T10:00:00.000Z';
const SHA = 'ab'.repeat(32);
const CURSOR = encodePageCursor({ createdAt: NOW, id: uid(99) });

interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function harness(respond: () => Response) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body,
      headers: new Headers(init.headers),
    });
    return Promise.resolve(respond());
  };
  const api = new ApiClient({
    origin: ORIGIN,
    orgId: ORG,
    getAccessToken: () => Promise.resolve('tok-synthetic'),
    fetch: fetchImpl,
  });
  return { api, calls };
}

const ORG_URL = `${ORIGIN}/v1/orgs/${ORG}`;

// ---- Valid request bodies --------------------------------------------------------------------------------------

const MCQ_DRAFT: BankItemDraft = {
  format: 'mcq',
  stem: 'Synthetic question?',
  options: [
    { id: 'a', text: 'One' },
    { id: 'b', text: 'Two' },
  ],
  key: { optionId: 'a' },
  skillKey: 'verbal',
  difficulty: 0.4,
};
const SETTINGS = Object.fromEntries(
  Object.entries(INTEGRITY_SETTING_VALUES).map(([key, values]) => [key, values[0]]),
) as Parameters<typeof m1.putIntegritySettings>[2]['values'];
const DRAFT_BODY: SaveTestDraftRequest = {
  name: 'Synthetic test',
  durationMinutes: 30,
  qualityCutoff: 50,
  sections: [
    {
      mode: 'pool',
      format: 'mcq',
      name: 'Verbal',
      weight: 100,
      items: [],
      poolId: uid(5),
      drawCount: 5,
      shuffleItems: true,
      shuffleOptions: true,
      navigation: 'free',
    },
  ],
};
const IMPORT_ROW: ImportRow = {
  rowNo: 2,
  format: 'written',
  skillKey: 'writing',
  difficulty: 0.5,
  stem: 'Describe a synthetic situation.',
  rubricKey: 'clarity',
};

// ---- Request shapes --------------------------------------------------------------------------------------------

interface Case {
  name: string;
  run: (api: ApiClient) => Promise<ApiResult<unknown>>;
  method: string;
  path: string;
  body?: unknown;
}

const CASES: Case[] = [
  {
    name: 'listBankItems',
    run: (api) => m1.listBankItems(api),
    method: 'GET',
    path: '/bank/items',
  },
  {
    name: 'listBankItems with filters (sorted, text difficulties)',
    run: (api) =>
      m1.listBankItems(api, {
        status: 'in_review',
        format: 'mcq',
        difficultyMin: '0.2',
        cursor: CURSOR,
      }),
    method: 'GET',
    path: `/bank/items?cursor=${CURSOR}&difficultyMin=0.2&format=mcq&status=in_review`,
  },
  {
    name: 'createBankItem',
    run: (api) => m1.createBankItem(api, MCQ_DRAFT),
    method: 'POST',
    path: '/bank/items',
    body: MCQ_DRAFT,
  },
  {
    name: 'getBankItem',
    run: (api) => m1.getBankItem(api, uid(1)),
    method: 'GET',
    path: `/bank/items/${uid(1)}`,
  },
  {
    name: 'updateBankItem',
    run: (api) => m1.updateBankItem(api, uid(1), MCQ_DRAFT),
    method: 'PUT',
    path: `/bank/items/${uid(1)}`,
    body: MCQ_DRAFT,
  },
  {
    name: 'createBankItemVersion',
    run: (api) => m1.createBankItemVersion(api, uid(1)),
    method: 'POST',
    path: `/bank/items/${uid(1)}/versions`,
  },
  {
    name: 'submitBankItemVersion',
    run: (api) => m1.submitBankItemVersion(api, uid(2)),
    method: 'POST',
    path: `/bank/item-versions/${uid(2)}/submit`,
  },
  {
    name: 'reviewBankItemVersion (the path id is the body id)',
    run: (api) => m1.reviewBankItemVersion(api, { itemVersionId: uid(2), decision: 'approve' }),
    method: 'POST',
    path: `/bank/item-versions/${uid(2)}/review`,
    body: { itemVersionId: uid(2), decision: 'approve' },
  },
  {
    name: 'retireBankItemVersion',
    run: (api) => m1.retireBankItemVersion(api, uid(2)),
    method: 'POST',
    path: `/bank/item-versions/${uid(2)}/retire`,
  },
  { name: 'bankStats', run: (api) => m1.bankStats(api), method: 'GET', path: '/bank/stats' },
  { name: 'listPools', run: (api) => m1.listPools(api), method: 'GET', path: '/pools' },
  {
    name: 'listPools with a cursor',
    run: (api) => m1.listPools(api, { cursor: CURSOR }),
    method: 'GET',
    path: `/pools?cursor=${CURSOR}`,
  },
  {
    name: 'getPool',
    run: (api) => m1.getPool(api, uid(5)),
    method: 'GET',
    path: `/pools/${uid(5)}`,
  },
  {
    name: 'createPool',
    run: (api) => m1.createPool(api, { name: 'Verbal pool', format: 'mcq' }),
    method: 'POST',
    path: '/pools',
    body: { name: 'Verbal pool', format: 'mcq' },
  },
  {
    name: 'updatePool',
    run: (api) => m1.updatePool(api, uid(5), { name: 'Renamed', format: 'mcq' }),
    method: 'PUT',
    path: `/pools/${uid(5)}`,
    body: { name: 'Renamed', format: 'mcq' },
  },
  {
    name: 'addPoolItems',
    run: (api) => m1.addPoolItems(api, uid(5), { itemVersionIds: [uid(2), uid(3)] }),
    method: 'POST',
    path: `/pools/${uid(5)}/items`,
    body: { itemVersionIds: [uid(2), uid(3)] },
  },
  {
    name: 'removePoolItems',
    run: (api) => m1.removePoolItems(api, uid(5), { itemVersionIds: [uid(2)] }),
    method: 'DELETE',
    path: `/pools/${uid(5)}/items`,
    body: { itemVersionIds: [uid(2)] },
  },
  {
    name: 'browseLibrary',
    run: (api) => m1.browseLibrary(api, { skillKey: 'verbal', difficultyMax: '0.9' }),
    method: 'GET',
    path: '/library/items?difficultyMax=0.9&skillKey=verbal',
  },
  {
    name: 'copyLibraryItems',
    run: (api) => m1.copyLibraryItems(api, { libraryItemVersionIds: [uid(7)] }),
    method: 'POST',
    path: '/library/copy',
    body: { libraryItemVersionIds: [uid(7)] },
  },
  {
    name: 'createAiDraftJob',
    run: (api) =>
      m1.createAiDraftJob(api, {
        format: 'mcq',
        skillKey: 'verbal',
        difficulty: 0.5,
        count: 3,
        topic: 'Synthetic topic',
      }),
    method: 'POST',
    path: '/bank/ai-drafts',
    body: {
      format: 'mcq',
      skillKey: 'verbal',
      difficulty: 0.5,
      count: 3,
      topic: 'Synthetic topic',
    },
  },
  {
    name: 'getAiDraftJob',
    run: (api) => m1.getAiDraftJob(api, uid(8)),
    method: 'GET',
    path: `/bank/ai-drafts/${uid(8)}`,
  },
  {
    name: 'createImportJob',
    run: (api) =>
      m1.createImportJob(api, { sourceKind: 'xlsx', templateVersion: 'trace-items-v1' }),
    method: 'POST',
    path: '/imports',
    body: { sourceKind: 'xlsx', templateVersion: 'trace-items-v1' },
  },
  {
    name: 'getImportJob',
    run: (api) => m1.getImportJob(api, uid(9)),
    method: 'GET',
    path: `/imports/${uid(9)}`,
  },
  {
    name: 'postImportRows',
    run: (api) => m1.postImportRows(api, uid(9), { rows: [IMPORT_ROW] }),
    method: 'POST',
    path: `/imports/${uid(9)}/rows`,
    body: { rows: [IMPORT_ROW] },
  },
  {
    name: 'completeImportJob',
    run: (api) => m1.completeImportJob(api, uid(9)),
    method: 'POST',
    path: `/imports/${uid(9)}/complete`,
  },
  {
    name: 'cancelImportJob',
    run: (api) => m1.cancelImportJob(api, uid(9)),
    method: 'POST',
    path: `/imports/${uid(9)}/cancel`,
  },
  {
    name: 'putImportImage',
    run: (api) => m1.putImportImage(api, uid(9), SHA, 'image/png', new Uint8Array([1, 2, 3])),
    method: 'PUT',
    path: `/imports/${uid(9)}/images/${SHA}`,
  },
  {
    name: 'getIntegritySettings',
    run: (api) => m1.getIntegritySettings(api, uid(3)),
    method: 'GET',
    path: `/tests/${uid(3)}/integrity`,
  },
  {
    name: 'putIntegritySettings',
    run: (api) => m1.putIntegritySettings(api, uid(3), { presetKey: null, values: SETTINGS }),
    method: 'PUT',
    path: `/tests/${uid(3)}/integrity`,
    body: { presetKey: null, values: SETTINGS },
  },
  {
    name: 'listIntegrityLocks',
    run: (api) => m1.listIntegrityLocks(api),
    method: 'GET',
    path: '/settings/integrity-locks',
  },
  {
    name: 'createIntegrityLock',
    run: (api) =>
      m1.createIntegrityLock(api, { settingKey: 'paste_written', lockedValue: 'blocked' }),
    method: 'POST',
    path: '/settings/integrity-locks',
    body: { settingKey: 'paste_written', lockedValue: 'blocked' },
  },
  {
    name: 'deleteIntegrityLock',
    run: (api) => m1.deleteIntegrityLock(api, 'paste_written'),
    method: 'DELETE',
    path: '/settings/integrity-locks/paste_written',
  },
  {
    name: 'listMemberInvites',
    run: (api) => m1.listMemberInvites(api),
    method: 'GET',
    path: '/members/invites',
  },
  {
    name: 'createMemberInvite',
    run: (api) =>
      m1.createMemberInvite(api, {
        email: 'person@example.test',
        roles: ['recruiter'],
        displayName: 'Synthetic Person',
      }),
    method: 'POST',
    path: '/members/invites',
    body: { email: 'person@example.test', roles: ['recruiter'], displayName: 'Synthetic Person' },
  },
  {
    name: 'cancelMemberInvite',
    run: (api) => m1.cancelMemberInvite(api, uid(11)),
    method: 'DELETE',
    path: `/members/invites/${uid(11)}`,
  },
  {
    name: 'listRoleTemplates',
    run: (api) => m1.listRoleTemplates(api),
    method: 'GET',
    path: '/templates',
  },
  {
    name: 'proposeBlueprint',
    run: (api) => m1.proposeBlueprint(api, { jdText: 'Synthetic job description' }),
    method: 'POST',
    path: '/blueprints/propose',
    body: { jdText: 'Synthetic job description' },
  },
  {
    name: 'createTestFromTemplate',
    run: (api) =>
      m1.createTestFromTemplate(api, {
        jobTitle: 'Synthetic role',
        templateKey: 'customer_support',
        templateVersion: 1,
      }),
    method: 'POST',
    path: '/tests/from-template',
    body: { jobTitle: 'Synthetic role', templateKey: 'customer_support', templateVersion: 1 },
  },
  {
    name: 'getTestDraft',
    run: (api) => m1.getTestDraft(api, uid(3)),
    method: 'GET',
    path: `/tests/${uid(3)}`,
  },
  {
    name: 'createTestVersion',
    run: (api) => m1.createTestVersion(api, uid(3)),
    method: 'POST',
    path: `/tests/${uid(3)}/versions`,
  },
  {
    name: 'saveTestDraft',
    run: (api) => m1.saveTestDraft(api, uid(3), DRAFT_BODY),
    method: 'PUT',
    path: `/tests/${uid(3)}/draft`,
    body: DRAFT_BODY,
  },
];

describe('M1 endpoints: request shapes', () => {
  it.each(CASES)('$name', async (c) => {
    // `{}` fails every response contract, so each call also proves the answer is parsed.
    const { api, calls } = harness(() => json({}));
    const res = await c.run(api);
    expect(res).toEqual({ ok: false, code: 'invalid_response' });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(`${ORG_URL}${c.path}`);
    expect(call?.method).toBe(c.method);
    expect(call?.headers.get('authorization')).toBe('Bearer tok-synthetic');
    if (c.name === 'putImportImage') {
      expect(call?.headers.get('content-type')).toBe('image/png');
      expect(call?.body).toBeInstanceOf(Uint8Array);
    } else if (c.body === undefined) {
      expect(call?.body).toBeUndefined();
      expect(call?.headers.get('content-type')).toBeNull();
    } else {
      expect(JSON.parse(String(call?.body))).toEqual(c.body);
      expect(call?.headers.get('content-type')).toBe('application/json');
    }
  });

  it('covers every exported M1 call', () => {
    const covered = new Set(CASES.map((c) => c.name.split(' ')[0]));
    const exported = Object.keys(m1).filter(
      (key) => typeof (m1 as Record<string, unknown>)[key] === 'function',
    );
    const d1 = new Set([
      'listTests',
      'createTest',
      'getTest',
      'updateDraft',
      'publishTest',
      'listAssignments',
      'createAssignment',
      'deleteAssignment',
      'listInvitations',
      'createInvitation',
      'testResults',
      'reviewQueue',
    ]);
    expect(exported.filter((key) => !d1.has(key) && !covered.has(key))).toEqual([]);
  });
});

// ---- Requests that fail their contract are never sent -----------------------------------------------------------

describe('M1 endpoints: a bad request is refused before it is sent', () => {
  const refused: [string, (api: ApiClient) => Promise<ApiResult<unknown>>][] = [
    [
      'an unknown key in a body',
      (api) => m1.createPool(api, { name: 'x', format: 'mcq', extra: 1 } as never),
    ],
    [
      'an item draft without a key',
      (api) => m1.createBankItem(api, { ...MCQ_DRAFT, key: undefined } as never),
    ],
    [
      'a review decision that is not approve or not_approved',
      (api) =>
        m1.reviewBankItemVersion(api, { itemVersionId: uid(2), decision: 'reject' } as never),
    ],
    [
      'a difficulty that is not decimal text',
      (api) => m1.listBankItems(api, { difficultyMin: ' ' }),
    ],
    ['a cursor that is not a page cursor', (api) => m1.listPools(api, { cursor: 'abc' })],
    ['an unknown query key', (api) => m1.browseLibrary(api, { poolId: uid(1) } as never)],
    [
      'an image hash that is not 64 hex characters',
      (api) => m1.putImportImage(api, uid(9), 'ABC', 'image/png', new Uint8Array([1])),
    ],
    [
      'an image content type outside png, jpeg and webp',
      (api) => m1.putImportImage(api, uid(9), SHA, 'image/gif' as never, new Uint8Array([1])),
    ],
    ['an unknown setting key', (api) => m1.deleteIntegrityLock(api, 'not_a_setting' as never)],
    [
      'a lock on an always-locked setting',
      (api) => m1.createIntegrityLock(api, { settingKey: 'accommodations', lockedValue: 'on' }),
    ],
    [
      'a pool section with no pool',
      (api) =>
        m1.saveTestDraft(api, uid(3), {
          ...DRAFT_BODY,
          sections: [{ ...DRAFT_BODY.sections[0], poolId: undefined }],
        } as never),
    ],
    [
      'an invite with no roles',
      (api) =>
        m1.createMemberInvite(api, {
          email: 'a@example.test',
          roles: [],
          displayName: 'A',
        } as never),
    ],
    ['an empty id batch', (api) => m1.addPoolItems(api, uid(5), { itemVersionIds: [] })],
  ];

  it.each(refused)('%s', async (_name, run) => {
    const { api, calls } = harness(() => json({}));
    expect(await run(api)).toEqual({ ok: false, code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });

  it('path ids are percent-encoded, never spliced into the path', async () => {
    const { api, calls } = harness(() => json({}));
    await m1.getBankItem(api, '../x?y=1');
    expect(calls[0]?.url).toBe(`${ORG_URL}/bank/items/..%2Fx%3Fy%3D1`);
  });
});

// ---- Answers that parse -----------------------------------------------------------------------------------------

const DETAIL = (status: 'draft' | 'in_review' | 'approved' | 'retired') => ({
  itemId: uid(1),
  itemVersionId: uid(2),
  versionNo: 1,
  workspaceId: uid(4),
  status,
  origin: 'human',
  isParameterised: false,
  librarySourced: false,
  createdBy: uid(6),
  approvedBy: status === 'approved' || status === 'retired' ? uid(6) : null,
  approvedAt: status === 'approved' || status === 'retired' ? NOW : null,
  exposureCount: 0,
  content: {
    format: 'mcq',
    stem: 'Synthetic question?',
    options: [
      { id: 'a', text: 'One' },
      { id: 'b', text: 'Two' },
    ],
    key: { optionId: 'a' },
    skillKey: 'verbal',
    difficulty: 0.4,
  },
});
const INVITE = (status: 'pending' | 'cancelled') => ({
  id: uid(11),
  roles: ['recruiter'],
  workspaceId: null,
  status,
  membershipId: null,
  invitedBy: uid(6),
  createdAt: NOW,
});
const LOCK = {
  id: uid(12),
  settingKey: 'paste_written',
  lockedValue: 'blocked',
  lockedBy: uid(6),
  lockedAt: NOW,
};
const IMPORT_JOB = (status: 'open' | 'completed') => ({
  id: uid(9),
  workspaceId: uid(4),
  sourceKind: 'xlsx',
  templateVersion: 'trace-items-v1',
  status,
  rowsTotal: 0,
  rowsOk: 0,
  rowsError: 0,
  imagesOk: 0,
  createdAt: NOW,
  completedAt: status === 'open' ? null : NOW,
});

describe('M1 endpoints: answers are parsed with their contract (R5-53 c)', () => {
  it('submit, review and retire answer the item detail', async () => {
    const { api } = harness(() => json(DETAIL('in_review')));
    const submitted = await m1.submitBankItemVersion(api, uid(2));
    expect(submitted.ok && submitted.data.status).toBe('in_review');
    const approved = harness(() => json(DETAIL('approved')));
    const reviewed = await m1.reviewBankItemVersion(approved.api, {
      itemVersionId: uid(2),
      decision: 'approve',
    });
    expect(reviewed.ok && reviewed.data.status).toBe('approved');
    const retired = harness(() => json(DETAIL('retired')));
    const done = await m1.retireBankItemVersion(retired.api, uid(2));
    expect(done.ok && done.data.status).toBe('retired');
  });

  it('a created item version must be a draft', async () => {
    const draft = harness(() => json(DETAIL('draft'), 201));
    expect((await m1.createBankItem(draft.api, MCQ_DRAFT)).ok).toBe(true);
    const wrong = harness(() => json(DETAIL('approved'), 201));
    expect(await m1.createBankItem(wrong.api, MCQ_DRAFT)).toEqual({
      ok: false,
      code: 'invalid_response',
    });
  });

  it('DELETE …/integrity-locks/:settingKey answers 204 with no body', async () => {
    const { api } = harness(() => new Response(null, { status: 204 }));
    expect(await m1.deleteIntegrityLock(api, 'paste_written')).toEqual({
      ok: true,
      data: undefined,
    });
    const withBody = harness(() => json(LOCK));
    expect(await m1.deleteIntegrityLock(withBody.api, 'paste_written')).toEqual({
      ok: false,
      code: 'invalid_response',
    });
  });

  it('DELETE …/members/invites/:inviteId answers the invite with status cancelled', async () => {
    const { api } = harness(() => json(INVITE('cancelled')));
    const res = await m1.cancelMemberInvite(api, uid(11));
    expect(res.ok && res.data.status).toBe('cancelled');
    const still = harness(() => json(INVITE('pending')));
    expect(await m1.cancelMemberInvite(still.api, uid(11))).toEqual({
      ok: false,
      code: 'invalid_response',
    });
  });

  it('a new invite is pending and a new lock is the stored lock view', async () => {
    const invite = harness(() => json(INVITE('pending'), 201));
    const made = await m1.createMemberInvite(invite.api, {
      email: 'person@example.test',
      roles: ['recruiter'],
      displayName: 'Synthetic Person',
    });
    expect(made.ok && made.data.status).toBe('pending');
    const lock = harness(() => json(LOCK, 201));
    const locked = await m1.createIntegrityLock(lock.api, {
      settingKey: 'paste_written',
      lockedValue: 'blocked',
    });
    expect(locked.ok && locked.data.settingKey).toBe('paste_written');
  });

  it('a new import job is open; complete and cancel answer the job', async () => {
    const open = harness(() => json(IMPORT_JOB('open'), 201));
    const created = await m1.createImportJob(open.api, {
      sourceKind: 'xlsx',
      templateVersion: 'trace-items-v1',
    });
    expect(created.ok && created.data.status).toBe('open');
    const done = harness(() => json(IMPORT_JOB('completed')));
    const completed = await m1.completeImportJob(done.api, uid(9));
    expect(completed.ok && completed.data.status).toBe('completed');
    const notOpen = harness(() => json(IMPORT_JOB('completed'), 201));
    expect(
      await m1.createImportJob(notOpen.api, {
        sourceKind: 'xlsx',
        templateVersion: 'trace-items-v1',
      }),
    ).toEqual({ ok: false, code: 'invalid_response' });
  });

  it('the rows answer carries accepted and every bad row, and the image answer its key', async () => {
    const rows = harness(() =>
      json({ accepted: 0, errors: [{ rowNo: 2, field: 'stem', code: 'missing_field' }] }),
    );
    const res = await m1.postImportRows(rows.api, uid(9), { rows: [IMPORT_ROW] });
    expect(res.ok && res.data.errors).toEqual([{ rowNo: 2, field: 'stem', code: 'missing_field' }]);
    const image = harness(() => json({ key: `item-media/${ORG}/${SHA}.png` }));
    const put = await m1.putImportImage(image.api, uid(9), SHA, 'image/png', new Uint8Array([1]));
    expect(put.ok && put.data.key).toBe(`item-media/${ORG}/${SHA}.png`);
  });

  it('list answers are keyset pages and a malformed cursor in an answer is invalid_response', async () => {
    const page = harness(() => json({ templates: [], nextCursor: CURSOR }));
    const ok = await m1.listRoleTemplates(page.api);
    expect(ok.ok && ok.data.nextCursor).toBe(CURSOR);
    const bad = harness(() => json({ templates: [], nextCursor: 'not-a-cursor' }));
    expect(await m1.listRoleTemplates(bad.api)).toEqual({ ok: false, code: 'invalid_response' });
  });

  it('an api error body keeps its constant code (library cap) and anything else is unavailable', async () => {
    const capped = harness(() => json({ error: { code: 'library_cap' } }, 429));
    expect(await m1.copyLibraryItems(capped.api, { libraryItemVersionIds: [uid(7)] })).toEqual({
      ok: false,
      code: 'library_cap',
    });
    const odd = harness(() => new Response('<html>boom</html>', { status: 502 }));
    expect(await m1.bankStats(odd.api)).toEqual({ ok: false, code: 'unavailable' });
  });
});
