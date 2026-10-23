// AT-M1-19 (specs/m1-test-authoring.md §4.6, §6.5; R5-9, R5-19, R5-20, R5-45): server-side delivery of a package v2.
// The draw is made with drawSection(pkgSection, items, drawSeed(session, section)) when a section opens and stored
// before its first serve; a reload or a second device reads it and never re-draws; a section never opened is never
// drawn. Sections run `not_entered -> open -> closed` (timed in position order, untimed all together); the DO clock
// decides every deadline; `section.finish` closes a section for good. No batch is refused for navigation: an answer for
// a closed section, or below the highest served position of a forward-only section, is acknowledged and listed in
// `refusedSeqs` and never changes the final answer. A package v1 is still served as D1. Synthetic data only.
import { drawSection, drawSeed } from '@trace/item-delivery';
import {
  checkMirrorV2,
  ServedItemV2,
  SessionMirrorMessageV2,
  SessionViewV2,
} from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import { objectText } from './edge.test-helpers.js';
import { evidenceKeys, GRACE_MS, type ItemResult } from './session-core.js';
import { DRAW_PREFIX, type StoredDraw } from './session-core-v2.js';
import {
  AUTH,
  choice,
  coreHarness,
  DURATION_SECONDS,
  finish,
  FORWARD,
  heartbeat,
  INLINE,
  makePackage,
  makePackageV2,
  POOL,
  POSITIONS,
  SECTION_SECONDS,
  startCore,
  startCoreV2,
  text,
  type CoreHarness,
} from './session.test-helpers.js';
import { ORG, SESSION } from './token.test-helpers.js';

const draws = (h: CoreHarness): StoredDraw[] =>
  [...h.kv.list<StoredDraw>({ prefix: DRAW_PREFIX })].map(([, d]) => d);
const drawOf = (h: CoreHarness, sectionId: string): StoredDraw | undefined =>
  draws(h).find((d) => d.sectionId === sectionId);

const served = (out: ItemResult) => {
  if (!out.ok || !('v2' in out)) throw new Error(`item refused: ${JSON.stringify(out)}`);
  return ServedItemV2.parse(out.v2);
};

const view = async (h: CoreHarness) => {
  const out = await h.core.attach(AUTH);
  if (!out.ok) throw new Error('attach refused');
  return SessionViewV2.parse(out.view);
};

const pkgOf = (timed = false) => makePackageV2({ timed });

