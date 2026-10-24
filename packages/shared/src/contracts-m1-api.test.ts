// M1 api request/response contracts the recruiter app (A5) and the api (A2) share: the draft read-model, list
// envelopes, bank stats, library copy, integrity locks, import job view, member invite view, pool items and template
// lists (specs/m1-test-authoring.md §5, §6.1-§6.6, §6.9, §6.11; R5-22, R5-29, R5-51). Synthetic values only.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as M1 from './contracts-m1.js';
import {
  ALWAYS_LOCKED_SETTINGS,
  INTEGRITY_SETTING_VALUES,
  SaveTestDraftRequest,
} from './contracts-m1.js';
import { canonicalJson } from './canonical-json.js';
import { allObjectsStrict, keysMatching, schemaKeys } from './contracts-schema-walk.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-23T10:00:00.000Z';
const T1 = '2026-10-23T11:00:00.000Z';
/** A page cursor built independently of the code under test: base64url of the canonical JSON keyset. */
const b64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url');
const cursorOf = (createdAt: string, rowId: string) =>
  b64url(canonicalJson({ createdAt, id: rowId }));
const C1 = cursorOf(T0, id(1));
const C2 = cursorOf(T1, id(2));
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;
/** Looks an export up by name, so a missing schema fails its test instead of the whole file's typecheck. */
const schema = (name: string): z.ZodType => {
  const found = (M1 as Record<string, unknown>)[name];
  if (!(found instanceof z.ZodType)) throw new Error(`contracts-m1 does not export ${name}`);
  return found;
};

const NEW_SCHEMAS = [
  'PageCursor',
  'PoolListQuery',
  'RoleTemplateListQuery',
  'TestDraftView',
  'CreateTestFromTemplateResponse',
  'RoleTemplateListResponse',
  'BankItemListQuery',
  'BankItemListResponse',
  'BankItemCreateResponse',
  'BankStatsResponse',
  'PoolListResponse',
  'PoolItemsRequest',
  'LibraryBrowseResponse',
  'LibraryCopyRequest',
  'LibraryCopyResponse',
  'IntegrityLockCreateRequest',
  'IntegrityLockView',
  'IntegrityLockListResponse',
  'ImportJobView',
  'ImportJobCreateResponse',
  'MemberInviteView',
  'MemberInviteCreateResponse',
  'MemberInviteListQuery',
  'MemberInviteListResponse',
];

describe('the api contracts exist and are strict', () => {
  it.each(NEW_SCHEMAS)('%s is exported and strict at every depth', (name) => {
    expect(allObjectsStrict(schema(name))).toBe(true);
  });
  it.each(NEW_SCHEMAS)('%s carries no organisation id (it is in the path)', (name) => {
    expect(keysMatching(schema(name), /^org_?id$/i)).toEqual([]);
  });
});

// ---- Draft read-model (GET …/tests/:testId; §5 SaveTestDraftRequest counterpart) --------------------------------

const viewInline = {
  id: id(101),
  position: 1,
  mode: 'inline',
  format: 'mcq',
  name: 'Reasoning',
  weight: 40,
  items: [
    {
      id: id(111),
      position: 1,
      format: 'mcq',
      prompt: '[synthetic] Pick one',
      options: [
        { id: 'a', text: 'One' },
        { id: 'b', text: 'Two' },
      ],
      correctOptionId: 'b',
    },
  ],
  shuffleItems: true,
  shuffleOptions: true,
  navigation: 'free',
  timeLimitSeconds: 900,
};
const viewPool = {
  id: id(102),
  position: 2,
  mode: 'pool',
  format: 'mcq',
  name: 'Quant',
  weight: 40,
  items: [],
  poolId: id(30),
  drawCount: 3,
  shuffleItems: false,
  shuffleOptions: true,
  navigation: 'free',
  timeLimitSeconds: 900,
  blueprint: {
    strata: [
      { skillKey: 'quant', difficultyBand: 1, count: 2 },
      { skillKey: 'quant', difficultyBand: 3, count: 1 },
    ],
  },
};
const viewWritten = {
  id: id(103),
  position: 3,
  mode: 'pool',
  format: 'written',
  name: 'Writing',
  weight: 20,
  items: [],
  poolId: id(31),
  drawCount: 1,
  shuffleItems: false,
  shuffleOptions: false,
  navigation: 'forward_only',
  pasteRule: 'allowed_logged',
  timeLimitSeconds: 600,
};
const draftView = {
  test: { id: id(100), workspaceId: id(9), name: '[synthetic] Support test', createdAt: T0 },
  version: {
    id: id(120),
    versionNo: 1,
    status: 'draft',
    durationMinutes: 40,
    qualityCutoff: 40,
    publishedAt: null,
    sections: [viewInline, viewPool, viewWritten],
  },
};
/** A view row without its database identity (`id`, `position`): the shape the editor sends back. */
const withoutIds = (row: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'id' && key !== 'position'));
const withSection = (patch: Record<string, unknown>, index = 0) => ({
  ...draftView,
  version: {
    ...draftView.version,
    sections: draftView.version.sections.map((s, i) => (i === index ? { ...s, ...patch } : s)),
  },
});

