// Role templates and JD -> blueprint (spec m1 §6.1, ABH-5, M1-16, M1-17, R2-5, R2-8, R3-7, R5-29, E18, E19; §6.11
// `GET …/templates`, `POST …/blueprints/propose`, `POST …/tests/from-template`). Templates and library items are read
// as trace_api through the injected ReferenceSource; the JD is matched deterministically (normalised token overlap with
// the template's keywords) and never stored, logged or returned (only its SHA-256 and the permille). A template creates
// the job, the test and its draft: one pool per available blueprint section, filled with library copies (up to 10x the
// draw), Standard (or the template's preset) with the org's locks, weights summing to 100; voice and typing sections
// are skipped with a note. R5-71 d / R5-63 f: the writes are one call of `public.create_test_from_template` (atomic);
// the template list pages by 50 over the whole merged catalogue. Synthetic data only.
import {
  BlueprintProposeResponse,
  CreateTestFromTemplateResponse,
  RoleTemplateListResponse,
  encodePageCursor,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../candidate/encoding.js';
import { OrgError, PGRST_MAX_ROWS, RestError, rpcOf } from '../tests/org-context.js';
import { idMaker, type Row } from '../tests/rest.test-helpers.js';
import {
  OPEN_BOOK,
  ORG,
  STANDARD,
  STRICT,
  USER,
  WS,
  authoringDb,
  callerOf,
  rowsOf,
  type AuthoringDb,
} from '../tests/tests.test-helpers.js';
import type { LibraryItemRef, ReferenceSource, TemplateRef } from './reference.js';
import {
  TEMPLATE_LIST_CAP,
  createTemplatesRoutes,
  matchPermille,
  templateDraftPayload,
  tokensOf,
} from './routes.js';
import { ownTemplateRow, withTemplateRpc } from './templates.test-helpers.js';

const CUSTOMER_SUPPORT: TemplateRef = {
  id: '7e000000-0000-4000-8000-000000000001',
  templateKey: 'customer_support',
  version: 1,
  name: 'Customer Support',
  keywords: ['customer', 'support', 'service', 'helpdesk', 'ticket', 'email', 'chat', 'complaint'],
  blueprint: {
    sections: [
      { title: 'Verbal ability', format: 'mcq', skillKey: 'verbal', drawCount: 2, available: true },
      {
        title: 'Written communication',
        format: 'written',
        skillKey: 'written_communication',
        drawCount: 1,
        available: true,
      },
      { title: 'Typing', format: 'typing', skillKey: 'typing', drawCount: 1, available: false },
    ],
    totalTimeSeconds: 2400,
  },
  presetKey: 'standard',
};
const BPO_VOICE: TemplateRef = {
  id: '7e000000-0000-4000-8000-000000000002',
  templateKey: 'bpo_voice',
  version: 1,
  name: 'BPO Voice',
  keywords: ['bpo', 'voice', 'call', 'calls', 'inbound', 'outbound', 'telecaller', 'accent'],
  blueprint: {
    sections: [
      { title: 'Reading', format: 'mcq', skillKey: 'reading', drawCount: 1, available: true },
      {
        title: 'Spoken English',
        format: 'voice',
        skillKey: 'spoken_english',
        drawCount: 1,
        available: false,
      },
    ],
    totalTimeSeconds: 2100,
  },
  presetKey: 'strict',
};

const libraryRefs = (skillKey: string, format: 'mcq' | 'written', count: number) =>
  Array.from({ length: count }, (_, n): LibraryItemRef => ({
    libraryItemVersionId: `${format === 'mcq' ? 'b1' : 'b2'}000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`,
    format,
    skillKey,
    difficulty: 0.45,
    createdAt: `2026-10-01T00:00:00.${String(100000 + n)}+00:00`,
  }));

const reference = (
  library: LibraryItemRef[],
  templates: TemplateRef[] = [CUSTOMER_SUPPORT, BPO_VOICE],
): ReferenceSource & { browsed: unknown[] } => {
  const browsed: unknown[] = [];
  return {
    browsed,
    settingsCatalog: async () => ({
      catalogVersion: 'm1-settings-v1',
      presets: {
        strict: { version: 1, values: { ...STRICT } },
        standard: { version: 5, values: { ...STANDARD } },
        open_book: { version: 1, values: { ...OPEN_BOOK } },
      },
    }),
    templates: async () => templates,
    browse: async (_caller, _org, filter) => {
      browsed.push(filter);
      const rows = library
        .filter((r) => r.skillKey === filter.skillKey && r.format === filter.format)
        .filter(
          (r) =>
            filter.after === null ||
            r.createdAt > filter.after.createdAt ||
            (r.createdAt === filter.after.createdAt && r.libraryItemVersionId > filter.after.id),
        );
      return rows.slice(0, filter.limit);
    },
  };
};

/** The library copy trigger (M1-a R2-5): one approved local copy per library version, ids in request order. */
const withLibraryCopies = (db: AuthoringDb) => {
  const copy = idMaker('c0');
  const pool = idMaker('90');
  const job = idMaker('30');
  db.hooks.library_copy_requests = {
    insert: (row, d) => {
      const ids = (row.library_item_version_ids as string[]).map((source) => {
        const id = copy();
        (d.tables.item_versions ??= []).push({
          id,
          item_id: id,
          org_id: row.org_id,
          workspace_id: row.workspace_id,
          section_id: null,
          test_version_id: null,
          position: null,
          format: source.startsWith('b1') ? 'mcq' : 'written',
          stem: '[synthetic] library copy',
          options: source.startsWith('b1')
            ? [
                { id: 'a', text: 'One' },
                { id: 'b', text: 'Two' },
              ]
            : null,
          rubric_version_id: null,
          media: null,
          skill_key: 'verbal',
          difficulty: 0.45,
          is_parameterised: false,
          status: 'approved',
          origin: 'library',
          source_item_version_id: source,
        });
        return id;
      });
      return { id: copy(), ...row, result_item_version_ids: ids };
    },
  };
  db.hooks.pools = { insert: (row) => ({ id: pool(), status: 'active', ...row }) };
  db.hooks.jobs = { insert: (row) => ({ id: job(), ...row }) };
  db.hooks.pool_items = { insert: (row) => ({ workspace_id: WS, ...row }) };
};

/** The injected LibraryLimiter (R5-56 g; shape of a Workers rate-limit binding): records keys, allows `budget` calls. */
const limiterOf = (budget = Number.POSITIVE_INFINITY) => {
  const keys: string[] = [];
  return {
    keys,
    limit: async ({ key }: { key: string }) => {
      keys.push(key);
      return { success: keys.length <= budget };
    },
  };
};

const setup = (
  opts: {
    library?: LibraryItemRef[];
    locks?: boolean;
    ref?: boolean;
    limiter?: ReturnType<typeof limiterOf>;
    /** No limiter bound (the env has no rate-limit binding). */
    unboundLimiter?: boolean;
    /** The library's published templates (default: Customer Support and BPO Voice). */
    templates?: TemplateRef[];
    /** The org's own role_templates rows. */
    own?: Row[];
  } = {},
) => {
  const db = authoringDb();
  withLibraryCopies(db);
  const rpc = withTemplateRpc(db);
  rowsOf(db, 'role_templates').push(...(opts.own ?? []));
  if (opts.locks === true) {
    rowsOf(db, 'org_integrity_locks').push({
      id: '0c000000-0000-4000-8000-000000000001',
      org_id: ORG,
      setting_key: 'paste_written',
      locked_value: 'blocked',
      locked_by: null,
      locked_at: '2026-10-17T09:00:00.000+00:00',
    });
  }
  const ref = reference(
    opts.library ?? [
      ...libraryRefs('verbal', 'mcq', 25),
      ...libraryRefs('written_communication', 'written', 3),
    ],
    opts.templates,
  );
  const limiter = opts.limiter ?? limiterOf();
  const app = new Hono<{ Bindings: Env }>();
  app.route(
    '/',
    createTemplatesRoutes({
      org: { context: async () => ({ caller: callerOf(), rest: db.rest }) },
      reference: () => (opts.ref === false ? null : ref),
      limiter: () => (opts.unboundLimiter === true ? null : limiter),
    }),
  );
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      `https://api.test/v1/orgs/${ORG}${path}`,
      {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: { 'content-type': 'application/json' },
      },
      {} as Env,
    );
  return { db, call, ref, limiter, rpc };
};

