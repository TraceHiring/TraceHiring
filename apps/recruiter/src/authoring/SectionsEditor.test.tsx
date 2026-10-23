// @vitest-environment happy-dom
// The v2 sections editor (specs/m1-test-authoring.md §6.5, §6.1): pool sections with strata, navigation, timers,
// shuffle flags, the paste rule, all as controls a recruiter can use, and none that D1's guards ban (no checkbox).
// Rendered here with synthetic data; the A2+A5 switch wires it into the live editor later (R5-53 b).
import { TestDraftView, type PoolDetail } from '@trace/shared/contracts/m1';
import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  button,
  choose,
  click,
  field,
  mountScreen,
  plain,
  typeInto,
  type Mounted,
} from './dom.test-helpers';
import {
  addSection,
  addStratum,
  fromDraftView,
  setDrawCount,
  setPool,
  type EditorV2Form,
} from './editor-v2-model';
import { SectionsEditorView } from './SectionsEditor';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const POOLS: PoolDetail[] = [
  {
    id: ID(50),
    name: 'Verbal pool',
    format: 'mcq',
    skillKey: 'verbal',
    status: 'active',
    itemCount: 40,
    approvedCount: 30,
    usedByDraws: [],
    usedByDrawsTotal: 0,
  },
  {
    id: ID(51),
    name: 'Prompts pool',
    format: 'written',
    skillKey: null,
    status: 'active',
    itemCount: 12,
    approvedCount: 12,
    usedByDraws: [],
    usedByDrawsTotal: 0,
  },
];
const empty = (): EditorV2Form => ({
  ...fromDraftView(
    TestDraftView.parse({
      test: {
        id: ID(1),
        workspaceId: ID(2),
        name: 'Synthetic test',
        createdAt: '2026-10-23T10:00:00.000Z',
      },
      version: {
        id: ID(3),
        versionNo: 1,
        status: 'draft',
        durationMinutes: 40,
        qualityCutoff: 40,
        publishedAt: null,
        sections: [],
      },
    }),
  ),
});

let latest: EditorV2Form = empty();
function Harness({ start, readOnly = false }: { start: EditorV2Form; readOnly?: boolean }) {
  const [form, setForm] = useState(start);
  return (
    <SectionsEditorView
      form={form}
      pools={POOLS}
      readOnly={readOnly}
      onChange={(next) => {
        latest = next;
        setForm(next);
      }}
    />
  );
}

let mounted: Mounted | undefined;
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});
const sectionEl = (i: number): HTMLElement => {
  const el = mounted?.container.querySelectorAll('[data-section]')[i];
  if (el === undefined) throw new Error(`no section ${i}`);
  return el as HTMLElement;
};

describe('SectionsEditorView (static render)', () => {
  const form = addSection(addSection(empty(), 'pool', 'mcq'), 'inline', 'written');
  const html = renderToString(
    <SectionsEditorView form={form} pools={POOLS} readOnly={false} onChange={() => undefined} />,
  );

  it('renders every section with its controls as React text, no checkbox and no inline style', () => {
    const text = plain(html);
    for (const label of [
      'Section name',
      'Weight',
      'Question source',
      'Navigation',
      'Time limit (minutes)',
      'Paste rule',
      'Pool',
      'Questions to draw',
    ]) {
      expect(text, label).toContain(label);
    }
    expect(html).not.toMatch(/type="checkbox"|role="checkbox"|aria-selected| style=/);
  });

  it('a written section is forward-only', () => {
    expect(plain(html)).toContain('A written section is always forward only.');
  });

  it('read-only disables every control and offers no add or remove', () => {
    const ro = renderToString(
      <SectionsEditorView form={form} pools={POOLS} readOnly onChange={() => undefined} />,
    );
    expect(ro).not.toMatch(/Add (?:a )?section|Remove section/);
    expect(
      (ro.match(/<(?:input|select|textarea)\b[^>]*>/g) ?? []).every((t) => /disabled/.test(t)),
    ).toBe(true);
  });
});