describe('the draw (AT-M1-19, §6.5)', () => {
  it('draws every section of an untimed version at start, exactly as drawSection with the session seed', async () => {
    const pkg = pkgOf();
    const h = await coreHarness(pkg);
    await startCoreV2(h);

    expect(draws(h).map((d) => d.sectionId)).toEqual([POOL, FORWARD, INLINE]);
    for (const section of pkg.sections) {
      const expected = drawSection(section, pkg.items, await drawSeed(SESSION, section.id));
      expect(drawOf(h, section.id)?.items).toEqual(expected.items);
    }
    expect(drawOf(h, POOL)?.items).toHaveLength(3);
    expect(drawOf(h, FORWARD)?.items).toHaveLength(2);
    // An inline section serves all its items in package order.
    expect(drawOf(h, INLINE)?.items.map((i) => i.itemVersionId)).toEqual(
      pkg.items.filter((i) => i.sectionId === INLINE).map((i) => i.itemVersionId),
    );
  });

  it('serves each position from the stored draw: variant prompt, options in served order, images by hash', async () => {
    const pkg = pkgOf();
    const h = await coreHarness(pkg);
    await startCoreV2(h);
    const draw = drawOf(h, POOL);
    if (draw === undefined) throw new Error('no draw');

    for (const [k, position] of POSITIONS[POOL].entries()) {
      const drawn = draw.items[k];
      if (drawn === undefined) throw new Error('short draw');
      const source = pkg.items.find((i) => i.itemVersionId === drawn.itemVersionId);
      if (source === undefined) throw new Error('unknown item');
      const variant = drawn.variantIndex === null ? null : source.variants?.[drawn.variantIndex];
      const options = variant?.options ?? source.options ?? [];
      const item = served(await h.core.item(AUTH, position));
      expect(item).toEqual({
        position,
        kind: 'mcq',
        sectionId: POOL,
        prompt: variant?.prompt ?? source.prompt,
        options: (drawn.optionOrder ?? []).map((id) => options.find((o) => o.id === id)),
        media: source.media?.map((m) => ({ hash: m.hash, alt: m.alt })),
        ...(drawn.variantId === null ? {} : { variantId: drawn.variantId }),
        servedAt: new Date(h.clock.ms).toISOString(),
      });
    }
    const written = served(await h.core.item(AUTH, POSITIONS[FORWARD][0]));
    expect(written).toMatchObject({ kind: 'written', sectionId: FORWARD, maxChars: 500 });
    expect(written.options).toBeUndefined();
  });

  it('a reload and a second device read the stored draw and never draw again', async () => {
    const h = await coreHarness(pkgOf());
    await startCoreV2(h);
    const before = draws(h);
    const first = served(await h.core.item(AUTH, 1));

    // Poison the stored seeds: a re-draw would now fail or differ.
    for (const [key] of h.kv.list({ prefix: 'seed' })) h.kv.put(key, 'not-a-seed');
    h.clock.ms += 5_000;
    expect((await h.core.attach(AUTH)).ok).toBe(true);
    const second = await startCoreV2(h, { nonce: 'session-nonce-0002-abcdef' });
    const auth2 = { ...AUTH, nonce: 'session-nonce-0002-abcdef' };
    const again = served(await h.core.item(auth2, 1));

    expect(draws(h)).toEqual(before);
    expect(again).toEqual(first);
    expect(second.view.items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('a timed version draws section 1 at start only; a section never opened is never drawn', async () => {
    const h = await coreHarness(pkgOf(true));
    await startCoreV2(h);
    expect(draws(h).map((d) => d.sectionId)).toEqual([POOL]);

    h.clock.ms += 10_000;
    expect(
      (await h.core.submit(AUTH, { streamId: (await view(h)).streamId, finalSeq: 0 })).ok,
    ).toBe(true);
    expect(draws(h).map((d) => d.sectionId)).toEqual([POOL]);
    await h.core.alarm();
    const message = SessionMirrorMessageV2.parse(h.queue.sent[0]);
    expect(message.draws.map((d) => d.sectionId)).toEqual([POOL]);
  });
});

describe('the session view v2 (§4.6)', () => {
  it('an untimed version: every section open, no section deadline, positions by section order', async () => {
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);

    expect(v.v).toBe(2);
    expect(v.sections).toEqual([
      expect.objectContaining({ id: POOL, state: 'open', navigation: 'free', format: 'mcq' }),
      expect.objectContaining({
        id: FORWARD,
        state: 'open',
        navigation: 'forward_only',
        format: 'written',
        pasteRule: 'allowed_logged',
      }),
      expect.objectContaining({ id: INLINE, state: 'open', navigation: 'free' }),
    ]);
    expect(v.sections.every((s) => s.deadlineAt === undefined)).toBe(true);
    expect(v.items.map((i) => [i.position, i.sectionId, i.kind, i.servedAt])).toEqual([
      [1, POOL, 'mcq', null],
      [2, POOL, 'mcq', null],
      [3, POOL, 'mcq', null],
      [4, FORWARD, 'written', null],
      [5, FORWARD, 'written', null],
      [6, INLINE, 'mcq', null],
      [7, INLINE, 'mcq', null],
    ]);
  });

  it('a timed version runs in position order with deadlines from the DO clock', async () => {
    const h = await coreHarness(pkgOf(true));
    const t0 = h.clock.ms;
    const { view: v } = await startCoreV2(h);

    expect(v.sections.map((s) => [s.state, s.deadlineAt])).toEqual([
      ['open', new Date(t0 + SECTION_SECONDS * 1000).toISOString()],
      ['not_entered', undefined],
      ['not_entered', undefined],
    ]);
    // The alarm is the earlier of the next section deadline and the test deadline (+ grace).
    expect(h.alarm.at).toBe(t0 + SECTION_SECONDS * 1000);

    // The section deadline passes: the next section opens then, and is drawn by the alarm before any serve.
    h.clock.ms = t0 + SECTION_SECONDS * 1000;
    await h.core.alarm();
    expect(draws(h).map((d) => d.sectionId)).toEqual([POOL, FORWARD]);
    const later = await view(h);
    expect(later.sections.map((s) => [s.state, s.deadlineAt])).toEqual([
      ['closed', new Date(t0 + SECTION_SECONDS * 1000).toISOString()],
      ['open', new Date(t0 + 2 * SECTION_SECONDS * 1000).toISOString()],
      ['not_entered', undefined],
    ]);
    expect(h.alarm.at).toBe(t0 + 2 * SECTION_SECONDS * 1000);
  });

  it('a section that opened and closed while no request came is still drawn (it was entered)', async () => {
    const h = await coreHarness(pkgOf(true));
    const t0 = h.clock.ms;
    await startCoreV2(h);
    h.clock.ms = t0 + 2 * SECTION_SECONDS * 1000 + 5_000;
    const v = await view(h);
    expect(v.sections.map((s) => s.state)).toEqual(['closed', 'closed', 'open']);
    expect(draws(h).map((d) => d.sectionId)).toEqual([POOL, FORWARD, INLINE]);
  });
});

describe('section.finish and section deadlines (§4.6, R5-20)', () => {
  it('section.finish closes a timed section for good and opens the next one at once', async () => {
    const h = await coreHarness(pkgOf(true));
    const t0 = h.clock.ms;
    const { view: v } = await startCoreV2(h);
    h.clock.ms = t0 + 30_000;
    const ack = await h.core.events(AUTH, {
      streamId: v.streamId,
      events: [choice(1, 1, 'a'), finish(2, POOL), choice(3, 2, 'b')],
    });
    expect(ack).toMatchObject({ ok: true, ackSeq: 3, refusedSeqs: [3] });

    // A finished section keeps its own deadline (opened + time limit); the next one runs from the finish.
    const after = await view(h);
    expect(after.sections.map((s) => [s.state, s.deadlineAt])).toEqual([
      ['closed', new Date(t0 + SECTION_SECONDS * 1000).toISOString()],
      ['open', new Date(t0 + 30_000 + SECTION_SECONDS * 1000).toISOString()],
      ['not_entered', undefined],
    ]);
    expect(await h.core.item(AUTH, 1)).toMatchObject({ ok: false, error: 'section_closed' });
    expect(after.answers).toEqual([{ position: 1, choice: 'a' }]);
    // A finish of a section that is not open changes nothing; it never reopens.
    expect(
      await h.core.events(AUTH, {
        // The attach above opened a new stream; its seqs start again at 1.
        streamId: after.streamId,
        events: [finish(1, POOL), finish(2, INLINE)],
      }),
    ).toMatchObject({ ok: true, ackSeq: 2 });
    expect((await view(h)).sections.map((s) => s.state)).toEqual(['closed', 'open', 'not_entered']);
  });

  it('untimed: section.finish closes that section only', async () => {
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);
    await h.core.events(AUTH, { streamId: v.streamId, events: [finish(1, INLINE)] });
    expect((await view(h)).sections.map((s) => s.state)).toEqual(['open', 'open', 'closed']);
    expect(await h.core.item(AUTH, 6)).toMatchObject({ ok: false, error: 'section_closed' });
    expect((await h.core.item(AUTH, 1)).ok).toBe(true);
  });

  it('events up to GRACE_MS after a section deadline count; later ones are refused; reads close at once', async () => {
    const h = await coreHarness(pkgOf(true));
    const t0 = h.clock.ms;
    const { view: v } = await startCoreV2(h);
    const deadline = t0 + SECTION_SECONDS * 1000;

    h.clock.ms = deadline + 1;
    expect(await h.core.item(AUTH, 1)).toMatchObject({ ok: false, error: 'section_closed' });
    h.clock.ms = deadline + GRACE_MS;
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [choice(1, 1, 'a')] }),
    ).toEqual(expect.not.objectContaining({ refusedSeqs: expect.anything() }));
    h.clock.ms = deadline + GRACE_MS + 1;
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [choice(2, 2, 'a')] }),
    ).toMatchObject({ ok: true, ackSeq: 2, refusedSeqs: [2] });

    const after = await view(h);
    expect(after.answers.map((a) => a.position)).toEqual([1]);
  });

  it('a signal or heartbeat is never refused for navigation, and an unknown section id is a bad batch', async () => {
    const h = await coreHarness(pkgOf(true));
    const { view: v } = await startCoreV2(h);
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [finish(1, POOL), heartbeat(2)] }),
    ).toEqual(expect.not.objectContaining({ refusedSeqs: expect.anything() }));
    expect(
      await h.core.events(AUTH, {
        streamId: v.streamId,
        events: [finish(3, '01010101-0101-4010-8010-010101010101')],
      }),
    ).toMatchObject({ ok: false, error: 'bad_request' });
  });
});