describe('JD matching (M1-17)', () => {
  it('tokenises with NFKC, lower case, letters and digits, and drops stop words', () => {
    expect(tokensOf('The Customer-Support role, for ＥＭＡＩＬ and Chat!')).toEqual(
      new Set(['customer', 'support', 'role', 'email', 'chat']),
    );
  });

  it('permille = |JD tokens ∩ keywords| / |keywords|, deterministic', () => {
    expect(
      matchPermille(tokensOf('customer support via email and chat'), CUSTOMER_SUPPORT.keywords),
    ).toBe(500);
    expect(matchPermille(tokensOf('nothing relevant here'), CUSTOMER_SUPPORT.keywords)).toBe(0);
  });
});

describe('GET …/templates and POST …/blueprints/propose', () => {
  it('lists the published templates the caller may use', async () => {
    const s = setup();
    const res = RoleTemplateListResponse.parse(await (await s.call('GET', '/templates')).json());
    expect(res).toEqual({
      templates: [
        { templateKey: 'bpo_voice', version: 1, name: 'BPO Voice', presetKey: 'strict' },
        {
          templateKey: 'customer_support',
          version: 1,
          name: 'Customer Support',
          presetKey: 'standard',
        },
      ],
      nextCursor: null,
    });
  });

  it('proposes the best template at or above 15%; below, null; the JD is never echoed or stored', async () => {
    const s = setup();
    const jd =
      'We need a helpdesk agent for customer email and chat ticket. Call p-x on 9876543210.';
    const res = await s.call('POST', '/blueprints/propose', { jdText: jd });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = BlueprintProposeResponse.parse(JSON.parse(text));
    expect(body.proposal).toMatchObject({ templateKey: 'customer_support', version: 1 });
    expect(body.proposal?.matchPermille).toBe(625);
    expect(body.proposal?.sections.map((x) => [x.format, x.available])).toEqual([
      ['mcq', true],
      ['written', true],
      ['typing', false],
    ]);
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain('helpdesk agent');
    expect(JSON.stringify(s.db.calls)).not.toContain('helpdesk');
    const none = BlueprintProposeResponse.parse(
      await (await s.call('POST', '/blueprints/propose', { jdText: 'a gardener' })).json(),
    );
    expect(none.proposal).toBeNull();
  });

  it('no reference read bound is 503; a bad body 400', async () => {
    expect((await setup({ ref: false }).call('GET', '/templates')).status).toBe(503);
    expect((await setup().call('POST', '/blueprints/propose', { jdText: '' })).status).toBe(400);
  });
});

