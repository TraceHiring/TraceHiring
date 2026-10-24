// Role templates and JD -> blueprint (spec m1 §6.1, ABH-5, M1-16, M1-17, R2-5, R2-8, R3-7, R5-29, E18, E19; §6.11
// `GET …/templates`, `POST …/blueprints/propose`, `POST …/tests/from-template`). Templates and library items are read
// as trace_api through the injected ReferenceSource; the JD is matched deterministically (normalised token overlap with
// the template's keywords) and never stored, logged or returned (only its SHA-256 and the permille). A template creates
// the job, the test and its draft: one pool per available blueprint section, filled with library copies (up to 10x the
// draw), Standard (or the template's preset) with the org's locks, weights summing to 100; voice and typing sections
// are skipped with a note. Synthetic data only.
import {
  BlueprintProposeResponse,
  CreateTestFromTemplateResponse,
  RoleTemplateListResponse,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../candidate/encoding.js';
import { RestError } from '../tests/org-context.js';
import { idMaker } from '../tests/rest.test-helpers.js';
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
import { createTemplatesRoutes, matchPermille, tokensOf } from './routes.js';

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

const reference = (library: LibraryItemRef[]): ReferenceSource & { browsed: unknown[] } => {
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
    templates: async () => [CUSTOMER_SUPPORT, BPO_VOICE],
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
  } = {},
) => {
  const db = authoringDb();
  withLibraryCopies(db);
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
  return { db, call, ref, limiter };
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

describe('POST …/tests/from-template: limiter, clean failure, preset version (fix round 1 #9, #10)', () => {
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

  it('library_cap mid-way archives the job and the test it created (no live test or job left)', async () => {
    const s = setup();
    s.db.failNext('insert', 'library_copy_requests', new RestError(403, '42501', 'library_cap'));
    const res = await s.call('POST', '/tests/from-template', body);
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('{"error":{"code":"library_cap"}}');
    expect(rowsOf(s.db, 'jobs')).toHaveLength(1);
    expect(rowsOf(s.db, 'tests')).toHaveLength(1);
    for (const table of ['jobs', 'tests']) {
      for (const row of rowsOf(s.db, table))
        expect(row.archived_at, table).toEqual(expect.any(String));
    }
  });

  it('a failed draft save also archives both', async () => {
    const s = setup();
    s.db.failNext('rpc', 'save_test_draft', new RestError(503, null));
    const res = await s.call('POST', '/tests/from-template', body);
    expect(res.status).toBe(503);
    for (const table of ['jobs', 'tests']) {
      for (const row of rowsOf(s.db, table))
        expect(row.archived_at, table).toEqual(expect.any(String));
    }
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