describe('forward-only navigation (R5-20, R5-45)', () => {
  const [first, second] = POSITIONS[FORWARD];

  it('serves the next position only once the accepted high-water mark reaches afterSeq', async () => {
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);
    expect(served(await h.core.item(AUTH, first, 0)).position).toBe(first);
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [text(1, first, 0, 0, 'draft')] }),
    ).toMatchObject({ ok: true, ackSeq: 1 });

    // The client enqueued seq 2 (more edits of item N) before asking for N+1: not yet accepted.
    expect(await h.core.item(AUTH, second, 2)).toEqual({
      ok: false,
      error: 'out_of_order',
      ackSeq: 1,
    });
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [text(2, first, 5, 0, ' one')] }),
    ).toMatchObject({ ok: true, ackSeq: 2 });
    expect(served(await h.core.item(AUTH, second, 2)).position).toBe(second);

    // Item N is now behind: its GET is 410 and a later edit is acknowledged as refused.
    expect(await h.core.item(AUTH, first, 2)).toEqual({ ok: false, error: 'section_closed' });
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [text(3, first, 0, 5, '')] }),
    ).toMatchObject({ ok: true, ackSeq: 3, refusedSeqs: [3] });
    // Re-reading the current position is fine (a reload).
    expect(served(await h.core.item(AUTH, second, 3)).position).toBe(second);

    const after = await view(h);
    expect(after.answers).toEqual([{ position: first, text: 'draft one' }]);
  });

  it('refused events advance the high-water mark like accepted ones', async () => {
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);
    served(await h.core.item(AUTH, first));
    served(await h.core.item(AUTH, second));
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [text(1, first, 0, 0, 'late')] }),
    ).toMatchObject({ ok: true, ackSeq: 1, refusedSeqs: [1] });
    expect(served(await h.core.item(AUTH, second, 1)).position).toBe(second);
  });

  it('never skips ahead: the first serve of a forward-only section is its first position', async () => {
    const h = await coreHarness(pkgOf());
    await startCoreV2(h);
    expect(await h.core.item(AUTH, second)).toMatchObject({ ok: false, error: 'bad_request' });
    expect(served(await h.core.item(AUTH, first)).position).toBe(first);
  });

  it('free sections serve any position in any order; afterSeq is not needed there', async () => {
    const h = await coreHarness(pkgOf());
    await startCoreV2(h);
    expect(served(await h.core.item(AUTH, 3, 99)).position).toBe(3);
    expect(served(await h.core.item(AUTH, 1)).position).toBe(1);
  });

  it('a position of a section not yet entered is a bad request; one outside the session too', async () => {
    const h = await coreHarness(pkgOf(true));
    await startCoreV2(h);
    expect(await h.core.item(AUTH, 4)).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await h.core.item(AUTH, 8)).toMatchObject({ ok: false, error: 'bad_request' });
  });
});