describe('POST …/tests/from-template', () => {
  it('creates the job, the test and a pool-mode draft from the blueprint; skips typing with a note', async () => {
    const s = setup();
    const jd = 'customer support email chat';
    const res = await s.call('POST', '/tests/from-template', {
      jobTitle: 'Synthetic Support Associate',
      templateKey: 'customer_support',
      templateVersion: 1,
      jdText: jd,
    });
    expect(res.status).toBe(201);
    const body = CreateTestFromTemplateResponse.parse(await res.json());
    expect(body.skippedSections).toEqual([{ title: 'Typing', format: 'typing' }]);
    const draft = body.draft.version;
    expect(draft).toMatchObject({ status: 'draft', durationMinutes: 40, qualityCutoff: 40 });
    expect(
      draft.sections.map((x) => [x.name, x.mode, x.format, x.drawCount, x.navigation]),
    ).toEqual([
      ['Verbal ability', 'pool', 'mcq', 2, 'free'],
      ['Written communication', 'pool', 'written', 1, 'forward_only'],
    ]);
    expect(draft.sections.reduce((n, x) => n + x.weight, 0)).toBe(100);
    expect(draft.sections[1]?.pasteRule).toBe('allowed_logged');
    // R2-8: 10x the draw where the library has enough (20 of 25), else what it has (3 of 10).
    const pools = rowsOf(s.db, 'pools');
    expect(pools.map((p) => [p.name, p.format, p.skill_key])).toEqual([
      ['Verbal ability', 'mcq', 'verbal'],
      ['Written communication', 'written', 'written_communication'],
    ]);
    const items = rowsOf(s.db, 'pool_items');
    expect(items.filter((p) => p.pool_id === pools[0]?.id)).toHaveLength(20);
    expect(items.filter((p) => p.pool_id === pools[1]?.id)).toHaveLength(3);
    // The job keeps the JD hash and the permille, never the text (M1-17, E19).
    const [job] = rowsOf(s.db, 'jobs');
    expect(job).toMatchObject({
      org_id: ORG,
      workspace_id: WS,
      title: 'Synthetic Support Associate',
      role_template_version_id: CUSTOMER_SUPPORT.id,
      jd_sha256: await sha256Hex(jd),
      template_match_permille: 500,
    });
    expect(JSON.stringify(s.db.tables)).not.toContain(jd);
    expect(rowsOf(s.db, 'tests')[0]).toMatchObject({
      job_id: job?.id,
      name: 'Synthetic Support Associate',
    });
    // The template's preset, stored as the draft's settings.
    expect(rowsOf(s.db, 'ruleset_versions')[0]).toMatchObject({
      preset_key: 'standard',
      settings: STANDARD,
    });
    expect(rowsOf(s.db, 'library_copy_requests')[0]).toMatchObject({
      org_id: ORG,
      workspace_id: WS,
    });
    // R5-71 d: one write, the function, with the DB-shape payload (the JD text never in it).
    expect(s.rpc.apiWrites()).toEqual([{ method: 'rpc', table: 'create_test_from_template' }]);
    expect(s.rpc.payloads).toEqual([
      {
        p_org: ORG,
        p_payload: {
          workspaceId: WS,
          jobTitle: 'Synthetic Support Associate',
          roleTemplateVersionId: CUSTOMER_SUPPORT.id,
          jdSha256: await sha256Hex(jd),
          templateMatchPermille: 500,
          totalTimeSeconds: 2400,
          qualityCutoff: 40,
          presetKey: 'standard',
          presetVersion: 5,
          settings: STANDARD,
          sections: [
            {
              name: 'Verbal ability',
              format: 'mcq',
              weight: 50,
              drawCount: 2,
              skillKey: 'verbal',
              shuffleItems: true,
              shuffleOptions: true,
              navigation: 'free',
              libraryItemVersionIds: libraryRefs('verbal', 'mcq', 20).map(
                (r) => r.libraryItemVersionId,
              ),
            },
            {
              name: 'Written communication',
              format: 'written',
              weight: 50,
              drawCount: 1,
              skillKey: 'written_communication',
              shuffleItems: false,
              shuffleOptions: false,
              navigation: 'forward_only',
              libraryItemVersionIds: libraryRefs('written_communication', 'written', 3).map(
                (r) => r.libraryItemVersionId,
              ),
            },
          ],
        },
      },
    ]);
    expect(JSON.stringify(s.rpc.payloads)).not.toContain(jd);
  });

  it("applies the org's admin locks to the template preset (custom when a lock moved a value)", async () => {
    const s = setup({ locks: true });
    const res = await s.call('POST', '/tests/from-template', {
      jobTitle: 'Synthetic Support Associate',
      templateKey: 'customer_support',
      templateVersion: 1,
    });
    expect(res.status).toBe(201);
    expect(rowsOf(s.db, 'ruleset_versions')[0]).toMatchObject({
      preset_key: null,
      settings: { ...STANDARD, paste_written: 'blocked' },
    });
    expect(rowsOf(s.db, 'jobs')[0]).toMatchObject({
      jd_sha256: null,
      template_match_permille: null,
    });
  });

  it('a library without items still creates the pool sections (the editor shows the gap)', async () => {
    const s = setup({ library: [] });
    const res = await s.call('POST', '/tests/from-template', {
      jobTitle: 'Synthetic Voice Agent',
      templateKey: 'bpo_voice',
      templateVersion: 1,
    });
    expect(res.status).toBe(201);
    const body = CreateTestFromTemplateResponse.parse(await res.json());
    expect(body.skippedSections).toEqual([{ title: 'Spoken English', format: 'voice' }]);
    expect(body.draft.version.sections).toHaveLength(1);
    expect(body.draft.version.sections[0]?.weight).toBe(100);
    expect(rowsOf(s.db, 'library_copy_requests')).toEqual([]);
    expect(rowsOf(s.db, 'ruleset_versions')[0]).toMatchObject({ preset_key: 'strict' });
  });

  it.each([
    [
      'only a voice section',
      [
        {
          title: 'Spoken English',
          format: 'voice',
          skillKey: 'spoken_english',
          drawCount: 1,
          available: true,
        },
      ],
      [{ title: 'Spoken English', format: 'voice' }],
    ],
    // R5-71 i (a8 fix round lead ask): an unavailable mcq or written section is skipped and listed too.
    [
      'only an unavailable mcq section',
      [{ title: 'Choices', format: 'mcq', skillKey: 'verbal', drawCount: 2, available: false }],
      [{ title: 'Choices', format: 'mcq' }],
    ],
  ])(
    'an own template with %s answers 201 with an empty draft and every section skipped (M1-16, E18)',
    async (_name, sections, skipped) => {
      const own = ownTemplateRow(7, { blueprint: { sections, totalTimeSeconds: 900 } });
      const s = setup({ own: [own] });
      const res = await s.call('POST', '/tests/from-template', {
        jobTitle: 'Synthetic Empty Blueprint',
        templateKey: 'role_0007',
        templateVersion: 1,
      });
      expect(res.status).toBe(201);
      const body = CreateTestFromTemplateResponse.parse(await res.json());
      expect(body.skippedSections).toEqual(skipped);
      expect(body.draft.version.sections).toEqual([]);
      expect(s.rpc.apiWrites()).toEqual([{ method: 'rpc', table: 'create_test_from_template' }]);
      expect(s.rpc.payloads).toHaveLength(1);
      expect((s.rpc.payloads[0]?.p_payload as { sections: unknown }).sections).toEqual([]);
      expect(rowsOf(s.db, 'jobs')).toHaveLength(1);
      expect(rowsOf(s.db, 'tests')).toHaveLength(1);
      expect(rowsOf(s.db, 'test_versions')).toHaveLength(1);
      expect(rowsOf(s.db, 'pools')).toEqual([]);
    },
  );

  it('an unknown template is 404; a reviewer is 404 before any write', async () => {
    const s = setup();
    expect(
      (
        await s.call('POST', '/tests/from-template', {
          jobTitle: 'X',
          templateKey: 'unknown_role',
          templateVersion: 1,
        })
      ).status,
    ).toBe(404);
    const r = setup();
    const member = rowsOf(r.db, 'memberships')[0];
    if (member !== undefined) member.roles = ['reviewer'];
    expect(
      (
        await r.call('POST', '/tests/from-template', {
          jobTitle: 'X',
          templateKey: 'customer_support',
          templateVersion: 1,
        })
      ).status,
    ).toBe(404);
    expect(r.db.calls.filter((c) => c.method !== 'select')).toEqual([]);
  });
});