describe('TestDraftView (the editor round-trips it into SaveTestDraftRequest)', () => {
  const View = () => schema('TestDraftView');
  it('accepts a v2 draft with inline, pool and written pool sections', () => {
    expect(View().parse(draftView)).toEqual(draftView);
  });
  it('round-trips: dropping ids and positions gives a valid SaveTestDraftRequest', () => {
    const view = View().parse(draftView) as typeof draftView;
    const request = {
      name: view.test.name,
      durationMinutes: view.version.durationMinutes,
      qualityCutoff: view.version.qualityCutoff,
      sections: view.version.sections.map((section) => ({
        ...withoutIds(section),
        items: section.items.map((item) => withoutIds(item)),
      })),
    };
    expect(SaveTestDraftRequest.safeParse(request).success).toBe(true);
  });
  it('accepts a D1 (package v1) draft: navigation null, no M1 field', () => {
    const d1 = {
      ...draftView,
      version: {
        ...draftView.version,
        sections: [
          {
            id: id(104),
            position: 1,
            mode: 'inline',
            format: 'written',
            name: 'Written',
            weight: 100,
            items: [
              {
                id: id(112),
                position: 1,
                format: 'written',
                prompt: '[synthetic] Describe a process',
                rubric: {
                  criteria: [
                    { id: 'c1', label: 'Clear', maxPoints: 5, anchors: ['first'], minHits: 1 },
                  ],
                },
              },
            ],
            shuffleItems: false,
            shuffleOptions: false,
            navigation: null,
          },
        ],
      },
    };
    expect(ok(View(), d1)).toBe(true);
  });
  it('accepts a published version with publishedAt, refuses a draft with one', () => {
    const published = {
      ...draftView,
      version: { ...draftView.version, status: 'published', publishedAt: T1 },
    };
    expect(ok(View(), published)).toBe(true);
    expect(ok(View(), { ...draftView, version: { ...draftView.version, publishedAt: T1 } })).toBe(
      false,
    );
    expect(ok(View(), { ...published, version: { ...published.version, publishedAt: null } })).toBe(
      false,
    );
  });
  it.each([
    ['an inline section with a pool', withSection({ poolId: id(30) })],
    ['an inline section with a draw count', withSection({ drawCount: 2 })],
    ['a pool section without a pool', withSection({ poolId: undefined }, 1)],
    ['a pool section without a draw count', withSection({ drawCount: undefined }, 1)],
    ['a pool section with inline items', withSection({ items: viewInline.items }, 1)],
    ['strata that miss the draw count', withSection({ drawCount: 4 }, 1)],
    ['a free written section', withSection({ navigation: 'free' }, 2)],
    ['a paste rule on an mcq section', withSection({ pasteRule: 'blocked' })],
    ['an unknown paste rule', withSection({ pasteRule: 'allowed' }, 2)],
    ['an unknown navigation', withSection({ navigation: 'back_only' })],
    ['an unknown mode', withSection({ mode: 'mixed' })],
    ['an item of another format', withSection({ format: 'written', navigation: 'forward_only' })],
    ['a section time under 60 s', withSection({ timeLimitSeconds: 59 })],
    ['a section time over 7200 s', withSection({ timeLimitSeconds: 7201 })],
    ['a draw count over 100', withSection({ drawCount: 101, blueprint: undefined }, 1)],
    ['a weight of 0', withSection({ weight: 0 })],
    ['a section without an id', withSection({ id: undefined })],
    ['a section id that is not a uuid', withSection({ id: 'section-1' })],
    ['a section position of 0', withSection({ position: 0 })],
    ['an unknown section key', withSection({ poolName: 'Quant' })],
    ['an item without an id', withSection({ items: [{ ...viewInline.items[0], id: undefined }] })],
    [
      'an item whose key is not an option',
      withSection({ items: [{ ...viewInline.items[0], correctOptionId: 'z' }] }),
    ],
  ])('refuses %s', (_label, value) => {
    expect(ok(View(), value)).toBe(false);
  });
  it('refuses duplicate section ids or positions', () => {
    const dupId = {
      ...draftView,
      version: {
        ...draftView.version,
        sections: [viewInline, { ...viewPool, id: viewInline.id }, viewWritten],
      },
    };
    const dupPos = {
      ...draftView,
      version: {
        ...draftView.version,
        sections: [viewInline, { ...viewPool, position: 1 }, viewWritten],
      },
    };
    expect(ok(View(), dupId)).toBe(false);
    expect(ok(View(), dupPos)).toBe(false);
  });
  it('holds at most 10 sections and 200 inline items', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...viewInline,
        id: id(200 + i),
        position: i + 1,
        items: [],
      }));
    const sections = (list: unknown[]) => ({
      ...draftView,
      version: { ...draftView.version, sections: list },
    });
    expect(ok(View(), sections(many(10)))).toBe(true);
    expect(ok(View(), sections(many(11)))).toBe(false);
    const items = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...viewInline.items[0],
        id: id(1000 + offset + i),
        position: i + 1,
      }));
    const full = [
      { ...viewInline, id: id(301), position: 1, items: items(100, 0) },
      { ...viewInline, id: id(302), position: 2, items: items(100, 100) },
    ];
    expect(ok(View(), sections(full))).toBe(true);
    expect(
      ok(
        View(),
        sections([...full, { ...viewInline, id: id(303), position: 3, items: items(1, 200) }]),
      ),
    ).toBe(false);
  });
  it('refuses unknown keys and bad top-level values', () => {
    expect(ok(View(), { ...draftView, orgId: id(1) })).toBe(false);
    expect(ok(View(), { ...draftView, test: { ...draftView.test, jdText: 'x' } })).toBe(false);
    expect(ok(View(), { ...draftView, version: { ...draftView.version, status: 'live' } })).toBe(
      false,
    );
    expect(
      ok(View(), { ...draftView, version: { ...draftView.version, qualityCutoff: 101 } }),
    ).toBe(false);
    expect(
      ok(View(), { ...draftView, version: { ...draftView.version, durationMinutes: 121 } }),
    ).toBe(false);
    expect(ok(View(), { ...draftView, test: { ...draftView.test, name: '' } })).toBe(false);
  });
  it('rule 1: the read-model carries no integrity result and no combined number', () => {
    // `difficultyBand` (blueprint strata: a difficulty stratum 0-4) is the one allowed "band", as in the §5 sweep.
    expect(
      keysMatching(View(), /band|score|flag|integrity|signal|overall/i).filter(
        (key) => key !== 'difficultyBand',
      ),
    ).toEqual([]);
    expect(keysMatching(View(), /band/i)).toEqual(['difficultyBand']);
  });
});

describe('CreateTestFromTemplateResponse (POST …/tests/from-template)', () => {
  const R = () => schema('CreateTestFromTemplateResponse');
  const created = {
    draft: draftView,
    skippedSections: [
      { title: 'Typing', format: 'typing' },
      { title: 'Spoken English', format: 'voice' },
    ],
  };
  it('accepts the new draft and the sections skipped as not yet servable (M1-16)', () => {
    expect(R().parse(created)).toEqual(created);
    expect(ok(R(), { ...created, skippedSections: [] })).toBe(true);
  });
  it.each([
    [
      'a published draft',
      {
        ...created,
        draft: {
          ...draftView,
          version: { ...draftView.version, status: 'published', publishedAt: T1 },
        },
      },
    ],
    ['an unknown format', { ...created, skippedSections: [{ title: 'Code', format: 'code' }] }],
    [
      'a servable mcq section (M1-16)',
      { ...created, skippedSections: [{ title: 'V', format: 'mcq' }] },
    ],
    [
      'a servable written section (M1-16)',
      { ...created, skippedSections: [{ title: 'W', format: 'written' }] },
    ],
    ['an empty title', { ...created, skippedSections: [{ title: '', format: 'typing' }] }],
    [
      'more than 10 skipped sections',
      {
        ...created,
        skippedSections: Array.from({ length: 11 }, () => ({ title: 'T', format: 'typing' })),
      },
    ],
    ['no draft', { skippedSections: [] }],
    ['an unknown key', { ...created, jdText: 'x' }],
  ])('refuses %s', (_label, value) => {
    expect(ok(R(), value)).toBe(false);
  });
});

describe('RoleTemplateListResponse (GET …/templates)', () => {
  const R = () => schema('RoleTemplateListResponse');
  const t = {
    templateKey: 'customer_support',
    version: 1,
    name: '[synthetic] Customer Support',
    presetKey: 'standard',
  };
  it('a cursor page of at most 50 templates, one per key and version', () => {
    expect(ok(R(), { templates: [t, { ...t, templateKey: 'bpo_voice' }], nextCursor: null })).toBe(
      true,
    );
    expect(ok(R(), { templates: [], nextCursor: C1 })).toBe(true);
    expect(ok(R(), { templates: [t, t], nextCursor: null })).toBe(false);
    expect(
      ok(R(), {
        templates: Array.from({ length: 51 }, (_, i) => ({ ...t, version: i + 1 })),
        nextCursor: null,
      }),
    ).toBe(false);
    expect(ok(R(), { templates: [t] })).toBe(false);
    expect(ok(R(), { templates: [{ ...t, presetKey: 'lenient' }], nextCursor: null })).toBe(false);
  });
  it('RoleTemplateListQuery takes a page cursor only', () => {
    const Q = schema('RoleTemplateListQuery');
    expect(ok(Q, {})).toBe(true);
    expect(ok(Q, { cursor: C1 })).toBe(true);
    expect(ok(Q, { cursor: 'abc_DEF-1' })).toBe(false);
    expect(ok(Q, { presetKey: 'standard' })).toBe(false);
  });
});

