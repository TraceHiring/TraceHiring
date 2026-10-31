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
import type { StoredEvent } from './session-evidence.js';
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
  MCQ,
  paste,
  POOL,
  POSITIONS,
  SECTION_SECONDS,
  serveCore,
  startCore,
  startCoreV2,
  startInput,
  tabHidden,
  text,
  v2ItemVersion,
  WRITTEN,
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
    served(await h.core.item(AUTH, 1));
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

  it('a resend after a lost ack lists the refused seqs again, within one batch of the high-water mark (R5-67)', async () => {
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);
    served(await h.core.item(AUTH, 1));
    const batch = [choice(1, 1, 'a'), choice(2, 2, 'b')]; // position 2 is not served: refused (R5-59 b)
    expect(await h.core.events(AUTH, { streamId: v.streamId, events: batch })).toMatchObject({
      ok: true,
      ackSeq: 2,
      refusedSeqs: [2],
    });
    // The ack was lost: the same seqs come again, alone or with new ones; each refused seq is listed once.
    expect(await h.core.events(AUTH, { streamId: v.streamId, events: batch })).toMatchObject({
      ok: true,
      ackSeq: 2,
      refusedSeqs: [2],
    });
    expect(
      await h.core.events(AUTH, {
        streamId: v.streamId,
        events: [...batch, choice(2, 2, 'b'), choice(3, 2, 'c'), choice(4, 1, 'd')],
      }),
    ).toMatchObject({ ok: true, ackSeq: 4, refusedSeqs: [2, 3] });
    // An accepted seq resent is never listed.
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [choice(4, 1, 'd')] }),
    ).toEqual(expect.not.objectContaining({ refusedSeqs: expect.anything() }));
    // A resend's seqs lie within one batch (≤ 100 events) of the mark: older refusals are forgotten.
    await h.core.events(AUTH, {
      streamId: v.streamId,
      events: Array.from({ length: 100 }, (_v, i) => heartbeat(5 + i)),
    });
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [choice(3, 2, 'c')] }),
    ).toEqual(expect.not.objectContaining({ refusedSeqs: expect.anything() }));
    expect((await view(h)).answers).toEqual([{ position: 1, choice: 'd' }]);
  });

  it('events up to GRACE_MS after a section deadline count; later ones are refused; reads close at once', async () => {
    const h = await coreHarness(pkgOf(true));
    const t0 = h.clock.ms;
    const { view: v } = await startCoreV2(h);
    const deadline = t0 + SECTION_SECONDS * 1000;
    // Positions 1 and 2 are served before the deadline: the late answers are judged on the clock alone (R5-59 b).
    served(await h.core.item(AUTH, 1));
    served(await h.core.item(AUTH, 2));

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

// ---- fix round 1 (R5-59, M1 wave 2 first reviews of A4) -----------------------------------------------------------

const storedEvents = (h: CoreHarness): StoredEvent[] =>
  [...h.kv.list<StoredEvent>({ prefix: 'ev:' })].map(([, e]) => e);

const finalPositions = (h: CoreHarness): number[] =>
  (
    JSON.parse(objectText(h.evidence, evidenceKeys(ORG, SESSION).final)) as {
      answers: { position: number }[];
    }
  ).answers.map((a) => a.position);

const ndjson = (h: CoreHarness): Record<string, unknown>[] =>
  objectText(h.evidence, evidenceKeys(ORG, SESSION).events)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('answers only to served positions (R5-59 b)', () => {
  it('an answer at an unserved position of a free section is acked, refused, stored as refused, never final', async () => {
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);
    served(await h.core.item(AUTH, 1));
    // Position 2 is drawn (the untimed pool section is open) but was never served.
    expect(
      await h.core.events(AUTH, {
        streamId: v.streamId,
        events: [choice(1, 2, 'a'), choice(2, 1, 'b')],
      }),
    ).toMatchObject({ ok: true, ackSeq: 2, refusedSeqs: [1] });
    expect(storedEvents(h).map((e) => [e.seq, e.refused ?? false])).toEqual([
      [1, true],
      [2, false],
    ]);
    const after = await view(h);
    expect(after.answers).toEqual([{ position: 1, choice: 'b' }]);

    // The attach above opened a new stream (nothing sent on it yet).
    expect((await h.core.submit(AUTH, { streamId: after.streamId, finalSeq: 0 })).ok).toBe(true);
    expect(finalPositions(h)).toEqual([1]);
    expect(SessionMirrorMessageV2.parse(h.queue.sent[0]).replay).toBe('ok');
  });

  it('forward-only: an answer at the next position (highest served + 1) before it is served is refused', async () => {
    const [first, second] = POSITIONS[FORWARD];
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);
    // Nothing served yet: even the section's first position is refused.
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [text(1, first, 0, 0, 'early')] }),
    ).toMatchObject({ ok: true, ackSeq: 1, refusedSeqs: [1] });
    served(await h.core.item(AUTH, first, 1));
    expect(
      await h.core.events(AUTH, {
        streamId: v.streamId,
        events: [text(2, second, 0, 0, 'ahead'), text(3, first, 0, 0, 'kept')],
      }),
    ).toMatchObject({ ok: true, ackSeq: 3, refusedSeqs: [2] });
    expect((await view(h)).answers).toEqual([{ position: first, text: 'kept' }]);
  });

  it('a package v1 session refuses an answer at a position it has not served, too', async () => {
    const h = await coreHarness(makePackage());
    const { view: v } = await startCore(h);
    await serveCore(h, [MCQ]);
    expect(
      await h.core.events(AUTH, {
        streamId: v.streamId,
        events: [text(1, WRITTEN, 0, 0, 'unserved'), choice(2, MCQ, 'a')],
      }),
    ).toMatchObject({ ok: true, ackSeq: 2, refusedSeqs: [1] });
    expect(storedEvents(h).find((e) => e.seq === 1)?.refused).toBe(true);
    // An unknown position is still a bad batch (RT-13), not a refusal.
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [text(3, 9, 0, 0, 'x')] }),
    ).toEqual({ ok: false, error: 'bad_request' });

    await h.core.submit(AUTH, { streamId: v.streamId, finalSeq: 2 });
    expect(finalPositions(h)).toEqual([MCQ]);
  });

  it('final.json positions are a subset of the mirror served positions (the jobs map answers through served[])', async () => {
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);
    served(await h.core.item(AUTH, 1));
    served(await h.core.item(AUTH, 6));
    const events = [1, 2, 3, 6, 7].map((position, k) =>
      choice(k + 1, position, position < 6 ? 'a' : 'x'),
    );
    expect(await h.core.events(AUTH, { streamId: v.streamId, events })).toMatchObject({
      ok: true,
      refusedSeqs: [2, 3, 5],
    });
    // Defence in depth: an accepted edit at an unserved position (an older object's state) is dropped at finalise.
    h.kv.put('ev:0000001000', {
      gseq: 1000,
      streamId: v.streamId,
      seq: 99,
      t: 0,
      tServer: h.clock.ms,
      body: { kind: 'answer.choice', item: 7, option: 'y' },
    } satisfies StoredEvent);
    h.kv.put('ans:7', { kind: 'choice', choice: 'y', gseq: 1000 });

    await h.core.submit(AUTH, { streamId: v.streamId, finalSeq: 5 });
    const message = SessionMirrorMessageV2.parse(h.queue.sent[0]);
    const servedPositions = new Set(message.served.map((r) => r.position));
    expect([...servedPositions].sort((a, b) => a - b)).toEqual([1, 6]);
    expect(finalPositions(h)).toEqual([1, 6]);
    for (const position of finalPositions(h)) expect(servedPositions.has(position)).toBe(true);
  });
});