describe('the final answer and the mirror v2 (R5-19, R5-20, R5-42)', () => {
  it('refused edits never reach final.json; the replay is ok; the mirror carries draws and served rows', async () => {
    const pkg = pkgOf();
    const h = await coreHarness(pkg);
    const { view: v } = await startCoreV2(h);
    const [first, second] = POSITIONS[FORWARD];
    served(await h.core.item(AUTH, 1));
    served(await h.core.item(AUTH, first));
    await h.core.events(AUTH, {
      streamId: v.streamId,
      events: [text(1, first, 0, 0, 'kept'), choice(2, 1, 'a')],
    });
    served(await h.core.item(AUTH, second, 2));
    await h.core.events(AUTH, {
      streamId: v.streamId,
      events: [text(3, first, 0, 4, 'changed'), finish(4, INLINE), choice(5, 6, 'x')],
    });
    const submitted = await h.core.submit(AUTH, { streamId: v.streamId, finalSeq: 5 });
    expect(submitted.ok).toBe(true);

    const keys = evidenceKeys(ORG, SESSION);
    const final = JSON.parse(objectText(h.evidence, keys.final)) as {
      answers: { position: number; text?: string; choice?: string }[];
    };
    expect(final.answers.map((a) => [a.position, a.text ?? a.choice])).toEqual([
      [1, 'a'],
      [first, 'kept'],
    ]);

    const message = SessionMirrorMessageV2.parse(h.queue.sent[0]);
    expect(() => checkMirrorV2(message)).not.toThrow();
    expect(message).toMatchObject({ v: 2, replay: 'ok', poolSectionIds: [POOL, FORWARD] });
    const poolDraw = drawOf(h, POOL);
    expect(message.draws).toEqual([
      {
        sectionId: POOL,
        itemVersionIds: poolDraw?.items.map((i) => i.itemVersionId),
        itemVariantIds: poolDraw?.items.map((i) => i.variantId),
      },
      {
        sectionId: FORWARD,
        itemVersionIds: drawOf(h, FORWARD)?.items.map((i) => i.itemVersionId),
        itemVariantIds: [null, null],
      },
    ]);
    const firstPool = poolDraw?.items[0];
    expect(message.served).toEqual([
      {
        position: 1,
        itemVersionId: firstPool?.itemVersionId,
        servedAt: new Date(h.clock.ms).toISOString(),
        sectionId: POOL,
        ...(firstPool?.variantId === null ? {} : { itemVariantId: firstPool?.variantId }),
        optionOrder: firstPool?.optionOrder,
        drawSeedSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      expect.objectContaining({ position: first, sectionId: FORWARD }),
      expect.objectContaining({ position: second, sectionId: FORWARD }),
    ]);
    expect(message.served[1]).not.toHaveProperty('optionOrder');
  });

  it('nothing sent to the candidate carries a key, a storage path, exposure, a seed or another id (AT-M1-20)', async () => {
    const pkg = pkgOf();
    const h = await coreHarness(pkg);
    const out: unknown[] = [];
    const { view: v } = await startCoreV2(h);
    out.push(v);
    for (let p = 1; p <= 7; p += 1) {
      const item = await h.core.item(AUTH, p);
      if (item.ok) out.push(item);
      if (p === 4) await h.core.events(AUTH, { streamId: v.streamId, events: [heartbeat(1)] });
    }
    out.push(await h.core.events(AUTH, { streamId: v.streamId, events: [heartbeat(2)] }));
    out.push(await h.core.attach(AUTH));
    const wire = JSON.stringify(out);
    for (const banned of [
      'objectPath',
      'item-media/',
      'exposureAtPublish',
      'skillKey',
      'difficultyBand',
      'itemVersionId',
      'itemId',
      'seed',
      'correct',
      'answerKey',
      'ext',
      ...pkg.items.map((i) => i.itemVersionId),
    ]) {
      expect(wire).not.toContain(banned);
    }
  });
});

describe('package v1 sessions are unchanged (R5-9)', () => {
  it('a v1 package still answers the D1 view and item shapes', async () => {
    const h = await coreHarness(makePackage());
    const { view: v } = await startCore(h);
    expect(v).not.toHaveProperty('v');
    expect(v.pasteBlocked).toBe(true);
    const item = await h.core.item(AUTH, 1);
    expect(item).toMatchObject({ ok: true, item: { position: 1, kind: 'mcq' } });
    expect(draws(h)).toEqual([]);
    expect(h.alarm.at).toBe(h.clock.ms + DURATION_SECONDS * 1000 + GRACE_MS);
  });
});