// ---- Bank (§6.2, §6.3) ------------------------------------------------------------------------------------------

const summary = {
  itemId: id(40),
  itemVersionId: id(41),
  versionNo: 1,
  workspaceId: id(9),
  format: 'mcq',
  skillKey: 'quant',
  difficulty: 0.5,
  status: 'in_review',
  origin: 'ai_draft',
  stemPreview: '[synthetic] A shop sells',
  isParameterised: false,
  exposureCount: 0,
  createdAt: T0,
};

describe('BankItemListQuery (§6.2 filters: format, skill, difficulty range, status, origin, pool)', () => {
  const Q = () => schema('BankItemListQuery');
  it('parses query-string values', () => {
    expect(
      Q().parse({
        format: 'mcq',
        skillKey: 'quant',
        difficultyMin: '0.1',
        difficultyMax: '0.9',
        status: 'in_review',
        origin: 'ai_draft',
        poolId: id(30),
        cursor: C1,
      }),
    ).toEqual({
      format: 'mcq',
      skillKey: 'quant',
      difficultyMin: 0.1,
      difficultyMax: 0.9,
      status: 'in_review',
      origin: 'ai_draft',
      poolId: id(30),
      cursor: C1,
    });
    expect(ok(Q(), {})).toBe(true);
  });
  it.each([
    ['min above max', { difficultyMin: '0.8', difficultyMax: '0.2' }],
    ['a difficulty over 1', { difficultyMax: '1.5' }],
    ['a non-number difficulty', { difficultyMin: 'x' }],
    ['an empty difficulty (coerce would read 0)', { difficultyMin: '' }],
    ['a blank difficulty (coerce would read 0)', { difficultyMax: ' ' }],
    ['a padded difficulty', { difficultyMin: ' 0.5' }],
    ['a hex difficulty', { difficultyMin: '0x1' }],
    ['an exponent difficulty', { difficultyMin: '1e-1' }],
    ['a number, not query text', { difficultyMin: 0.5 }],
    ['a hand-made cursor', { cursor: 'abc_DEF-1' }],
    ['the old rejected status (R5-22)', { status: 'rejected' }],
    ['an unknown origin', { origin: 'ai' }],
    ['an unknown format', { format: 'voice' }],
    ['a pool id that is not a uuid', { poolId: 'pool-1' }],
    ['a cursor with a space', { cursor: 'a b' }],
    ['a cursor over 200 characters', { cursor: 'a'.repeat(201) }],
    ['an org id', { orgId: id(1) }],
  ])('refuses %s', (_label, value) => {
    expect(ok(Q(), value)).toBe(false);
  });
});

describe('BankItemListResponse (cursor page of BankItemSummary)', () => {
  const R = () => schema('BankItemListResponse');
  it('accepts a page and the last page', () => {
    expect(ok(R(), { items: [summary], nextCursor: C2 })).toBe(true);
    expect(ok(R(), { items: [], nextCursor: null })).toBe(true);
  });
  it.each([
    ['more than 50 rows', { items: Array.from({ length: 51 }, () => summary), nextCursor: null }],
    ['a missing cursor', { items: [summary] }],
    ['a bad cursor', { items: [summary], nextCursor: 'a b' }],
    ['a row with a key', { items: [{ ...summary, key: { optionId: 'a' } }], nextCursor: null }],
    ['an unknown key', { items: [], nextCursor: null, total: 3 }],
  ])('refuses %s', (_label, value) => {
    expect(ok(R(), value)).toBe(false);
  });
  it('a list row carries no key, rubric or options', () => {
    expect(keysMatching(R(), /^key$|answer|correct|rubric|^options$|paramSpec/i)).toEqual([]);
  });
});

describe('BankItemCreateResponse (201: the new draft)', () => {
  const R = () => schema('BankItemCreateResponse');
  const created = {
    itemId: id(40),
    itemVersionId: id(41),
    versionNo: 1,
    workspaceId: id(9),
    status: 'draft',
    origin: 'human',
    isParameterised: false,
    librarySourced: false,
    createdBy: id(7),
    approvedBy: null,
    approvedAt: null,
    exposureCount: 0,
    content: {
      format: 'mcq',
      stem: '[synthetic] Pick one',
      options: [
        { id: 'a', text: 'One' },
        { id: 'b', text: 'Two' },
      ],
      key: { optionId: 'a' },
      skillKey: 'quant',
      difficulty: 0.4,
    },
  };
  it('accepts a draft detail', () => {
    expect(R().parse(created)).toEqual(created);
  });
  it('refuses anything that is not a draft, and unknown keys', () => {
    expect(ok(R(), { ...created, status: 'in_review' })).toBe(false);
    expect(ok(R(), { ...created, status: 'approved', approvedBy: id(7), approvedAt: T0 })).toBe(
      false,
    );
    expect(ok(R(), { ...created, orgId: id(1) })).toBe(false);
  });
});

describe('BankStatsResponse (GET …/bank/stats, the ABH-7 share metric §6.3)', () => {
  const R = () => schema('BankStatsResponse');
  const org = { quantItemsApproved: 50, quantItemsParameterised: 20, share: 0.4 };
  it('accepts org and library rows; library may be absent (null)', () => {
    expect(
      R().parse({
        org,
        library: { quantItemsApproved: 8, quantItemsParameterised: 1, share: 0.125 },
      }),
    ).toEqual({
      org,
      library: { quantItemsApproved: 8, quantItemsParameterised: 1, share: 0.125 },
    });
    expect(ok(R(), { org, library: null })).toBe(true);
    expect(
      ok(R(), {
        org: { quantItemsApproved: 3, quantItemsParameterised: 1, share: 1 / 3 },
        library: null,
      }),
    ).toBe(true);
  });
  it('share is null exactly when nothing is approved', () => {
    expect(
      ok(R(), {
        org: { quantItemsApproved: 0, quantItemsParameterised: 0, share: null },
        library: null,
      }),
    ).toBe(true);
    expect(
      ok(R(), {
        org: { quantItemsApproved: 0, quantItemsParameterised: 0, share: 0 },
        library: null,
      }),
    ).toBe(false);
    expect(ok(R(), { org: { ...org, share: null }, library: null })).toBe(false);
  });
  it.each([
    ['a share that is not parameterised / approved', { ...org, share: 0.5 }],
    [
      'more parameterised than approved',
      { quantItemsApproved: 2, quantItemsParameterised: 3, share: 1.5 },
    ],
    ['a negative count', { quantItemsApproved: -1, quantItemsParameterised: 0, share: null }],
    ['a fractional count', { quantItemsApproved: 2.5, quantItemsParameterised: 1, share: 0.4 }],
    ['an unknown key', { ...org, skillKey: 'quant' }],
  ])('refuses %s', (_label, row) => {
    expect(ok(R(), { org: row, library: null })).toBe(false);
  });
  it('refuses a missing library field and unknown keys', () => {
    expect(ok(R(), { org })).toBe(false);
    expect(ok(R(), { org, library: null, workspaces: [] })).toBe(false);
  });
});

