// The v2 editor model (specs/m1-test-authoring.md §6.5; R5-53 b, R5-54 a): fromDraftView / toSaveTestDraftRequest
// round trips, including a D1 section whose navigation is null, and the section rules the editor enforces: pools with
// strata that add up to the draw count, navigation (a written section is forward-only), per-section timers, shuffle
// flags and the paste rule. Synthetic data only.
import { SaveTestDraftRequest, TestDraftView } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import {
  MAX_SECTIONS,
  addSection,
  addStratum,
  fromDraftView,
  moveSection,
  newSection,
  poolGap,
  removeSection,
  removeStratum,
  sectionIssues,
  setDrawCount,
  setFormat,
  setMode,
  setNavigation,
  setPasteRule,
  setPool,
  setShuffle,
  setTimeLimitMinutes,
  strataSum,
  toSaveTestDraftRequest,
  updateStratum,
  type EditorV2Form,
  type SectionForm,
} from './editor-v2-model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-23T10:00:00.000Z';

const mcqItem = (n: number) => ({
  id: ID(100 + n),
  position: n,
  format: 'mcq' as const,
  prompt: `Synthetic question ${n}?`,
  options: [
    { id: 'o1', text: 'First' },
    { id: 'o2', text: 'Second' },
  ],
  correctOptionId: 'o1',
});
const writtenItem = (n: number) => ({
  id: ID(200 + n),
  position: n,
  format: 'written' as const,
  prompt: 'Describe a synthetic situation.',
  rubric: {
    criteria: [{ id: 'c1', label: 'Clarity', maxPoints: 10, anchors: ['clear steps'], minHits: 1 }],
  },
});

const view = (sections: unknown[], status: 'draft' | 'published' = 'draft') =>
  TestDraftView.parse({
    test: { id: ID(1), workspaceId: ID(2), name: 'Synthetic test', createdAt: AT },
    version: {
      id: ID(3),
      versionNo: 2,
      status,
      durationMinutes: 40,
      qualityCutoff: 55,
      publishedAt: status === 'draft' ? null : AT,
      sections,
    },
  });

const d1Section = {
  id: ID(10),
  position: 1,
  mode: 'inline',
  format: 'mcq',
  name: 'Multiple choice',
  weight: 40,
  items: [mcqItem(1)],
  shuffleItems: false,
  shuffleOptions: false,
  navigation: null,
};
const poolSection = {
  id: ID(11),
  position: 2,
  mode: 'pool',
  format: 'mcq',
  name: 'Verbal',
  weight: 30,
  items: [],
  poolId: ID(50),
  drawCount: 10,
  shuffleItems: true,
  shuffleOptions: true,
  navigation: 'free',
  timeLimitSeconds: 600,
  blueprint: {
    strata: [
      { skillKey: 'verbal', difficultyBand: 1, count: 4 },
      { skillKey: 'verbal', difficultyBand: 3, count: 6 },
    ],
  },
};
const writtenSection = {
  id: ID(12),
  position: 3,
  mode: 'inline',
  format: 'written',
  name: 'Written answers',
  weight: 30,
  items: [writtenItem(1)],
  shuffleItems: false,
  shuffleOptions: false,
  navigation: 'forward_only',
  pasteRule: 'allowed_logged',
  timeLimitSeconds: 900,
};

const strip = <T extends { id?: string; position?: number }>(s: T) => {
  const { id: _id, position: _position, ...rest } = s;
  return rest;
};
/** The request a stored view stands for: its sections without ids and positions, items without theirs. */
const requestOf = (v: TestDraftView): SaveTestDraftRequest =>
  SaveTestDraftRequest.parse({
    name: v.test.name,
    durationMinutes: v.version.durationMinutes,
    qualityCutoff: v.version.qualityCutoff,
    sections: v.version.sections.map((s) => ({ ...strip(s), items: s.items.map(strip) })),
  });

const built = (form: EditorV2Form) => {
  const r = toSaveTestDraftRequest(form);
  if (!r.ok) throw new Error(`not built: ${r.reason}`);
  return r.request;
};

