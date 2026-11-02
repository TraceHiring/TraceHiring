// Save and publish from the editor: publish is refused client-side without a valid cutoff (no request at all),
// otherwise the draft is saved first and then published with the draft's version id (specs/d1-demo-slice.md §6.1).
import { describe, expect, it } from 'vitest';
import { ApiClient, type FetchLike } from '../api/client';
import { addMcqItem, emptyDraft, type DraftForm } from './editor-model';
import { publishDraft, saveDraft } from './editor-actions';

const ORG = '11111111-1111-4111-8111-111111111111';
const TEST = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';

const DETAIL = {
  test: { id: TEST, name: 'Synthetic test', createdAt: '2026-10-19T10:00:00.000Z' },
  version: {
    id: VERSION,
    versionNo: 1,
    status: 'draft',
    durationMinutes: 30,
    qualityCutoff: 40,
    publishedAt: null,
    sections: [],
  },
};
const PUBLISHED = {
  testVersionId: VERSION,
  versionNo: 1,
  status: 'published',
  publishedAt: '2026-10-19T10:30:00.000Z',
  contentSha256: 'a'.repeat(64),
  qualityCutoff: 40,
};

function setup() {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const path = new URL(url).pathname;
    calls.push({
      method: String(init.method),
      path,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const body = path.endsWith('/publish') ? PUBLISHED : DETAIL;
    return Promise.resolve(
      new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
    );
  };
  const api = new ApiClient({
    origin: 'https://trace-api-staging.example-sub.workers.dev',
    orgId: ORG,
    getAccessToken: () => Promise.resolve('tok'),
    fetch: fetchImpl,
  });
  return { api, calls };
}

const form = (): DraftForm => addMcqItem(emptyDraft('Synthetic test'));

describe('saveDraft', () => {
  it('PUTs the contract-shaped draft with the cutoff as an integer', async () => {
    const { api, calls } = setup();
    const f = form();
    // Fill the one MCQ item so the draft passes the contract.
    f.mcq.items[0] = {
      format: 'mcq',
      prompt: 'Q?',
      options: [
        { id: 'o1', text: 'A' },
        { id: 'o2', text: 'B' },
      ],
      correctOptionId: 'o1',
    };
    f.qualityCutoff = '55';
    const res = await saveDraft(api, TEST, f);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PUT');
    expect((calls[0]?.body as { qualityCutoff: number }).qualityCutoff).toBe(55);
  });

  it('sends nothing for an invalid draft', async () => {
    const { api, calls } = setup();
    const res = await saveDraft(api, TEST, form()); // empty prompt
    expect(res).toEqual({ ok: false, code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });
});

describe('publishDraft', () => {
  it('is refused without a valid cutoff and sends no request', async () => {
    const { api, calls } = setup();
    const res = await publishDraft(api, TEST, VERSION, { ...form(), qualityCutoff: '' });
    expect(res).toEqual({ ok: false, code: 'cutoff_required' });
    expect(calls).toHaveLength(0);
  });

  it('saves first, then publishes the draft version', async () => {
    const { api, calls } = setup();
    const f = form();
    f.mcq.items[0] = {
      format: 'mcq',
      prompt: 'Q?',
      options: [
        { id: 'o1', text: 'A' },
        { id: 'o2', text: 'B' },
      ],
      correctOptionId: 'o1',
    };
    const res = await publishDraft(api, TEST, VERSION, f);
    expect(res.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path.split('/').slice(-1)[0]}`)).toEqual([
      `PUT ${TEST}`,
      'POST publish',
    ]);
    expect(calls[1]?.body).toEqual({ testVersionId: VERSION });
  });

  it('does not publish when the save fails', async () => {
    const { api, calls } = setup();
    const res = await publishDraft(api, TEST, VERSION, form()); // invalid draft
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