describe('SectionsEditorView (interaction)', () => {
  it('adds sections and removes one', async () => {
    mounted = await mountScreen(<Harness start={empty()} />, null);
    await click(button(mounted.container, 'Add a multiple-choice section'));
    await click(button(mounted.container, 'Add a written section'));
    await click(button(mounted.container, 'Add a pool section'));
    expect(latest.sections.map((s) => `${s.mode}:${s.format}`)).toEqual([
      'inline:mcq',
      'inline:written',
      'pool:mcq',
    ]);
    await click(button(sectionEl(0), 'Remove section 1'));
    expect(latest.sections).toHaveLength(2);
  });

  it('sets navigation, shuffle flags and the timer on a multiple-choice section', async () => {
    mounted = await mountScreen(<Harness start={addSection(empty(), 'inline', 'mcq')} />, null);
    await choose(field(sectionEl(0), 'Navigation'), 'forward_only');
    await choose(field(sectionEl(0), 'Shuffle questions'), 'on');
    await choose(field(sectionEl(0), 'Shuffle answer options'), 'on');
    await typeInto(field(sectionEl(0), 'Time limit (minutes)'), '15');
    expect(latest.sections[0]).toMatchObject({
      navigation: 'forward_only',
      shuffleItems: true,
      shuffleOptions: true,
      timeLimitSeconds: 900,
    });
  });

  it('a written section has no way to choose free navigation or shuffle options, and picks a paste rule', async () => {
    mounted = await mountScreen(<Harness start={addSection(empty(), 'inline', 'written')} />, null);
    const nav = field<HTMLSelectElement>(sectionEl(0), 'Navigation');
    expect([...nav.options].map((o) => o.value)).toEqual(['forward_only']);
    expect(plain(sectionEl(0).innerHTML)).not.toContain('Shuffle answer options');
    await choose(field(sectionEl(0), 'Paste rule'), 'blocked');
    expect(latest.sections[0]?.pasteRule).toBe('blocked');
    await choose(field(sectionEl(0), 'Paste rule'), '');
    expect(latest.sections[0]?.pasteRule).toBeNull();
  });

  it('a multiple-choice section has no paste rule control', async () => {
    mounted = await mountScreen(<Harness start={addSection(empty(), 'inline', 'mcq')} />, null);
    expect(plain(sectionEl(0).innerHTML)).not.toContain('Paste rule');
  });

  it('a pool section picks a pool of its own format, a draw count and strata, and shows the sum and the gap', async () => {
    const start = addSection(empty(), 'pool', 'mcq');
    mounted = await mountScreen(<Harness start={start} />, null);
    const pool = field<HTMLSelectElement>(sectionEl(0), 'Pool');
    expect([...pool.options].map((o) => o.value)).toEqual(['', ID(50)]);
    await choose(pool, ID(50));
    await typeInto(field(sectionEl(0), 'Questions to draw'), '10');
    expect(latest.sections[0]).toMatchObject({ poolId: ID(50), drawCount: '10' });
    const text = () => plain(sectionEl(0).innerHTML);
    expect(text()).toContain('This pool has 30 approved items. Needs 70 more items for drives.');
    await click(button(sectionEl(0), 'Add a stratum'));
    await typeInto(field(sectionEl(0), 'Skill'), 'verbal');
    await typeInto(field(sectionEl(0), 'Count'), '4');
    expect(latest.sections[0]?.strata[0]).toMatchObject({ skillKey: 'verbal', count: '4' });
    expect(text()).toContain('Strata add up to 4 of 10 questions.');
    await typeInto(field(sectionEl(0), 'Count'), '10');
    expect(text()).not.toContain('Strata add up to 4');
    expect(text()).toContain('Strata add up to 10 of 10 questions.');
  });

  it('says so when the pool is too small to publish', async () => {
    const base = addSection(empty(), 'pool', 'mcq');
    const section = setDrawCount(setPool(base.sections[0]!, ID(50)), '40');
    mounted = await mountScreen(<Harness start={{ ...base, sections: [section] }} />, null);
    expect(plain(sectionEl(0).innerHTML)).toContain('Needs 10 more items to publish.');
  });

  it('refuses to switch a section with inline items to a pool, and says why', async () => {
    const withItem = addSection(empty(), 'inline', 'mcq');
    const s = withItem.sections[0]!;
    const form = {
      ...withItem,
      sections: [
        {
          ...s,
          items: [
            {
              format: 'mcq' as const,
              prompt: 'Q?',
              options: [
                { id: 'a', text: 'A' },
                { id: 'b', text: 'B' },
              ],
              correctOptionId: 'a',
            },
          ],
        },
      ],
    };
    mounted = await mountScreen(<Harness start={form} />, null);
    expect(plain(sectionEl(0).innerHTML)).toContain('1 question written here');
    await choose(field(sectionEl(0), 'Question source'), 'pool');
    expect(latest.sections[0]?.mode).toBe('inline');
    expect(plain(sectionEl(0).innerHTML)).toContain(
      'Remove the questions written here before drawing from a pool.',
    );
  });

  it('read-only changes nothing', async () => {
    mounted = await mountScreen(
      <Harness start={addSection(empty(), 'inline', 'mcq')} readOnly />,
      null,
    );
    expect(field<HTMLInputElement>(sectionEl(0), 'Section name').disabled).toBe(true);
  });

  it('the strata level control offers Level 0 to Level 4 and no word of the integrity bands', async () => {
    const base = addSection(empty(), 'pool', 'mcq');
    const section = addStratum(setDrawCount(setPool(base.sections[0]!, ID(50)), '10'), 'verbal');
    mounted = await mountScreen(<Harness start={{ ...base, sections: [section] }} />, null);
    const level = field<HTMLSelectElement>(sectionEl(0), 'Level');
    expect([...level.options].map((o) => o.textContent)).toEqual([
      'Level 0',
      'Level 1',
      'Level 2',
      'Level 3',
      'Level 4',
    ]);
    await choose(level, '3');
    expect(latest.sections[0]?.strata[0]?.level).toBe(3);
    expect(plain(sectionEl(0).innerHTML)).not.toMatch(/\bband\b/i);
  });
});