// ---- Pools (§6.5) -----------------------------------------------------------------------------------------------

const pool = {
  id: id(30),
  name: 'Quant pool',
  format: 'mcq',
  skillKey: 'quant',
  status: 'active',
  itemCount: 12,
  approvedCount: 10,
  usedByDraws: [{ testId: id(31), drawCount: 5 }],
  usedByDrawsTotal: 1,
};

describe('PoolListResponse and PoolItemsRequest', () => {
  it('PoolListResponse: a cursor page of at most 50 pools, distinct ids', () => {
    const R = schema('PoolListResponse');
    expect(ok(R, { pools: [pool, { ...pool, id: id(32) }], nextCursor: C1 })).toBe(true);
    expect(ok(R, { pools: [], nextCursor: null })).toBe(true);
    expect(ok(R, { pools: [pool, pool], nextCursor: null })).toBe(false);
    expect(
      ok(R, {
        pools: Array.from({ length: 51 }, (_, i) => ({ ...pool, id: id(5000 + i) })),
        nextCursor: null,
      }),
    ).toBe(false);
    expect(ok(R, { pools: [pool] })).toBe(false);
    expect(ok(R, { pools: [{ ...pool, approvedCount: 13 }], nextCursor: null })).toBe(false);
  });
  it('PoolListQuery takes a page cursor only', () => {
    const Q = schema('PoolListQuery');
    expect(ok(Q, {})).toBe(true);
    expect(ok(Q, { cursor: C2 })).toBe(true);
    expect(ok(Q, { cursor: 'a b' })).toBe(false);
    expect(ok(Q, { status: 'active' })).toBe(false);
  });
  it('PoolDetail.usedByDraws: at most 50 listed, with the full count beside them', () => {
    const P = M1.PoolDetail;
    const draws = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ testId: id(9000 + i), drawCount: 1 }));
    expect(ok(P, { ...pool, usedByDraws: draws(50), usedByDrawsTotal: 120 })).toBe(true);
    expect(ok(P, { ...pool, usedByDraws: [], usedByDrawsTotal: 0 })).toBe(true);
    expect(ok(P, { ...pool, usedByDraws: draws(51), usedByDrawsTotal: 51 })).toBe(false);
    expect(ok(P, { ...pool, usedByDraws: draws(3), usedByDrawsTotal: 2 })).toBe(false);
    expect(ok(P, { ...pool, usedByDrawsTotal: -1 })).toBe(false);
    expect(ok(P, { ...pool, usedByDrawsTotal: 1.5 })).toBe(false);
    const withoutTotal = Object.fromEntries(
      Object.entries(pool).filter(([key]) => key !== 'usedByDrawsTotal'),
    );
    expect(ok(P, withoutTotal)).toBe(false);
  });
  it('PoolItemsRequest: 1-500 distinct item version ids', () => {
    const R = schema('PoolItemsRequest');
    expect(ok(R, { itemVersionIds: [id(41), id(42)] })).toBe(true);
    expect(ok(R, { itemVersionIds: Array.from({ length: 500 }, (_, i) => id(6000 + i)) })).toBe(
      true,
    );
    expect(ok(R, { itemVersionIds: [] })).toBe(false);
    expect(ok(R, { itemVersionIds: Array.from({ length: 501 }, (_, i) => id(6000 + i)) })).toBe(
      false,
    );
    expect(ok(R, { itemVersionIds: [id(41), id(41)] })).toBe(false);
    expect(ok(R, { itemVersionIds: ['item-1'] })).toBe(false);
    expect(ok(R, { itemVersionIds: [id(41)], poolId: id(30) })).toBe(false);
  });
});

// ---- Library (§6.2, M1-4, R2-5) ---------------------------------------------------------------------------------

const card = {
  libraryItemVersionId: id(50),
  format: 'mcq',
  skillKey: 'quant',
  difficulty: 0.4,
  stem: '[synthetic] Library stem',
  options: ['One', 'Two'],
  isParameterised: false,
};

describe('LibraryBrowseResponse (cursor page of LibraryItemCard)', () => {
  const R = () => schema('LibraryBrowseResponse');
  it('accepts a page and the last page', () => {
    expect(ok(R(), { items: [card], nextCursor: C2 })).toBe(true);
    expect(ok(R(), { items: [], nextCursor: null })).toBe(true);
  });
  it.each([
    ['more than 50 cards', { items: Array.from({ length: 51 }, () => card), nextCursor: null }],
    ['a card with a key', { items: [{ ...card, correctOptionId: 'a' }], nextCursor: null }],
    ['a bad cursor', { items: [], nextCursor: '' }],
    ['an unknown key', { items: [], nextCursor: null, orgId: id(1) }],
  ])('refuses %s', (_label, value) => {
    expect(ok(R(), value)).toBe(false);
  });
  it('AT-M1-22: no key field anywhere in the page (I-M1-5)', () => {
    expect(keysMatching(R(), /^key$|answer|correct|rubric|solution|paramSpec/i)).toEqual([]);
  });
});

describe('LibraryCopyRequest and LibraryCopyResponse (POST …/library/copy; library_copy_requests)', () => {
  it('request: 1-500 distinct approved library version ids, optional workspace', () => {
    const R = schema('LibraryCopyRequest');
    expect(ok(R, { libraryItemVersionIds: [id(50)] })).toBe(true);
    expect(ok(R, { libraryItemVersionIds: [id(50), id(51)], workspaceId: id(9) })).toBe(true);
    expect(
      ok(R, { libraryItemVersionIds: Array.from({ length: 500 }, (_, i) => id(7000 + i)) }),
    ).toBe(true);
    expect(ok(R, { libraryItemVersionIds: [] })).toBe(false);
    expect(
      ok(R, { libraryItemVersionIds: Array.from({ length: 501 }, (_, i) => id(7000 + i)) }),
    ).toBe(false);
    expect(ok(R, { libraryItemVersionIds: [id(50), id(50)] })).toBe(false);
    expect(ok(R, { libraryItemVersionIds: ['lib-1'] })).toBe(false);
    expect(ok(R, { libraryItemVersionIds: [id(50)], orgId: id(1) })).toBe(false);
    expect(ok(R, { libraryItemVersionIds: [id(50)], workspaceId: 'ws' })).toBe(false);
  });
  it('response: the local item version ids, distinct, 1-500', () => {
    const R = schema('LibraryCopyResponse');
    expect(ok(R, { itemVersionIds: [id(60), id(61)] })).toBe(true);
    expect(ok(R, { itemVersionIds: [] })).toBe(false);
    expect(ok(R, { itemVersionIds: [id(60), id(60)] })).toBe(false);
    expect(ok(R, { itemVersionIds: Array.from({ length: 501 }, (_, i) => id(8000 + i)) })).toBe(
      false,
    );
    expect(ok(R, { itemVersionIds: [id(60)], keys: [] })).toBe(false);
    expect(keysMatching(R, /key$|answer|correct/i)).toEqual([]);
  });
});

// ---- Integrity admin locks (§6.6, screen 04; org_integrity_locks) -----------------------------------------------

