// AT-M1-19 through the real app (R5-9, R5-20, R5-45): a package v2 session answers the v2 start, attach and item
// shapes; an item GET carries `afterSeq` and answers 409 `out_of_order` with `ackSeq` or 410 `section_closed`; an events
// ack lists `refusedSeqs`. Every answer parses against its contract. Synthetic data only.
import {
  EventBatchAck,
  OutOfOrderBody,
  ServedItemV2,
  SessionAttachResV2,
  SessionStartResV2,
} from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import {
  finish,
  FORWARD,
  makePackageV2,
  POOL,
  POSITIONS,
  postEvents,
  sessionHarness,
  text,
} from './session.test-helpers.js';

const [FIRST, SECOND] = POSITIONS[FORWARD];

const v2Harness = async () => {
  const h = await sessionHarness({ pkg: makePackageV2() });
  const { token, res } = await h.startSession();
  const started = SessionStartResV2.parse(await res.json());
  if (!('view' in started)) throw new Error('no view');
  return { h, token, view: started.view };
};

describe('package v2 session routes', () => {
  it('start and attach answer the v2 view', async () => {
    const { h, token, view } = await v2Harness();
    expect(view.v).toBe(2);
    expect(view.sections.map((s) => s.id)).toEqual(makePackageV2().sections.map((s) => s.id));
    const attached = await h.request('POST', '/v1/session/attach', { token, json: {} });
    expect(attached.status).toBe(200);
    expect(SessionAttachResV2.parse(await attached.json()).view.v).toBe(2);
  });

  it('serves a v2 item, with options in served order and images by hash only', async () => {
    const { h, token } = await v2Harness();
    const res = await h.request('GET', '/v1/session/items/1', { token });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const item = ServedItemV2.parse(await res.json());
    expect(item).toMatchObject({ position: 1, sectionId: POOL, kind: 'mcq' });
    expect(item.media?.[0]).toEqual({
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      alt: expect.any(String),
    });
  });

  it('forward-only: 409 out_of_order with ackSeq until afterSeq is accepted, then 410 section_closed behind', async () => {
    const { h, token, view } = await v2Harness();
    expect(
      (await h.request('GET', `/v1/session/items/${FIRST}?afterSeq=0`, { token })).status,
    ).toBe(200);
    const early = await h.request('GET', `/v1/session/items/${SECOND}?afterSeq=1`, { token });
    expect(early.status).toBe(409);
    expect(OutOfOrderBody.parse(await early.json())).toEqual({ error: 'out_of_order', ackSeq: 0 });

    const ack = await postEvents(h, token, view.streamId, [text(1, FIRST, 0, 0, 'draft')]);
    expect(EventBatchAck.parse(await ack.json())).toMatchObject({ ackSeq: 1 });
    expect(
      (await h.request('GET', `/v1/session/items/${SECOND}?afterSeq=1`, { token })).status,
    ).toBe(200);

    const behind = await h.request('GET', `/v1/session/items/${FIRST}?afterSeq=1`, { token });
    expect(behind.status).toBe(410);
    expect(await behind.json()).toEqual({ error: 'section_closed' });

    const refused = await postEvents(h, token, view.streamId, [
      text(2, FIRST, 0, 5, 'other'),
      finish(3, POOL),
    ]);
    expect(refused.status).toBe(200);
    expect(EventBatchAck.parse(await refused.json())).toMatchObject({
      ackSeq: 3,
      refusedSeqs: [2],
    });
  });

  it('a batch that stops at a gap still lists the refusedSeqs of the part it kept (R5-67)', async () => {
    const { h, token, view } = await v2Harness();
    expect(
      (await h.request('GET', `/v1/session/items/${FIRST}?afterSeq=0`, { token })).status,
    ).toBe(200);
    // Seq 1 answers a served item, seq 2 answers an unserved one (refused, R5-59 b), seq 4 leaves a gap.
    const gap = await postEvents(h, token, view.streamId, [
      text(1, FIRST, 0, 0, 'draft'),
      text(2, SECOND, 0, 0, 'early'),
      text(4, FIRST, 5, 0, ' more'),
    ]);
    expect(gap.status).toBe(409);
    expect(OutOfOrderBody.parse(await gap.json())).toEqual({
      error: 'out_of_order',
      ackSeq: 2,
      refusedSeqs: [2],
    });
    // A gap with nothing refused keeps the D1 body.
    const plain = await postEvents(h, token, view.streamId, [text(4, FIRST, 5, 0, ' more')]);
    expect(plain.status).toBe(409);
    expect(await plain.json()).toEqual({ error: 'out_of_order', ackSeq: 2 });
  });

  it('a malformed afterSeq is a bad request; an accepted batch without refusals has no refusedSeqs', async () => {
    const { h, token, view } = await v2Harness();
    expect(
      (await h.request('GET', `/v1/session/items/${FIRST}?afterSeq=-1`, { token })).status,
    ).toBe(400);
    expect((await h.request('GET', `/v1/session/items/1?afterSeq=1e3`, { token })).status).toBe(
      400,
    );
    expect(
      (await h.request('GET', `/v1/session/items/${FIRST}?afterSeq=0`, { token })).status,
    ).toBe(200);
    const ack = await postEvents(h, token, view.streamId, [text(1, FIRST, 0, 0, 'x')]);
    expect(await ack.json()).not.toHaveProperty('refusedSeqs');
  });
});