describe('two positions: session-wide and draw (R5-59 a)', () => {
  it('two pool sections: served positions are session-wide; 1 + index in draws[] is the draw position', async () => {
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);
    for (const position of [...POSITIONS[POOL], ...POSITIONS[FORWARD]]) {
      served(await h.core.item(AUTH, position));
    }
    const second = POSITIONS[FORWARD][1];
    await h.core.events(AUTH, {
      streamId: v.streamId,
      events: [text(1, second, 0, 0, 'answer'), paste(2, second, 6)],
    });
    await h.core.submit(AUTH, { streamId: v.streamId, finalSeq: 2 });
    const message = SessionMirrorMessageV2.parse(h.queue.sent[0]);

    const firstSlot: Record<string, number> = { [POOL]: 1, [FORWARD]: POSITIONS[FORWARD][0] };
    const count: Record<string, number> = { [POOL]: 3, [FORWARD]: 2 };
    expect(message.poolSectionIds).toEqual([POOL, FORWARD]);
    expect(message.served.map((r) => r.position)).toEqual([1, 2, 3, 4, 5]);
    for (const row of message.served) {
      const draw = message.draws.find((d) => d.sectionId === row.sectionId);
      const index = draw?.itemVersionIds.indexOf(row.itemVersionId) ?? -1;
      expect(index).toBeGreaterThanOrEqual(0);
      // The k-th drawn item sits at the section's first slot + k (session-wide position)...
      expect(row.position).toBe((firstSlot[row.sectionId] ?? 0) + index);
      // ...and its draw position (session_items.position, R5-42) is 1 + k, within the draw count.
      expect(index + 1).toBeLessThanOrEqual(count[row.sectionId] ?? 0);
    }
    // final.json and events.ndjson use the session-wide position too.
    expect(finalPositions(h)).toEqual([second]);
    expect(ndjson(h).find((l) => l.sig === 'paste')).toMatchObject({ item: second });
  });
});