const LOCKABLE = Object.keys(INTEGRITY_SETTING_VALUES).filter(
  (key) => !(ALWAYS_LOCKED_SETTINGS as readonly string[]).includes(key),
);
const lock = {
  id: id(70),
  settingKey: 'paste_written',
  lockedValue: 'blocked',
  lockedBy: id(7),
  lockedAt: T0,
};

describe('IntegrityLockCreateRequest', () => {
  const R = () => schema('IntegrityLockCreateRequest');
  it.each(
    LOCKABLE.flatMap((key) =>
      (
        INTEGRITY_SETTING_VALUES[key as keyof typeof INTEGRITY_SETTING_VALUES] as readonly string[]
      ).map((value) => [key, value] as const),
    ),
  )('accepts %s = %s', (settingKey, lockedValue) => {
    expect(ok(R(), { settingKey, lockedValue })).toBe(true);
  });
  it.each(ALWAYS_LOCKED_SETTINGS.map((key) => [key, INTEGRITY_SETTING_VALUES[key][0]] as const))(
    'refuses a lock row for always-locked %s (M1-14)',
    (settingKey, lockedValue) => {
      expect(ok(R(), { settingKey, lockedValue })).toBe(false);
    },
  );
  it.each([
    ['a value from another setting', { settingKey: 'paste_written', lockedValue: 'on' }],
    ['warn_first on an on/off setting', { settingKey: 'single_screen', lockedValue: 'warn_first' }],
    ['an unknown setting', { settingKey: 'gaze_tracking', lockedValue: 'on' }],
    ['an empty value', { settingKey: 'single_screen', lockedValue: '' }],
    ['a missing value', { settingKey: 'single_screen' }],
    ['an org id', { settingKey: 'single_screen', lockedValue: 'on', orgId: id(1) }],
    ['a lockedBy', { settingKey: 'single_screen', lockedValue: 'on', lockedBy: id(7) }],
  ])('refuses %s', (_label, value) => {
    expect(ok(R(), value)).toBe(false);
  });
});

describe('IntegrityLockView and IntegrityLockListResponse', () => {
  it('view: a stored lock; the value is one of its setting', () => {
    const V = schema('IntegrityLockView');
    expect(V.parse(lock)).toEqual(lock);
    expect(ok(V, { ...lock, lockedBy: null })).toBe(true);
    expect(ok(V, { ...lock, lockedValue: 'on' })).toBe(false);
    expect(
      ok(V, { ...lock, settingKey: 'integrity_review_scope', lockedValue: 'shortlist_only' }),
    ).toBe(false);
    expect(ok(V, { ...lock, lockedAt: 'yesterday' })).toBe(false);
    expect(ok(V, { ...lock, id: 'lock-1' })).toBe(false);
    expect(ok(V, { ...lock, orgId: id(1) })).toBe(false);
  });
  it('list: one lock per setting, at most the lockable settings', () => {
    const L = schema('IntegrityLockListResponse');
    expect(LOCKABLE).toHaveLength(10);
    const all = LOCKABLE.map((key, i) => ({
      ...lock,
      id: id(700 + i),
      settingKey: key,
      lockedValue: INTEGRITY_SETTING_VALUES[key as keyof typeof INTEGRITY_SETTING_VALUES][0],
    }));
    expect(ok(L, { locks: all })).toBe(true);
    expect(ok(L, { locks: [] })).toBe(true);
    expect(ok(L, { locks: [lock, { ...lock, id: id(71) }] })).toBe(false);
    expect(ok(L, { locks: [...all, { ...lock, id: id(799) }] })).toBe(false);
  });
});

// ---- Import jobs (§4.3, §6.9; import_jobs in M1-c) --------------------------------------------------------------

const job = {
  id: id(80),
  workspaceId: id(9),
  sourceKind: 'xlsx',
  templateVersion: 'trace-items-v1',
  status: 'completed',
  rowsTotal: 500,
  rowsOk: 498,
  rowsError: 2,
  imagesOk: 500,
  createdAt: T0,
  completedAt: T1,
};
const openJob = {
  ...job,
  status: 'open',
  rowsTotal: 0,
  rowsOk: 0,
  rowsError: 0,
  imagesOk: 0,
  completedAt: null,
};

describe('ImportJobView (GET …/imports/:id; complete and cancel answer it too)', () => {
  const V = () => schema('ImportJobView');
  it('accepts open, validating, completed, cancelled and failed jobs', () => {
    expect(V().parse(job)).toEqual(job);
    expect(ok(V(), openJob)).toBe(true);
    expect(ok(V(), { ...openJob, status: 'validating' })).toBe(true);
    expect(ok(V(), { ...job, status: 'cancelled' })).toBe(true);
    expect(ok(V(), { ...openJob, status: 'failed', errorCode: 'row_limit', completedAt: T1 })).toBe(
      true,
    );
    expect(ok(V(), { ...openJob, sourceKind: 'docx' })).toBe(true);
  });
  it.each([
    ['ok + error != total', { ...job, rowsOk: 499 }],
    ['over 2,000 rows', { ...job, rowsTotal: 2001, rowsOk: 2001, rowsError: 0 }],
    ['over 2,000 images', { ...job, imagesOk: 2001 }],
    ['a negative count', { ...job, rowsError: -1, rowsOk: 501 }],
    ['a failed job without a code', { ...job, status: 'failed' }],
    ['a code on a job that did not fail', { ...job, errorCode: 'timeout' }],
    ['a row error code as the job code', { ...job, status: 'failed', errorCode: 'bad_key' }],
    ['a finished job without completedAt', { ...job, completedAt: null }],
    ['an open job with completedAt', { ...openJob, completedAt: T1 }],
    ['an unknown status', { ...job, status: 'running' }],
    ['an unknown source kind', { ...job, sourceKind: 'csv' }],
    ['an unknown template version', { ...job, templateVersion: 'trace-items-v9' }],
    ['an unknown key', { ...job, fileName: 'items.xlsx' }],
  ])('refuses %s', (_label, value) => {
    expect(ok(V(), value)).toBe(false);
  });
  it('carries no cell value, file name or free text', () => {
    expect(keysMatching(V(), /name|text|message|cell|stem|file/i)).toEqual([]);
  });
});

describe('ImportJobCreateResponse (201: the open job)', () => {
  const R = () => schema('ImportJobCreateResponse');
  it('accepts only an open job', () => {
    expect(R().parse(openJob)).toEqual(openJob);
    expect(ok(R(), { ...openJob, status: 'validating' })).toBe(false);
    expect(ok(R(), job)).toBe(false);
  });
});

// ---- Member invites (§4.5, R2-14) -------------------------------------------------------------------------------

const invite = {
  id: id(90),
  roles: ['recruiter'],
  workspaceId: id(9),
  status: 'pending',
  membershipId: null,
  invitedBy: id(7),
  createdAt: T0,
};