describe('POST …/tests/from-template: limiter, atomic write, preset version (R5-63 e, f; R5-71 d)', () => {
  const body = {
    jobTitle: 'Synthetic Support Associate',
    templateKey: 'customer_support',
    templateVersion: 1,
  };

  it('goes through the per-user LibraryLimiter; a spent budget is 429 before any write', async () => {
    const ok = setup();
    expect((await ok.call('POST', '/tests/from-template', body)).status).toBe(201);
    expect(ok.limiter.keys).toEqual([USER]);
    const spent = setup({ limiter: limiterOf(0) });
    const res = await spent.call('POST', '/tests/from-template', body);
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('{"error":{"code":"rate_limited"}}');
    expect(spent.db.calls.filter((c) => c.method !== 'select')).toEqual([]);
    expect(spent.ref.browsed).toEqual([]);
  });

  it('an unbound limiter answers 503 before any write (fail closed, never "allow")', async () => {
    const s = setup({ unboundLimiter: true });
    const res = await s.call('POST', '/tests/from-template', body);
    expect(res.status).toBe(503);
    expect(s.db.calls.filter((c) => c.method !== 'select')).toEqual([]);
    expect(s.ref.browsed).toEqual([]);
  });

  it('library_cap mid-way leaves no job, test, version, pool or copy (one transaction, R5-63 f)', async () => {
    const s = setup();
    s.db.failNext('insert', 'library_copy_requests', new RestError(403, '42501', 'library_cap'));
    const res = await s.call('POST', '/tests/from-template', body);
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('{"error":{"code":"library_cap"}}');
    for (const table of [
      'jobs',
      'tests',
      'test_versions',
      'ruleset_versions',
      'pools',
      'pool_items',
      'library_copy_requests',
      'sections',
    ]) {
      expect(rowsOf(s.db, table), table).toEqual([]);
    }
    // Nothing to undo: the api never archives (no update of its own).
    expect(s.rpc.apiWrites()).toEqual([{ method: 'rpc', table: 'create_test_from_template' }]);
  });

  it('a failed draft save inside the function also leaves nothing', async () => {
    const s = setup();
    s.db.failNext('rpc', 'save_test_draft', new RestError(503, null));
    const res = await s.call('POST', '/tests/from-template', body);
    expect(res.status).toBe(503);
    for (const table of ['jobs', 'tests', 'test_versions', 'pools', 'pool_items', 'sections']) {
      expect(rowsOf(s.db, table), table).toEqual([]);
    }
    expect(s.rpc.apiWrites()).toEqual([{ method: 'rpc', table: 'create_test_from_template' }]);
  });

  it("maps the function's refusal by its code (a guard key, a hidden parent)", async () => {
    const s = setup();
    s.db.failNext('rpc', 'create_test_from_template', new RestError(403, '42501'));
    const res = await s.call('POST', '/tests/from-template', body);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":{"code":"not_found"}}');
    const g = setup();
    g.db.failNext(
      'rpc',
      'create_test_from_template',
      new RestError(400, '55000', 'library_not_approved'),
    );
    expect((await g.call('POST', '/tests/from-template', body)).status).toBe(409);
  });

  it('an answer that is not {jobId, testId, versionId} uuids is 503 unavailable', async () => {
    for (const answerOf of [
      () => ({ jobId: 'x', testId: 'y', versionId: 'z' }),
      () => null,
      () => ({
        jobId: '30000000-0000-4000-8000-000000000001',
        testId: 'e1000000-0000-4000-8000-000000000001',
      }),
      () => ({
        jobId: '30000000-0000-4000-8000-000000000001',
        testId: 'e1000000-0000-4000-8000-000000000001',
        versionId: 'f1000000-0000-4000-8000-000000000001',
        extra: true,
      }),
    ]) {
      const s = setup();
      s.db.functions.create_test_from_template = answerOf;
      const res = await s.call('POST', '/tests/from-template', body);
      expect(res.status).toBe(503);
      expect(await res.text()).toBe('{"error":{"code":"unavailable"}}');
    }
  });

  it('a draw of 100 sends 1,000 library ids in one section (copied 500 a request)', async () => {
    const large: TemplateRef = {
      ...CUSTOMER_SUPPORT,
      id: '7e000000-0000-4000-8000-000000000003',
      templateKey: 'large_verbal',
      blueprint: {
        sections: [
          {
            title: 'Verbal ability',
            format: 'mcq',
            skillKey: 'verbal',
            drawCount: 100,
            available: true,
          },
        ],
        totalTimeSeconds: 3600,
      },
    };
    const s = setup({ templates: [large], library: libraryRefs('verbal', 'mcq', 1005) });
    const res = await s.call('POST', '/tests/from-template', {
      ...body,
      templateKey: 'large_verbal',
    });
    expect(res.status).toBe(201);
    const sent = s.rpc.payloads[0]?.p_payload as {
      sections: { libraryItemVersionIds: string[] }[];
    };
    expect(sent.sections[0]?.libraryItemVersionIds).toHaveLength(1000);
    expect(rowsOf(s.db, 'library_copy_requests')).toHaveLength(2);
    expect(rowsOf(s.db, 'pool_items')).toHaveLength(1000);
  });

  it('more than 2,000 library ids in one call (all sections together) is 503 before any write', async () => {
    const verbal = (n: number) => ({
      title: `Verbal ${n}`,
      format: 'mcq' as const,
      skillKey: 'verbal',
      drawCount: 100,
      available: true,
    });
    const three: TemplateRef = {
      ...CUSTOMER_SUPPORT,
      id: '7e000000-0000-4000-8000-000000000004',
      templateKey: 'three_verbal',
      blueprint: { sections: [verbal(1), verbal(2), verbal(3)], totalTimeSeconds: 3600 },
    };
    const s = setup({ templates: [three], library: libraryRefs('verbal', 'mcq', 1005) });
    const res = await s.call('POST', '/tests/from-template', {
      ...body,
      templateKey: 'three_verbal',
    });
    expect(res.status).toBe(503);
    expect(s.rpc.payloads).toEqual([]);
    expect(s.rpc.apiWrites()).toEqual([]);
    expect(rowsOf(s.db, 'jobs')).toEqual([]);
    const two: TemplateRef = {
      ...three,
      id: '7e000000-0000-4000-8000-000000000005',
      templateKey: 'two_verbal',
      blueprint: { sections: [verbal(1), verbal(2)], totalTimeSeconds: 3600 },
    };
    const ok = setup({ templates: [two], library: libraryRefs('verbal', 'mcq', 1005) });
    expect(
      (await ok.call('POST', '/tests/from-template', { ...body, templateKey: 'two_verbal' }))
        .status,
    ).toBe(201);
  });

  it('the payload counts library ids across sections: 2,000 pass, 2,001 are 503 unavailable', () => {
    const section = (name: string, count: number) => ({
      title: name,
      format: 'mcq' as const,
      skillKey: 'verbal',
      drawCount: 100,
      weight: 50,
      libraryItemVersionIds: libraryRefs('verbal', 'mcq', count).map((r) => r.libraryItemVersionId),
    });
    const payloadOf = (sections: ReturnType<typeof section>[]) =>
      templateDraftPayload({
        workspaceId: WS,
        jobTitle: 'Synthetic Support Associate',
        template: CUSTOMER_SUPPORT,
        jdSha256: null,
        templateMatchPermille: null,
        settings: { presetKey: 'standard', presetVersion: 5, settings: STANDARD },
        sections,
      });
    expect(payloadOf([section('A', 1000), section('B', 1000)]).sections).toHaveLength(2);
    let thrown: unknown = null;
    try {
      payloadOf([section('A', 1000), section('B', 1000), section('C', 1)]);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(OrgError);
    expect((thrown as OrgError).code).toBe('unavailable');
  });

  it('the function de-duplicates ids within a section (order kept) and refuses > 2,000 in total', async () => {
    const dup = libraryRefs('verbal', 'mcq', 3);
    const first = dup[0];
    if (first === undefined) throw new Error('fixture');
    const s = setup({ library: [...dup, first] });
    const res = await s.call('POST', '/tests/from-template', body);
    expect(res.status).toBe(201);
    const sent = s.rpc.payloads[0]?.p_payload as {
      sections: { libraryItemVersionIds: string[] }[];
    };
    expect(sent.sections[0]?.libraryItemVersionIds).toHaveLength(4);
    const requested = rowsOf(s.db, 'library_copy_requests').flatMap(
      (r) => r.library_item_version_ids as string[],
    );
    expect(requested).toEqual(dup.map((r) => r.libraryItemVersionId));
    expect(rowsOf(s.db, 'pool_items')).toHaveLength(3);
    // Past 2,000 in total the function itself refuses with 22023 (the api never sends it).
    const big = setup();
    const ids = libraryRefs('verbal', 'mcq', 1000).map((r) => r.libraryItemVersionId);
    const section = (name: string) => ({
      name,
      format: 'mcq',
      weight: 25,
      drawCount: 1,
      skillKey: 'verbal',
      shuffleItems: true,
      shuffleOptions: true,
      navigation: 'free',
      libraryItemVersionIds: ids,
    });
    const call = (sections: unknown[]) =>
      rpcOf(big.db.rest)('create_test_from_template', {
        p_org: ORG,
        p_payload: {
          workspaceId: WS,
          jobTitle: 'Synthetic',
          roleTemplateVersionId: CUSTOMER_SUPPORT.id,
          totalTimeSeconds: 1200,
          qualityCutoff: 40,
          settings: { ...STANDARD },
          sections,
        },
      });
    await expect(call([section('A'), section('B'), section('C')])).rejects.toMatchObject({
      sqlstate: '22023',
    });
    expect(rowsOf(big.db, 'jobs')).toEqual([]);
  });

  it('more than 1,000 library ids for one section is 503 unavailable before the call', () => {
    const payloadWith = (count: number) =>
      templateDraftPayload({
        workspaceId: WS,
        jobTitle: 'Synthetic Support Associate',
        template: CUSTOMER_SUPPORT,
        jdSha256: null,
        templateMatchPermille: null,
        settings: { presetKey: 'standard', presetVersion: 5, settings: STANDARD },
        sections: [
          {
            title: 'Verbal ability',
            format: 'mcq',
            skillKey: 'verbal',
            drawCount: 100,
            weight: 100,
            libraryItemVersionIds: libraryRefs('verbal', 'mcq', count).map(
              (r) => r.libraryItemVersionId,
            ),
          },
        ],
      });
    expect(payloadWith(1000).sections[0]?.libraryItemVersionIds).toHaveLength(1000);
    let thrown: unknown = null;
    try {
      payloadWith(1001);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(OrgError);
    expect((thrown as OrgError).code).toBe('unavailable');
  });

  it("stores the template preset's catalog version; a lock that moves a value stores none", async () => {
    const s = setup();
    expect((await s.call('POST', '/tests/from-template', body)).status).toBe(201);
    expect(rowsOf(s.db, 'ruleset_versions')[0]).toMatchObject({
      preset_key: 'standard',
      preset_version: 5,
    });
    const locked = setup({ locks: true });
    expect((await locked.call('POST', '/tests/from-template', body)).status).toBe(201);
    expect(rowsOf(locked.db, 'ruleset_versions')[0]).toMatchObject({
      preset_key: null,
      preset_version: null,
    });
  });
});

describe('GET …/templates paging (R5-63 f)', () => {
  const list = async (s: ReturnType<typeof setup>, cursor?: string) => {
    const res = await s.call(
      'GET',
      cursor === undefined ? '/templates' : `/templates?cursor=${encodeURIComponent(cursor)}`,
    );
    expect(res.status).toBe(200);
    return RoleTemplateListResponse.parse(await res.json());
  };
  /** n own templates role_0001.. (stored in reverse, so no read relies on insertion order). */
  const own = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => ownTemplateRow(from + i)).reverse();

  it('pages the merged list by 50 in (templateKey, version) order; the last page has no cursor', async () => {
    const s = setup({ own: own(120) });
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await list(s, cursor);
      sizes.push(page.templates.length);
      seen.push(...page.templates.map((t) => `${t.templateKey}:${String(t.version)}`));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(sizes).toEqual([50, 50, 22]);
    expect(new Set(seen).size).toBe(122);
    expect(seen.slice(0, 3)).toEqual(['bpo_voice:1', 'customer_support:1', 'role_0001:1']);
    expect(seen.at(-1)).toBe('role_0120:1');
    expect([...seen].sort()).toEqual(seen);
  });

  it("the org's own template wins a clash with the library's; drafts and other orgs are not listed", async () => {
    const s = setup({
      own: [
        ownTemplateRow(1, { template_key: 'customer_support', name: '[synthetic] Own support' }),
        ownTemplateRow(2, { status: 'draft' }),
        ownTemplateRow(3, { org_id: 'a1000000-0000-4000-8000-000000000003' }),
      ],
    });
    const page = await list(s);
    expect(page.templates.map((t) => [t.templateKey, t.name])).toEqual([
      ['bpo_voice', 'BPO Voice'],
      ['customer_support', '[synthetic] Own support'],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('reads own templates in keyset pages of PGRST_MAX_ROWS until exhausted', async () => {
    const s = setup({ own: own(1500) });
    const page = await list(s);
    expect(page.templates).toHaveLength(50);
    const reads = s.db.calls.filter((c) => c.table === 'role_templates').map((c) => c.query);
    expect(reads.map((q) => [q.order, q.limit])).toEqual([
      ['id.asc', String(PGRST_MAX_ROWS)],
      ['id.asc', String(PGRST_MAX_ROWS)],
    ]);
    expect(reads[0]?.id).toBeUndefined();
    expect(reads[1]?.id).toBe(`gt.${String(ownTemplateRow(1000).id)}`);
  });

  it('past 2,000 merged templates every reader answers 503 (never a cut list)', async () => {
    expect(TEMPLATE_LIST_CAP).toBe(2000);
    const fits = setup({ own: own(TEMPLATE_LIST_CAP - 2) });
    expect((await fits.call('GET', '/templates')).status).toBe(200);
    const over = setup({ own: own(TEMPLATE_LIST_CAP - 1) });
    for (const [method, path, payload] of [
      ['GET', '/templates', undefined],
      ['POST', '/blueprints/propose', { jdText: 'customer support' }],
      [
        'POST',
        '/tests/from-template',
        { jobTitle: 'X', templateKey: 'customer_support', templateVersion: 1 },
      ],
    ] as const) {
      const res = await over.call(method, path, payload);
      expect(res.status, path).toBe(503);
      expect(await res.text()).toBe('{"error":{"code":"unavailable"}}');
    }
    expect(over.rpc.payloads).toEqual([]);
  });

  it('a malformed cursor, a cursor of another list, or a vanished anchor is 400', async () => {
    const s = setup({ own: own(120) });
    for (const bad of [
      'not-a-cursor!',
      'e30',
      encodePageCursor({
        createdAt: '2026-10-20T09:00:00.000+00:00',
        id: String(ownTemplateRow(3).id),
      }),
    ]) {
      const res = await s.call('GET', `/templates?cursor=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
      expect(await res.text()).toBe('{"error":{"code":"bad_request"}}');
    }
    const first = await list(s);
    expect(first.nextCursor).not.toBeNull();
    // The anchor (the page's last row) is retired between pages: its place is unknown, so the cursor is refused.
    const anchor = first.templates.at(-1);
    s.db.tables.role_templates = rowsOf(s.db, 'role_templates').filter(
      (r) => r.template_key !== anchor?.templateKey,
    );
    const res = await s.call(
      'GET',
      `/templates?cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
    );
    expect(res.status).toBe(400);
  });

  it('propose and from-template scan every page (a template past the first 50)', async () => {
    const late = ownTemplateRow(200, {
      template_key: 'zz_synthetic_garden',
      keywords: ['gardener', 'plants', 'lawn'],
    });
    const s = setup({ own: [...own(120), late] });
    const proposed = BlueprintProposeResponse.parse(
      await (
        await s.call('POST', '/blueprints/propose', { jdText: 'a gardener for plants and lawn' })
      ).json(),
    );
    expect(proposed.proposal).toMatchObject({ templateKey: 'zz_synthetic_garden', version: 1 });
    const res = await s.call('POST', '/tests/from-template', {
      jobTitle: 'Synthetic Gardener',
      templateKey: 'zz_synthetic_garden',
      templateVersion: 1,
    });
    expect(res.status).toBe(201);
    expect(rowsOf(s.db, 'jobs')[0]).toMatchObject({ role_template_version_id: late.id });
  });
});