describe('fromDraftView / toSaveTestDraftRequest', () => {
  it('round-trips a v2 draft with a D1 section, a pool with strata and a written section', () => {
    const v = view([d1Section, poolSection, writtenSection]);
    const form = fromDraftView(v);
    expect(built(form)).toEqual(requestOf(v));
    expect(form.testId).toBe(ID(1));
    expect(form.workspaceId).toBe(ID(2));
    expect(form.versionId).toBe(ID(3));
    expect(form.status).toBe('draft');
  });

  it('keeps a D1 section as it is: navigation null, no M1 field', () => {
    const v = view([d1Section]);
    const form = fromDraftView(v);
    expect(form.sections[0]?.navigation).toBeNull();
    const request = built(form);
    expect(request.sections[0]?.navigation).toBeNull();
    expect(request.sections[0]).not.toHaveProperty('pasteRule');
    expect(request.sections[0]).not.toHaveProperty('blueprint');
    expect(request).toEqual(requestOf(v));
  });

  it('keeps inline items (content and keys) untouched, without ids and positions', () => {
    const request = built(fromDraftView(view([d1Section, writtenSection])));
    expect(request.sections[0]?.items[0]).toEqual({
      format: 'mcq',
      prompt: 'Synthetic question 1?',
      options: [
        { id: 'o1', text: 'First' },
        { id: 'o2', text: 'Second' },
      ],
      correctOptionId: 'o1',
    });
    expect(request.sections[1]?.items[0]?.format).toBe('written');
  });

  it('keeps an exact time limit that is not a whole minute when it is not edited', () => {
    const v = view([{ ...writtenSection, timeLimitSeconds: 100 }]);
    expect(built(fromDraftView(v)).sections[0]?.timeLimitSeconds).toBe(100);
  });

  it('reads a published version too (read-only status)', () => {
    expect(fromDraftView(view([d1Section], 'published')).status).toBe('published');
  });

  it('is never built without a valid cutoff', () => {
    const form = { ...fromDraftView(view([d1Section])), qualityCutoff: '' };
    expect(toSaveTestDraftRequest(form)).toEqual({ ok: false, reason: 'cutoff' });
    expect(toSaveTestDraftRequest({ ...form, qualityCutoff: '101' })).toEqual({
      ok: false,
      reason: 'cutoff',
    });
  });

  it('refuses an invalid form instead of sending it', () => {
    const form = fromDraftView(view([d1Section]));
    expect(toSaveTestDraftRequest({ ...form, name: '' })).toEqual({ ok: false, reason: 'invalid' });
    expect(toSaveTestDraftRequest({ ...form, durationMinutes: '4' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('sections', () => {
  const empty: EditorV2Form = { ...fromDraftView(view([])), sections: [] };

  it('adds an inline mcq section (free navigation) and a written one (forward-only, paste follows the test setting)', () => {
    const a = addSection(empty, 'inline', 'mcq');
    expect(a.sections[0]).toMatchObject({
      mode: 'inline',
      format: 'mcq',
      navigation: 'free',
      pasteRule: null,
    });
    const b = addSection(a, 'inline', 'written');
    expect(b.sections[1]).toMatchObject({
      format: 'written',
      navigation: 'forward_only',
      pasteRule: null,
    });
  });

  it('adds a pool section needing a pool and a draw count', () => {
    const form = addSection(empty, 'pool', 'mcq');
    expect(form.sections[0]).toMatchObject({ mode: 'pool', poolId: '', drawCount: '' });
    expect(sectionIssues(form).map((i) => i.code)).toEqual(
      expect.arrayContaining(['pool_missing', 'draw_count']),
    );
  });

  it('holds at most ten sections', () => {
    let form = empty;
    for (let i = 0; i < MAX_SECTIONS + 3; i += 1) form = addSection(form, 'inline', 'mcq');
    expect(form.sections).toHaveLength(MAX_SECTIONS);
  });

  it('removes and moves sections', () => {
    let form = addSection(
      addSection(addSection(empty, 'inline', 'mcq'), 'pool', 'mcq'),
      'inline',
      'written',
    );
    const names = () => form.sections.map((s) => s.mode + s.format);
    form = moveSection(form, 2, -1);
    expect(names()).toEqual(['inlinemcq', 'inlinewritten', 'poolmcq']);
    form = moveSection(form, 0, -1);
    expect(names()).toEqual(['inlinemcq', 'inlinewritten', 'poolmcq']);
    form = removeSection(form, 1);
    expect(names()).toEqual(['inlinemcq', 'poolmcq']);
  });

  it('a pool section is switched to inline only by clearing its pool, draw count and strata', () => {
    const pool = fromDraftView(view([poolSection])).sections[0] as SectionForm;
    const inline = setMode(pool, 'inline');
    expect(inline).toMatchObject({ mode: 'inline', poolId: '', drawCount: '', strata: [] });
  });

  it('refuses to switch a section that holds inline items to a pool (the items would be lost)', () => {
    const inline = fromDraftView(view([d1Section])).sections[0] as SectionForm;
    expect(setMode(inline, 'pool')).toBe(inline);
  });

  it('refuses to change the format of a section that holds items', () => {
    const inline = fromDraftView(view([d1Section])).sections[0] as SectionForm;
    expect(setFormat(inline, 'written')).toBe(inline);
    const fresh = newSection('inline', 'mcq');
    expect(setFormat(fresh, 'written')).toMatchObject({
      format: 'written',
      navigation: 'forward_only',
      shuffleOptions: false,
    });
  });
});

describe('navigation (§6.5)', () => {
  it('a written section is forward-only and refuses free navigation', () => {
    const written = newSection('inline', 'written');
    expect(setNavigation(written, 'free')).toBe(written);
    expect(setNavigation(written, 'forward_only')).toBe(written);
  });

  it('a multiple-choice section takes either', () => {
    const mcq = newSection('inline', 'mcq');
    expect(setNavigation(mcq, 'forward_only').navigation).toBe('forward_only');
    expect(setNavigation(setNavigation(mcq, 'forward_only'), 'free').navigation).toBe('free');
  });

  it('a D1 section (navigation null) becomes a v2 section the moment an M1 feature is used', () => {
    const d1 = fromDraftView(view([d1Section])).sections[0] as SectionForm;
    expect(setShuffle(d1, 'items', true)).toMatchObject({ navigation: 'free', shuffleItems: true });
    expect(setNavigation(d1, 'forward_only').navigation).toBe('forward_only');
    const d1Written = fromDraftView(
      view([
        { ...writtenSection, navigation: null, pasteRule: undefined, timeLimitSeconds: undefined },
      ]),
    ).sections[0] as SectionForm;
    expect(setPasteRule(d1Written, 'blocked')).toMatchObject({
      navigation: 'forward_only',
      pasteRule: 'blocked',
    });
  });

  it('every state reachable by these edits is accepted by the contract', () => {
    let section = newSection('inline', 'mcq');
    section = setShuffle(
      setShuffle(setNavigation(section, 'forward_only'), 'items', true),
      'options',
      true,
    );
    section = setTimeLimitMinutes(section, '20');
    const form = { ...fromDraftView(view([])), sections: [section] };
    expect(toSaveTestDraftRequest(form).ok).toBe(true);
  });
});

describe('shuffle, timers and the paste rule', () => {
  it('shuffles items and, for multiple choice only, options', () => {
    const mcq = setShuffle(setShuffle(newSection('inline', 'mcq'), 'items', true), 'options', true);
    expect(mcq).toMatchObject({ shuffleItems: true, shuffleOptions: true });
    const written = newSection('inline', 'written');
    expect(setShuffle(written, 'options', true)).toBe(written);
    expect(setShuffle(written, 'items', true).shuffleItems).toBe(true);
  });

  it('the paste rule belongs to written sections; null follows the test setting', () => {
    const mcq = newSection('inline', 'mcq');
    expect(setPasteRule(mcq, 'blocked')).toBe(mcq);
    const written = newSection('inline', 'written');
    expect(setPasteRule(written, 'allowed_logged').pasteRule).toBe('allowed_logged');
    expect(setPasteRule(setPasteRule(written, 'blocked'), null).pasteRule).toBeNull();
    const request = built({
      ...fromDraftView(view([])),
      sections: [setPasteRule(written, 'blocked')],
    });
    expect(request.sections[0]?.pasteRule).toBe('blocked');
    const none = built({ ...fromDraftView(view([])), sections: [written] });
    expect(none.sections[0]).not.toHaveProperty('pasteRule');
  });

  it('a timer is whole minutes from 1 to 120, or none; other text is ignored', () => {
    const s = newSection('inline', 'mcq');
    expect(setTimeLimitMinutes(s, '15').timeLimitSeconds).toBe(900);
    expect(setTimeLimitMinutes(s, '120').timeLimitSeconds).toBe(7200);
    expect(setTimeLimitMinutes(s, '').timeLimitSeconds).toBeNull();
    for (const bad of ['0', '121', '1.5', '-3', 'ten', '1e2']) {
      const timed = setTimeLimitMinutes(s, '15');
      expect(setTimeLimitMinutes(timed, bad), bad).toBe(timed);
    }
  });

  it('a timer reaches the request in seconds', () => {
    const s = setTimeLimitMinutes(newSection('inline', 'mcq'), '15');
    expect(built({ ...fromDraftView(view([])), sections: [s] }).sections[0]?.timeLimitSeconds).toBe(
      900,
    );
    const none = built({ ...fromDraftView(view([])), sections: [newSection('inline', 'mcq')] });
    expect(none.sections[0]).not.toHaveProperty('timeLimitSeconds');
  });
});

describe('pools, draw count and strata', () => {
  const pool = (): SectionForm => setDrawCount(setPool(newSection('pool', 'mcq'), ID(50)), '10');

  it('strata quotas must add up to the draw count', () => {
    let s = pool();
    s = addStratum(s, 'verbal');
    s = updateStratum(s, 0, { count: '4' });
    expect(strataSum(s)).toBe(4);
    const form = { ...fromDraftView(view([])), sections: [s] };
    expect(sectionIssues(form)).toEqual([{ section: 0, code: 'strata_sum' }]);
    expect(toSaveTestDraftRequest(form)).toEqual({ ok: false, reason: 'invalid' });
    s = addStratum(s, 'verbal');
    s = updateStratum(s, 1, { level: 3, count: '6' });
    const ok = built({ ...fromDraftView(view([])), sections: [s] });
    expect(ok.sections[0]?.blueprint?.strata).toEqual([
      { skillKey: 'verbal', difficultyBand: 0, count: 4 },
      { skillKey: 'verbal', difficultyBand: 3, count: 6 },
    ]);
  });

  it('a pool section without strata draws from the whole pool (one stratum = all items)', () => {
    const ok = built({ ...fromDraftView(view([])), sections: [pool()] });
    expect(ok.sections[0]).toMatchObject({ mode: 'pool', poolId: ID(50), drawCount: 10 });
    expect(ok.sections[0]).not.toHaveProperty('blueprint');
  });

  it('refuses two strata with the same skill and level', () => {
    let s = pool();
    s = updateStratum(addStratum(s, 'verbal'), 0, { count: '5' });
    s = updateStratum(addStratum(s, 'verbal'), 1, { count: '5' });
    expect(toSaveTestDraftRequest({ ...fromDraftView(view([])), sections: [s] }).ok).toBe(false);
    expect(
      sectionIssues({ ...fromDraftView(view([])), sections: [s] }).map((i) => i.code),
    ).toContain('strata_duplicate');
  });

  it('removes a stratum; refuses an unusable skill key or level', () => {
    let s = updateStratum(addStratum(pool(), 'verbal'), 0, { count: '5' });
    expect(updateStratum(s, 0, { level: 9 })).toBe(s);
    expect(updateStratum(s, 0, { skillKey: 'Bad Key' })).toBe(s);
    s = removeStratum(s, 0);
    expect(s.strata).toEqual([]);
  });

  it('the draw count is a whole number from 1 to 100', () => {
    const s = pool();
    expect(setDrawCount(s, '25').drawCount).toBe('25');
    expect(setDrawCount(s, '').drawCount).toBe('');
    for (const bad of ['0', '101', '2.5', 'x', '-1']) expect(setDrawCount(s, bad), bad).toBe(s);
  });

  it('a pool section carries no inline items and an inline one no pool (section rules of the contract)', () => {
    const p = pool();
    expect(p.items).toEqual([]);
    const request = built({
      ...fromDraftView(view([])),
      sections: [p, newSection('inline', 'mcq')],
    });
    expect(request.sections[1]).not.toHaveProperty('poolId');
    expect(request.sections[1]).not.toHaveProperty('drawCount');
  });
});

describe('poolGap (§6.1: "needs N more items for drives")', () => {
  it('needs the draw count to publish and ten times it for drives', () => {
    expect(poolGap(30, 10)).toEqual({ forPublish: 0, forDrives: 70 });
    expect(poolGap(100, 10)).toEqual({ forPublish: 0, forDrives: 0 });
    expect(poolGap(4, 10)).toEqual({ forPublish: 6, forDrives: 96 });
    expect(poolGap(0, 1)).toEqual({ forPublish: 1, forDrives: 10 });
  });
});

describe('section issues', () => {
  it('flags a section with no name, a weight outside 1-100, or a missing pool', () => {
    const s = { ...newSection('inline', 'mcq'), name: '', weight: '0' };
    const codes = sectionIssues({ ...fromDraftView(view([])), sections: [s] }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['name', 'weight']));
  });

  it('a clean draft has none', () => {
    expect(sectionIssues(fromDraftView(view([d1Section, poolSection, writtenSection])))).toEqual(
      [],
    );
  });
});