describe('MemberInviteView (no address, no HMAC, no name: R2-14)', () => {
  const V = () => schema('MemberInviteView');
  it('accepts pending, provisioned, failed and cancelled invites', () => {
    expect(V().parse(invite)).toEqual(invite);
    expect(ok(V(), { ...invite, status: 'provisioned', membershipId: id(91) })).toBe(true);
    expect(ok(V(), { ...invite, status: 'failed' })).toBe(true);
    expect(ok(V(), { ...invite, status: 'cancelled', invitedBy: null })).toBe(true);
    expect(ok(V(), { ...invite, roles: ['admin'], workspaceId: null })).toBe(true);
  });
  it.each([
    ['a provisioned invite without its membership', { ...invite, status: 'provisioned' }],
    ['a membership on a pending invite', { ...invite, membershipId: id(91) }],
    ['an admin scoped to a workspace', { ...invite, roles: ['admin'] }],
    ['an owner scoped to a workspace', { ...invite, roles: ['org_owner'] }],
    ['no role', { ...invite, roles: [] }],
    ['a duplicate role', { ...invite, roles: ['recruiter', 'recruiter'] }],
    ['an unknown role', { ...invite, roles: ['candidate'] }],
    ['an unknown status', { ...invite, status: 'accepted' }],
    ['an email', { ...invite, email: 'person@example.test' }],
    ['an email hmac', { ...invite, emailHmac: 'a'.repeat(64) }],
    ['a display name', { ...invite, displayName: '[synthetic] Member' }],
  ])('refuses %s', (_label, value) => {
    expect(ok(V(), value)).toBe(false);
  });
  it('no field could carry the address, its HMAC or a name', () => {
    expect(keysMatching(V(), /mail|hmac|name|phone|address|contact/i)).toEqual([]);
  });
});

describe('MemberInviteCreateResponse, MemberInviteListQuery and MemberInviteListResponse', () => {
  it('create answers the pending invite only', () => {
    const R = schema('MemberInviteCreateResponse');
    expect(ok(R, invite)).toBe(true);
    expect(ok(R, { ...invite, status: 'provisioned', membershipId: id(91) })).toBe(false);
  });
  it('list query takes a cursor only', () => {
    const Q = schema('MemberInviteListQuery');
    expect(ok(Q, {})).toBe(true);
    expect(ok(Q, { cursor: C1 })).toBe(true);
    expect(ok(Q, { cursor: 'a b' })).toBe(false);
    expect(ok(Q, { email: 'person@example.test' })).toBe(false);
  });
  it('list: a cursor page of at most 50 invites', () => {
    const L = schema('MemberInviteListResponse');
    expect(ok(L, { invites: [invite], nextCursor: null })).toBe(true);
    expect(ok(L, { invites: [], nextCursor: C2 })).toBe(true);
    expect(ok(L, { invites: Array.from({ length: 51 }, () => invite), nextCursor: null })).toBe(
      false,
    );
    expect(ok(L, { invites: [invite] })).toBe(false);
    expect(keysMatching(L, /mail|hmac|name|phone|address|contact/i)).toEqual([]);
  });
});

// ---- The closed lists and bounds equal the database (style of contracts-m1-db.test.ts) ---------------------------