describe('captureSignals (R5-59 c, §6.7 data minimisation)', () => {
  it('a signal kind outside captureSignals is acked but never stored nor in events.ndjson', async () => {
    const pkg = makePackageV2(
      {},
      { captureSignals: ['paste', 'drop', 'untrusted_input', 'fullscreen_exit'] },
    );
    const h = await coreHarness(pkg);
    const { view: v } = await startCoreV2(h);
    expect(
      await h.core.events(AUTH, {
        streamId: v.streamId,
        events: [tabHidden(1, null, 5_000), heartbeat(2), paste(3, null, 4), tabHidden(4, null, 9)],
      }),
    ).toEqual(expect.objectContaining({ ok: true, ackSeq: 4 }));
    expect(storedEvents(h).map((e) => [e.seq, e.body.kind])).toEqual([
      [2, 'heartbeat'],
      [3, 'signal'],
    ]);
    // Acked: a resend is a duplicate, the next seq follows the high-water mark.
    expect(
      await h.core.events(AUTH, {
        streamId: v.streamId,
        events: [tabHidden(4, null, 9), heartbeat(5)],
      }),
    ).toMatchObject({ ok: true, ackSeq: 5 });

    await h.core.submit(AUTH, { streamId: v.streamId, finalSeq: 5 });
    const lines = ndjson(h);
    expect(lines.some((l) => l.sig === 'tab_hidden')).toBe(false);
    expect(lines.map((l) => l.sig ?? l.kind)).toEqual(['heartbeat', 'paste', 'heartbeat']);
  });

  it('a captured tab_hidden is stored as before', async () => {
    const h = await coreHarness(pkgOf());
    const { view: v } = await startCoreV2(h);
    await h.core.events(AUTH, { streamId: v.streamId, events: [tabHidden(1, null, 5_000)] });
    expect(storedEvents(h).map((e) => e.body.kind)).toEqual(['signal']);
  });
});

describe('a GET for a section not entered (R5-59 d)', () => {
  it('409 out_of_order when afterSeq is ahead of the high-water mark; 400 otherwise; 200 after the finish', async () => {
    const h = await coreHarness(pkgOf(true));
    const { view: v } = await startCoreV2(h);
    const s2 = POSITIONS[FORWARD][0];
    // The client enqueued section.finish(S1) as seq 1 and asks for S2's first position before the batch lands.
    expect(await h.core.item(AUTH, s2, 1)).toEqual({
      ok: false,
      error: 'out_of_order',
      ackSeq: 0,
    });
    expect(await h.core.item(AUTH, s2, 0)).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await h.core.item(AUTH, s2)).toMatchObject({ ok: false, error: 'bad_request' });
    expect(
      await h.core.events(AUTH, { streamId: v.streamId, events: [finish(1, POOL)] }),
    ).toMatchObject({ ok: true, ackSeq: 1 });
    expect(served(await h.core.item(AUTH, s2, 1)).position).toBe(s2);
  });
});

describe('the served-item cap at start (R5-9, R5-59)', () => {
  it('a package v2 with 101 served slots is refused at start and nothing is stored', async () => {
    const base = pkgOf();
    // 3 (pool) + 2 (forward) + 96 inline items = 101 served slots.
    const inline = Array.from({ length: 96 }, (_, k) => ({
      sectionId: INLINE,
      itemVersionId: v2ItemVersion(3, k + 1),
      itemId: `abababab-abab-4bab-8bab-${String(k + 1).padStart(12, '0')}`,
      kind: 'mcq' as const,
      prompt: `[synthetic] inline question ${k + 1}?`,
      options: [
        { id: 'x', label: '[synthetic] x' },
        { id: 'y', label: '[synthetic] y' },
      ],
      exposureAtPublish: 0,
    }));
    const pkg = {
      ...base,
      items: [...base.items.filter((i) => i.sectionId !== INLINE), ...inline],
    };
    const h = await coreHarness(pkg);
    expect(await h.core.start(startInput(h.sha256))).toMatchObject({
      ok: false,
      error: 'unavailable',
      pkg: 'schema',
    });
    expect([...h.kv.list({ prefix: '' })]).toEqual([]);
  });
});