const migrations = resolve(import.meta.dirname, '../../..', 'supabase/migrations');
const sqlOf = (suffix: string): string => {
  const names = readdirSync(migrations).filter((n) => n.endsWith(suffix));
  expect(names).toHaveLength(1);
  return readFileSync(resolve(migrations, names[0] ?? ''), 'utf8');
};
const tableOf = (sql: string, table: string): string => {
  const start = sql.indexOf(`create table public.${table} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('\n);', start));
};
const checkList = (block: string, column: string): string[] => {
  const m = new RegExp(`\\b${column} in \\(([^)]*)\\)`).exec(block);
  expect(m, `${column} CHECK list`).not.toBeNull();
  return [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((v) => v[1] ?? '').sort();
};
/** The options of a zod enum reached through an object's shape. */
const enumAt = (root: z.ZodType, key: string): string[] => {
  const shape = (root as unknown as { shape: Record<string, z.ZodType> }).shape;
  const node = shape[key] as unknown as {
    options?: string[];
    unwrap?: () => { options: string[] };
  };
  return [...(node.options ?? node.unwrap?.().options ?? [])].sort();
};

describe('api contracts equal the M1 tables', () => {
  it('ImportJobView.sourceKind and status are the import_jobs CHECK lists; counts bounded as the table', () => {
    const t = tableOf(sqlOf('_m1_imports_drafts.sql'), 'import_jobs');
    expect(enumAt(schema('ImportJobView'), 'sourceKind')).toEqual(checkList(t, 'source_kind'));
    expect(enumAt(schema('ImportJobView'), 'status')).toEqual(checkList(t, 'status'));
    expect(t).toMatch(/rows_total int not null default 0 check \(rows_total between 0 and 2000\)/);
    expect(t).toMatch(/images_ok int not null default 0 check \(images_ok between 0 and 2000\)/);
    expect(t).toMatch(/check \(rows_ok \+ rows_error = rows_total\)/);
    expect(t).toMatch(/check \(\(status = 'failed'\) = \(error_code is not null\)\)/);
    expect(t).toMatch(
      /check \(\(status in \('completed', 'cancelled', 'failed'\)\) = \(completed_at is not null\)\)/,
    );
  });
  it('MemberInviteView mirrors the member_invites CHECKs', () => {
    const t = tableOf(sqlOf('_m1_members.sql'), 'member_invites');
    expect(enumAt(schema('MemberInviteView'), 'status')).toEqual(checkList(t, 'status'));
    expect(t).toMatch(
      /check \(workspace_id is null or not \(roles && '\{org_owner,admin\}'::public\.org_role\[\]\)\)/,
    );
    expect(t).toMatch(/check \(\(status = 'provisioned'\) = \(membership_id is not null\)\)/);
    expect(t).not.toMatch(/\bemail text\b|display_name/);
  });
  it('the library copy bound is the library_copy_requests CHECK (1-500)', () => {
    const t = tableOf(sqlOf('_m1_bank.sql'), 'library_copy_requests');
    expect(t).toMatch(/cardinality\(library_item_version_ids\) between 1 and 500/);
  });
  it('org_integrity_locks holds one row per setting', () => {
    const t = tableOf(sqlOf('_m1_tests.sql'), 'org_integrity_locks');
    expect(t).toMatch(/unique \(org_id, setting_key\)/);
  });
  it('the lock view keys are exactly the table columns the client may see', () => {
    expect(schemaKeys(schema('IntegrityLockView'))).toEqual([
      'id',
      'lockedAt',
      'lockedBy',
      'lockedValue',
      'settingKey',
    ]);
  });
});

// ---- First-review fixes (spec and security reviews of m1/w1-contracts) -------------------------------------------

/** A D1 section as the editor sends it back: inline, no M1 feature, navigation null (R2-1). */
const d1Request = {
  mode: 'inline',
  format: 'mcq',
  name: 'Reasoning',
  weight: 50,
  items: [],
  shuffleItems: false,
  shuffleOptions: false,
  navigation: null,
};
const poolDraft = {
  mode: 'pool',
  format: 'mcq',
  name: 'Quant',
  weight: 50,
  items: [],
  poolId: id(30),
  drawCount: 3,
  shuffleItems: false,
  shuffleOptions: false,
  navigation: 'free',
};

describe('PageCursor: a keyset only, base64url of canonical JSON', () => {
  type Codec = {
    encodePageCursor: (c: { createdAt: string; id: string }) => string;
    decodePageCursor: (s: string) => { createdAt: string; id: string } | null;
  };
  const codec = (): Codec => {
    const m = M1 as Record<string, unknown>;
    if (typeof m.encodePageCursor !== 'function' || typeof m.decodePageCursor !== 'function') {
      throw new Error('contracts-m1 does not export the page cursor codec');
    }
    return m as unknown as Codec;
  };
  it('encodes to the canonical form and decodes it back', () => {
    const { encodePageCursor, decodePageCursor } = codec();
    expect(encodePageCursor({ id: id(1), createdAt: T0 })).toBe(C1);
    expect(decodePageCursor(C1)).toEqual({ createdAt: T0, id: id(1) });
    expect(decodePageCursor(C2)).toEqual({ createdAt: T1, id: id(2) });
    expect(encodePageCursor({ createdAt: '2026-10-23T15:30:00+05:30', id: id(3) })).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
  });
  it('PageCursor is the strict keyset {createdAt, id}', () => {
    const P = schema('PageCursor');
    expect(schemaKeys(P)).toEqual(['createdAt', 'id']);
    expect(ok(P, { createdAt: T0, id: id(1) })).toBe(true);
    expect(ok(P, { createdAt: T0, id: id(1), orgId: id(2) })).toBe(false);
  });
  it('encode refuses a value that is not a keyset', () => {
    const { encodePageCursor } = codec();
    expect(() => encodePageCursor({ createdAt: 'yesterday', id: id(1) })).toThrow();
    expect(() =>
      encodePageCursor({ createdAt: T0, id: id(1), workspaceId: id(2) } as never),
    ).toThrow();
  });
  it.each([
    ['empty', ''],
    ['not base64url (space)', 'a b'],
    ['the standard base64 alphabet', `${C1.slice(0, -2)}+/`],
    ['padded', `${C1}=`],
    ['base64url of non-JSON', b64url('not json')],
    ['base64url of a JSON array', b64url(canonicalJson([T0, id(1)]))],
    ['base64url of JSON null', b64url('null')],
    [
      'an extra key (scope smuggled in)',
      b64url(canonicalJson({ createdAt: T0, id: id(1), orgId: id(2) })),
    ],
    [
      'a filter smuggled in',
      b64url(canonicalJson({ createdAt: T0, id: id(1), status: 'approved' })),
    ],
    ['a missing key', b64url(canonicalJson({ id: id(1) }))],
    ['an id that is not a uuid', b64url(canonicalJson({ createdAt: T0, id: 'row-1' }))],
    ['a numeric createdAt', b64url(canonicalJson({ createdAt: 1761213600000, id: id(1) }))],
    ['a createdAt that is not ISO', b64url(canonicalJson({ createdAt: '23/10/2026', id: id(1) }))],
    ['keys out of canonical order', b64url(`{"id":"${id(1)}","createdAt":"${T0}"}`)],
    ['whitespace in the JSON', b64url(`{"createdAt": "${T0}","id": "${id(1)}"}`)],
    ['invalid UTF-8', Buffer.from([0x7b, 0xff, 0xfe, 0x7d]).toString('base64url')],
    ['over 200 characters', 'A'.repeat(201)],
    ['a hand-made cursor', 'abc_DEF-123'],
  ])('decode refuses %s', (_label, text) => {
    const { decodePageCursor } = codec();
    expect(decodePageCursor(text)).toBeNull();
  });
  it.each([
    'BankItemListQuery',
    'MemberInviteListQuery',
    'PoolListQuery',
    'RoleTemplateListQuery',
    'LibraryBrowseQuery',
  ])('%s.cursor accepts only a decodable cursor', (name) => {
    expect(ok(schema(name), { cursor: C1 })).toBe(true);
    expect(ok(schema(name), { cursor: 'abc_DEF-123' })).toBe(false);
    expect(
      ok(schema(name), { cursor: b64url(canonicalJson({ createdAt: T0, id: id(1), x: 1 })) }),
    ).toBe(false);
  });
  it.each([
    ['BankItemListResponse', { items: [] }],
    ['LibraryBrowseResponse', { items: [] }],
    ['MemberInviteListResponse', { invites: [] }],
    ['PoolListResponse', { pools: [] }],
    ['RoleTemplateListResponse', { templates: [] }],
  ])('%s.nextCursor accepts only a decodable cursor', (name, rows) => {
    expect(ok(schema(name), { ...rows, nextCursor: C2 })).toBe(true);
    expect(ok(schema(name), { ...rows, nextCursor: 'next_1' })).toBe(false);
  });
});

describe('query difficulties are decimal text before conversion', () => {
  it.each(['BankItemListQuery', 'LibraryBrowseQuery'])('%s', (name) => {
    const Q = schema(name);
    expect(Q.parse({ difficultyMin: '0', difficultyMax: '1' })).toMatchObject({
      difficultyMin: 0,
      difficultyMax: 1,
    });
    expect(Q.parse({ difficultyMin: '0.25' })).toMatchObject({ difficultyMin: 0.25 });
    for (const bad of [
      '',
      ' ',
      '\t',
      ' 0.5',
      '0.5 ',
      '0x1',
      '1e-1',
      '.5',
      '-0',
      '+1',
      'NaN',
      '2',
    ]) {
      expect(ok(Q, { difficultyMin: bad }), JSON.stringify(bad)).toBe(false);
      expect(ok(Q, { difficultyMax: bad }), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('SectionDraft round-trips a D1 section (navigation null where the DB allows it)', () => {
  const d1Written = {
    id: id(104),
    position: 1,
    mode: 'inline',
    format: 'written',
    name: 'Written',
    weight: 50,
    items: [
      {
        id: id(112),
        position: 1,
        format: 'written',
        prompt: '[synthetic] Describe a process',
        rubric: {
          criteria: [{ id: 'c1', label: 'Clear', maxPoints: 5, anchors: ['first'], minHits: 1 }],
        },
      },
    ],
    shuffleItems: false,
    shuffleOptions: false,
    navigation: null,
  };
  const d1Mcq = {
    id: id(105),
    position: 2,
    mode: 'inline',
    format: 'mcq',
    name: 'Reasoning',
    weight: 50,
    items: viewInline.items,
    shuffleItems: false,
    shuffleOptions: false,
    navigation: null,
  };
  it('a D1 draft read and sent back keeps navigation null (no silent change to D1 behaviour)', () => {
    const view = { ...draftView, version: { ...draftView.version, sections: [d1Written, d1Mcq] } };
    const parsed = schema('TestDraftView').parse(view) as {
      version: { sections: (typeof d1Written | typeof d1Mcq)[] };
    };
    const request = {
      name: draftView.test.name,
      durationMinutes: draftView.version.durationMinutes,
      qualityCutoff: draftView.version.qualityCutoff,
      sections: parsed.version.sections.map((section) => ({
        ...withoutIds(section),
        items: section.items.map((item) => withoutIds(item)),
      })),
    };
    const saved = SaveTestDraftRequest.parse(request);
    expect(saved.sections.map((s) => s.navigation)).toEqual([null, null]);
    expect(saved).toEqual(request);
  });
  it('navigation null is accepted for a plain inline section of either format', () => {
    expect(ok(M1.SectionDraft, d1Request)).toBe(true);
    expect(ok(M1.SectionDraft, { ...d1Request, format: 'written' })).toBe(true);
    expect(ok(M1.SectionDraft, { ...d1Request, format: 'written', navigation: 'free' })).toBe(
      false,
    );
  });
  it.each([
    ['a pool section', { ...poolDraft, navigation: null }],
    ['shuffled items', { ...d1Request, shuffleItems: true }],
    ['shuffled options', { ...d1Request, shuffleOptions: true }],
    ['a paste rule', { ...d1Request, format: 'written', pasteRule: 'blocked' }],
  ])('navigation null is a D1 section only: refuses %s', (_label, section) => {
    expect(ok(M1.SectionDraft, section)).toBe(false);
  });
});

describe('BankItemDetail: a library copy is library-sourced', () => {
  const libraryDetail = {
    itemId: id(40),
    itemVersionId: id(41),
    versionNo: 1,
    workspaceId: id(9),
    status: 'approved',
    origin: 'library',
    isParameterised: false,
    librarySourced: true,
    createdBy: id(7),
    approvedBy: id(7),
    approvedAt: T0,
    exposureCount: 0,
    content: {
      format: 'mcq',
      stem: '[synthetic] Library copy',
      options: [
        { id: 'a', text: 'One' },
        { id: 'b', text: 'Two' },
      ],
      skillKey: 'quant',
      difficulty: 0.4,
    },
  };
  it('accepts a library copy without its key', () => {
    expect(ok(M1.BankItemDetail, libraryDetail)).toBe(true);
  });
  it('refuses origin library marked not library-sourced, with or without a key', () => {
    expect(
      ok(M1.BankItemDetail, {
        ...libraryDetail,
        librarySourced: false,
        content: { ...libraryDetail.content, key: { optionId: 'a' } },
      }),
    ).toBe(false);
    expect(ok(M1.BankItemDetail, { ...libraryDetail, librarySourced: false })).toBe(false);
  });
});

describe('ParamName reserves prototype-chain names', () => {
  const spec = {
    params: { a: { kind: 'int', min: 2, max: 9, step: 1 } },
    derived: { total: 'a * 2' },
    constraints: [],
    stem: '[synthetic] {{a}}',
    options: [
      { id: 'a', text: '{{total}}' },
      { id: 'b', text: '{{a}}' },
    ],
    correctOptionId: 'a',
    count: 5,
  };
  it('accepts ordinary names', () => {
    expect(ok(M1.ParamSpec, spec)).toBe(true);
  });
  it.each(['constructor', 'prototype', '__proto__'])(
    'refuses %s as a param or derived name',
    (name) => {
      // JSON.parse makes an own property even for __proto__, as a request body would.
      const text = JSON.stringify(spec);
      const asParam = JSON.parse(
        text.replace('"params":{', `"params":{"${name}":{"kind":"int","min":0,"max":1,"step":1},`),
      ) as { params: object };
      const asDerived = JSON.parse(text.replace('"derived":{', `"derived":{"${name}":"a",`)) as {
        derived: object;
      };
      expect(Object.keys(asParam.params)).toContain(name);
      expect(Object.keys(asDerived.derived)).toContain(name);
      expect(ok(M1.ParamSpec, asParam)).toBe(false);
      expect(ok(M1.ParamSpec, asDerived)).toBe(false);
    },
  );
});

describe('free text must be storable (no U+0000, no lone surrogate)', () => {
  const mcq = {
    format: 'mcq',
    stem: '[synthetic] Pick one',
    options: [
      { id: 'a', text: 'One' },
      { id: 'b', text: 'Two' },
    ],
    key: { optionId: 'a' },
    skillKey: 'quant',
    difficulty: 0.4,
  };
  const row = {
    rowNo: 2,
    format: 'mcq',
    skillKey: 'quant',
    difficulty: 0.4,
    stem: '[synthetic] Row stem',
    options: ['One', 'Two'],
    correct: 'a',
  };
  const inlineItem = {
    format: 'mcq',
    prompt: '[synthetic] Pick one',
    options: [
      { id: 'a', text: 'One' },
      { id: 'b', text: 'Two' },
    ],
    correctOptionId: 'a',
  };
  const section = { ...d1Request, items: [inlineItem] };
  const spec = (stemText: string) => ({
    params: { a: { kind: 'int', min: 2, max: 9, step: 1 } },
    derived: {},
    constraints: [],
    stem: stemText,
    options: [
      { id: 'a', text: '1' },
      { id: 'b', text: '2' },
    ],
    correctOptionId: 'a',
    count: 5,
  });
  const two = { id: 'b', text: 'Two' };
  const cases: [string, z.ZodType, (text: string) => unknown][] = [
    ['a bank stem', M1.BankItemDraft, (t) => ({ ...mcq, stem: t })],
    ['a bank option', M1.BankItemDraft, (t) => ({ ...mcq, options: [{ id: 'a', text: t }, two] })],
    [
      'an image alt',
      M1.BankItemDraft,
      (t) => ({ ...mcq, media: [{ key: `item-media/${id(1)}/${'c'.repeat(64)}.png`, alt: t }] }),
    ],
    ['an import row stem', M1.ImportRow, (t) => ({ ...row, stem: t })],
    ['an import row option', M1.ImportRow, (t) => ({ ...row, options: [t, 'Two'] })],
    ['an import row in a batch', M1.ImportRowsRequest, (t) => ({ rows: [{ ...row, stem: t }] })],
    ['a section name', M1.SectionDraft, (t) => ({ ...section, name: t })],
    [
      'an inline item prompt (D1 item shape)',
      M1.SectionDraft,
      (t) => ({ ...section, items: [{ ...inlineItem, prompt: t }] }),
    ],
    [
      'an inline item option',
      M1.SectionDraft,
      (t) => ({ ...section, items: [{ ...inlineItem, options: [{ id: 'a', text: t }, two] }] }),
    ],
    [
      'a draft name',
      M1.SaveTestDraftRequest,
      (t) => ({ name: t, durationMinutes: 30, qualityCutoff: 40, sections: [] }),
    ],
    ['a pool name', M1.PoolRequest, (t) => ({ name: t, format: 'mcq' })],
    [
      'a job title',
      M1.CreateTestFromTemplateRequest,
      (t) => ({ jobTitle: t, templateKey: 'customer_support', templateVersion: 1 }),
    ],
    ['a JD text', M1.BlueprintProposeRequest, (t) => ({ jdText: t })],
    ['a param spec stem', M1.ParamSpec, (t) => spec(`{{a}} ${t}`)],
    [
      'an invite display name',
      M1.MemberInviteRequest,
      (t) => ({ email: 'member@example.test', roles: ['recruiter'], displayName: t }),
    ],
  ];
  it.each(cases)('%s: text accepted, U+0000 and a lone surrogate refused', (_l, s, make) => {
    expect(ok(s, make('[synthetic] ok'))).toBe(true);
    expect(ok(s, make('[synthetic] ok \u{1F600}'))).toBe(true);
    expect(ok(s, make('a\u0000b'))).toBe(false);
    expect(ok(s, make('a\uD800b'))).toBe(false);
    expect(ok(s, make('a\uDC00'))).toBe(false);
  });
});

describe('the DELETE …/members/invites/:inviteId answer (MemberInviteView, cancelled)', () => {
  it('a cancelled invite has no membership', () => {
    const V = schema('MemberInviteView');
    expect(ok(V, { ...invite, status: 'cancelled' })).toBe(true);
    expect(ok(V, { ...invite, status: 'cancelled', membershipId: id(91) })).toBe(false);
  });
});
