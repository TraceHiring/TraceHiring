// A package v2 session through mirror -> quality -> integrity against the real local schema, grants, RLS and guards
// (spec m1 R5-19, R5-41, R5-42, R5-43, R5-47, R5-59 a; AT-M1-21). Each stage runs as the consumer runs it: its own
// transaction on a login role that holds exactly one worker role, SET LOCAL ROLE and trace.job_org_id.
//
// Fixture (operator path, as rls_m1_serving does; one fresh random org, removed again in afterAll): a published
// package v2 version (Standard preset) with four sections in this position order:
//   sP pool P (p1..p4, MCQ, three options, key o2) drawing 3, weight 40   -> candidate slots 1-3
//   sQ pool Q (pq, parameterised: variant 1 key o1, variant 2 key o2) drawing 1, weight 20 -> slot 4
//   sN pool N (n1, n2) drawing 2, weight 20, never entered          -> slots 5-6
//   sI inline (ii1, ii2, key o1), weight 20                         -> slots 7-8
// s9 is an approved bank item in no pool. Synthetic data only: generated labels, `@example.test` contacts, random ids.
//
// Not covered here (see the A3a fix-1 report): a library-copy pool item. A copy needs an approved item in the shared
// library org, whose rows the per-org cleanup cannot remove from the shared database.
import { randomBytes } from 'node:crypto';
import type {
  EvidenceEventLine,
  FinalAnswers,
  SessionMirrorMessage,
  SessionMirrorMessageV2,
} from '@trace/shared/contracts/candidate';
import { MockLlmGrader } from '@trace/vendors';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runIntegrity } from '../src/integrity/handler.js';
import { MemoryEvidence, heartbeat, ndjson, paste } from '../src/integrity/world.test-helpers.js';
import { sha256Hex } from '../src/mirror/evidence.js';
import { runMirror } from '../src/mirror/handler.js';
import { runQuality } from '../src/quality/handler.js';
import {
  SCHEMA_STATE_SQL,
  cleanupOrg,
  cleanupStaleOrgs,
  newId,
  openHarness,
  type Harness,
} from './harness.js';

let h: Harness;
const ORG = newId();
let schemaBefore: string;
const grader = new MockLlmGrader();

type Rows = Record<string, unknown>[];
const q = async (text: string, params: readonly (string | number | null)[] = []): Promise<Rows> =>
  (await h.admin.unsafe(text, params as string[])) as unknown as Rows;
const hex = (n: number): string => randomBytes(n).toString('hex');

// ---- fixture: a published package v2 version ---------------------------------------------------------------------

interface V2Fixture {
  workspace: string;
  test: string;
  tv: string;
  ruleset: string;
  notice: string;
  sP: string;
  sQ: string;
  sN: string;
  sI: string;
  p1: string;
  p2: string;
  p3: string;
  p4: string;
  s9: string;
  pq: string;
  pqv1: string;
  pqv2: string;
  n1: string;
  n2: string;
  ii1: string;
  ii2: string;
}
let v: V2Fixture;

const OPTIONS3 = JSON.stringify([
  { id: 'o1', text: 'One' },
  { id: 'o2', text: 'Two' },
  { id: 'o3', text: 'Three' },
]);
const APPROVER = newId();

/** A bank MCQ item version, approved on the operator path (as rls_m1_serving's bank()). Key o2. */
const bankItem = async (workspace: string): Promise<string> => {
  const item = newId();
  const ver = newId();
  await q(
    "insert into public.items (id, org_id, workspace_id, format, skill_key) values ($1, $2, $3, 'mcq', 'verbal')",
    [item, ORG, workspace],
  );
  await q(
    'insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, ' +
      "content_sha256) values ($1, $2, $3, 'mcq', $4, $5::text::jsonb, 'verbal', 0.50, $6)",
    [ver, ORG, item, '[synthetic] Bank item', OPTIONS3, hex(32)],
  );
  await q(
    "insert into public.item_answer_keys (org_id, item_version_id, format, key) values ($1, $2, 'mcq', $3::text::jsonb)",
    [ORG, ver, '{"option_id":"o2"}'],
  );
  await approve(ver);
  return ver;
};

const approve = async (ver: string): Promise<void> => {
  await q("update public.item_versions set status = 'in_review' where id = $1", [ver]);
  await q("update public.item_versions set status = 'approved', approved_by = $2 where id = $1", [
    ver,
    APPROVER,
  ]);
};

/** A parameterised MCQ (two variants: variant 1 keyed o1, variant 2 keyed o2), approved. */
const paramItem = async (workspace: string): Promise<{ ver: string; v1: string; v2: string }> => {
  const item = newId();
  const ver = newId();
  const v1 = newId();
  const v2 = newId();
  await q(
    "insert into public.items (id, org_id, workspace_id, format, skill_key) values ($1, $2, $3, 'mcq', 'quant')",
    [item, ORG, workspace],
  );
  const spec = JSON.stringify({
    params: { a: { kind: 'int', min: 1, max: 9, step: 1 } },
    stem: 'What is {{a}} + 1?',
    options: [
      { id: 'o1', text: '{{a}} + 1' },
      { id: 'o2', text: '{{a}}' },
    ],
    correctOptionId: 'o1',
    count: 5,
  });
  await q(
    'insert into public.item_versions (id, org_id, item_id, format, stem, options, skill_key, difficulty, ' +
      "is_parameterised, param_spec, content_sha256) values ($1, $2, $3, 'mcq', $4, $5::text::jsonb, 'quant', 0.50, " +
      'true, $6::text::jsonb, $7)',
    [
      ver,
      ORG,
      item,
      '[synthetic] What is a + 1?',
      JSON.stringify([
        { id: 'o1', text: 'a + 1' },
        { id: 'o2', text: 'a' },
      ]),
      spec,
      hex(32),
    ],
  );
  const variant = async (id: string, no: number, a: number) =>
    q(
      'insert into public.item_variants (id, org_id, item_version_id, variant_no, params, stem, options, difficulty, ' +
        'content_sha256) values ($1, $2, $3, $4::int, $5::text::jsonb, $6, $7::text::jsonb, 0.50, $8)',
      [
        id,
        ORG,
        ver,
        no,
        JSON.stringify({ a }),
        `[synthetic] What is ${a} + 1?`,
        JSON.stringify([
          { id: 'o1', text: String(a + 1) },
          { id: 'o2', text: String(a) },
        ]),
        hex(32),
      ],
    );
  await variant(v1, 1, 3);
  await variant(v2, 2, 5);
  const key =
    'insert into public.item_variant_keys (org_id, item_variant_id, key) values ($1, $2, $3::text::jsonb)';
  await q(key, [ORG, v1, '{"option_id":"o1"}']);
  await q(key, [ORG, v2, '{"option_id":"o2"}']);
  await approve(ver);
  return { ver, v1, v2 };
};

const pool = async (workspace: string, items: readonly string[]): Promise<string> => {
  const id = newId();
  await q(
    "insert into public.pools (id, org_id, workspace_id, name, format) values ($1, $2, $3, $4, 'mcq')",
    [id, ORG, workspace, `Pool ${hex(3)}`],
  );
  for (const item of items) {
    await q(
      'insert into public.pool_items (org_id, pool_id, item_version_id) values ($1, $2, $3)',
      [ORG, id, item],
    );
  }
  return id;
};

/** What the api sends as snapshotDigest, with (M1-e) or without (M1-f) the exposure suffix; exposure is 0 here. */
const digest = async (tv: string, withExposure: boolean): Promise<string> => {
  const suffix = withExposure ? " || ':0'" : '';
  const rows = await q(
    "select encode(sha256(convert_to(coalesce(string_agg(x.l, E'\\n' order by x.l collate \"C\"), ''), 'UTF8')), " +
      `'hex') as d from (select s.id::text || ':' || i.id::text${suffix} as l from public.sections as s ` +
      'join public.pool_items as pi on pi.org_id = s.org_id and pi.pool_id = s.pool_id ' +
      "join public.item_versions as i on i.org_id = pi.org_id and i.id = pi.item_version_id and i.status = 'approved' " +
      `where s.test_version_id = $1 union all select s.id::text || ':' || i.id::text${suffix} ` +
      'from public.sections as s join public.item_versions as i on i.org_id = s.org_id and i.section_id = s.id ' +
      'where s.test_version_id = $1 and s.pool_id is null) as x',
    [tv],
  );
  return String(rows[0]?.['d']);
};

const seedV2 = async (): Promise<V2Fixture> => {
  const workspace = newId();
  const test = newId();
  const tv = newId();
  await q(
    "insert into public.orgs (id, kind, name, slug) values ($1, 'customer', 'Jobs DB test v2', $2)",
    [ORG, `jobs-dbtest-${hex(6)}`],
  );
  await q(
    "insert into public.workspaces (id, org_id, name, kind, is_default) values ($1, $2, 'Default', 'default', true)",
    [workspace, ORG],
  );
  await q(
    "insert into public.tests (id, org_id, workspace_id, name) values ($1, $2, $3, 'Synthetic v2 test')",
    [test, ORG, workspace],
  );
  const p = [
    await bankItem(workspace),
    await bankItem(workspace),
    await bankItem(workspace),
    await bankItem(workspace),
  ];
  const s9 = await bankItem(workspace);
  const pq = await paramItem(workspace);
  const n = [await bankItem(workspace), await bankItem(workspace)];
  const poolP = await pool(workspace, p);
  const poolQ = await pool(workspace, [pq.ver]);
  const poolN = await pool(workspace, n);
  await q(
    'insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff) ' +
      'values ($1, $2, $3, 1, 1800, 40)',
    [tv, ORG, test],
  );
  const [sP, sQ, sN, sI] = [newId(), newId(), newId(), newId()];
  const section =
    'insert into public.sections (id, org_id, test_version_id, position, name, format, weight, pool_id, draw_count, ' +
    "navigation) values ($1, $2, $3, $4::int, $5, 'mcq', $6::numeric, $7, $8::int, 'free')";
  await q(section, [sP, ORG, tv, 1, 'Pool P', 40, poolP, 3]);
  await q(section, [sQ, ORG, tv, 2, 'Pool Q', 20, poolQ, 1]);
  await q(section, [sN, ORG, tv, 3, 'Pool N', 20, poolN, 2]);
  await q(section, [sI, ORG, tv, 4, 'Inline', 20, null, null]);
  const inline = async (position: number): Promise<string> => {
    const id = newId();
    await q(
      'insert into public.item_versions (id, org_id, section_id, format, position, stem, options, content_sha256) ' +
        "values ($1, $2, $3, 'mcq', $4::int, $5, $6::text::jsonb, $7)",
      [id, ORG, sI, position, `[synthetic] Inline ${position}`, OPTIONS3, hex(32)],
    );
    await q(
      "insert into public.item_answer_keys (org_id, item_version_id, format, key) values ($1, $2, 'mcq', $3::text::jsonb)",
      [ORG, id, '{"option_id":"o1"}'],
    );
    return id;
  };
  const ii1 = await inline(1);
  const ii2 = await inline(2);
  await q(
    "update public.ruleset_versions as r set preset_key = 'standard', settings = (select p.preset_values " +
      "from public.integrity_presets as p where p.preset_key = 'standard' and p.version = 1) " +
      'where r.id = (select v.ruleset_version_id from public.test_versions as v where v.id = $1)',
    [tv],
  );
  const publish =
    "update public.test_versions set status = 'published', content_sha256 = $2, snapshot_digest = $3 where id = $1";
  try {
    await q(publish, [tv, hex(32), await digest(tv, false)]);
  } catch {
    // A database still at migration M1-e digests the exposure too (0 for every item of a fresh org).
    await q(publish, [tv, hex(32), await digest(tv, true)]);
  }
  const pins = await q(
    'select ruleset_version_id::text as ruleset, notice_version_id::text as notice, package_version::int as pkg ' +
      'from public.test_versions where id = $1',
    [tv],
  );
  expect(pins[0]?.['pkg']).toBe(2);
  return {
    workspace,
    test,
    tv,
    ruleset: String(pins[0]?.['ruleset']),
    notice: String(pins[0]?.['notice']),
    sP,
    sQ,
    sN,
    sI,
    p1: p[0]!,
    p2: p[1]!,
    p3: p[2]!,
    p4: p[3]!,
    s9,
    pq: pq.ver,
    pqv1: pq.v1,
    pqv2: pq.v2,
    n1: n[0]!,
    n2: n[1]!,
    ii1,
    ii2,
  };
};

// ---- sessions ------------------------------------------------------------------------------------------------------

const STARTED = '2026-10-15T09:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(STARTED) + ms).toISOString();
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const receipt = (): string => Array.from(randomBytes(8), (b) => CROCKFORD[b % 32]).join('');
/** Candidate slots of this version (R5-59 a): sP 1-3, sQ 4, sN 5-6, sI 7-8. */
const SLOT = { sP: 1, sQ: 4, sN: 5, sI: 7 } as const;

interface Session {
  invitation: string;
  session: string;
  consent: string;
  message: SessionMirrorMessage;
  evidence: MemoryEvidence;
}

interface Plan {
  served: SessionMirrorMessageV2['served'];
  draws: SessionMirrorMessageV2['draws'];
  /** Choices by candidate position. */
  choices: readonly { position: number; choice: string }[];
  lines?: readonly EvidenceEventLine[];
  poolSectionIds?: readonly string[];
  /** Send the message as a v1 mirror (no section, draw or pool fields). */
  asV1?: boolean;
}

/** One invitation brought to `started` the way services/api does it, plus its evidence and mirror message. */
const startSession = async (plan: Plan): Promise<Session> => {
  const invitation = newId();
  const session = newId();
  const consent = newId();
  await q(
    'insert into public.invitations (id, org_id, workspace_id, test_id, test_version_id, candidate_label, ' +
      'contact_email, link_token_hash, adult_confirmed_by_inviter, status, expires_at) values ($1, $2, $3, $4, $5, ' +
      "'Candidate 0', $6, $7, true, 'created', '2030-01-01 00:00:00+00')",
    [invitation, ORG, v.workspace, v.test, v.tv, `c-${hex(5)}@example.test`, hex(32)],
  );
  await h.stage('trace_api', ORG, async (tx) => {
    await tx.query("update public.invitations set status = 'sent' where id = $1::uuid", [
      invitation,
    ]);
    await tx.query(
      "update public.invitations set status = 'otp_verified', adult_self_declared = true where id = $1::uuid",
      [invitation],
    );
    await tx.query(
      'insert into public.consents (id, org_id, invitation_id, test_version_id, ruleset_version_id, notice_version_id, ' +
        "rendered_sha256, language, event) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, 'en', 'granted')",
      [consent, ORG, invitation, v.tv, v.ruleset, v.notice, hex(32)],
    );
    await tx.query('update public.invitations set session_id = $2::uuid where id = $1::uuid', [
      invitation,
      session,
    ]);
    await tx.query(
      "update public.invitations set status = 'started', started_at = $2::timestamptz where id = $1::uuid",
      [invitation, STARTED],
    );
  });

  const evidence = new MemoryEvidence();
  const final: FinalAnswers = {
    v: 1,
    sessionId: session,
    answers: await Promise.all(
      plan.choices.map(async (c, i) => ({
        position: c.position,
        kind: 'choice' as const,
        choice: c.choice,
        sha256: await sha256Hex(c.choice),
        finalSeq: 10 + i,
      })),
    ),
  };
  const lines = plan.lines ?? [heartbeat(1, 10_000), heartbeat(2, 20_000)];
  const finalBody = JSON.stringify(final);
  const eventsBody = ndjson(lines);
  const finalKey = `sessions/${ORG}/${session}/final.json`;
  const eventsKey = `sessions/${ORG}/${session}/events.ndjson`;
  evidence.put(finalKey, finalBody);
  evidence.put(eventsKey, eventsBody);
  const base = {
    jobKind: 'session_mirror' as const,
    mirrorSeq: 1 as const,
    jobKey: `${session}:session_mirror:${v.ruleset}`,
    sessionId: session,
    orgId: ORG,
    invitationId: invitation,
    testVersionId: v.tv,
    rulesetVersionId: v.ruleset,
    consentId: consent,
    state: 'submitted' as const,
    receiptRef: receipt(),
    startedAt: STARTED,
    deadlineAt: at(1_800_000),
    submittedAt: at(1_500_000),
    lastEventSeq: Math.max(10 + plan.choices.length, ...lines.map((l) => l.gseq)),
    streamCount: 1,
    resumeCount: 0,
    evidence: {
      finalKey,
      finalSha256: await sha256Hex(finalBody),
      eventsKey,
      eventsSha256: await sha256Hex(eventsBody),
    },
    replay: 'ok' as const,
    signalCatalogVersion: 'd1-signals-v1',
    coverage: { activeMs: 1_500_000, coveredMs: 1_500_000 },
    gaps: [],
    photo: null,
    photoSkippedReason: 'declined' as const,
  };
  const message: SessionMirrorMessage =
    plan.asV1 === true
      ? {
          ...base,
          v: 1,
          served: plan.served.map((s) => ({
            position: s.position,
            itemVersionId: s.itemVersionId,
            servedAt: s.servedAt,
          })),
        }
      : {
          ...base,
          v: 2,
          served: plan.served,
          poolSectionIds: [...(plan.poolSectionIds ?? [v.sP, v.sQ, v.sN])],
          draws: plan.draws,
        };
  evidence.put(`sessions/${ORG}/${session}/mirror.json`, JSON.stringify(message));
  return { invitation, session, consent, message, evidence };
};

const mirror = (s: Session, org: string = ORG) =>
  h.stage('trace_worker', org, (tx) => runMirror(s.message, { tx, evidence: s.evidence }));
const quality = (s: Session, org: string = ORG) =>
  h.stage('trace_quality_worker', org, (tx) => runQuality(s.message, { tx, grader }));
const integrity = (s: Session, org: string = ORG) =>
  h.stage('trace_integrity_worker', org, (tx) =>
    runIntegrity(s.message, { tx, evidence: s.evidence }),
  );

/** The mixed draw of case (1): sP draws p2, p1, p3 (p2 served unanswered, p1 answered, p3 never served). */
const mainPlan = (): Plan => {
  const seed = hex(32);
  return {
    draws: [
      { sectionId: v.sP, itemVersionIds: [v.p2, v.p1, v.p3], itemVariantIds: [null, null, null] },
      { sectionId: v.sQ, itemVersionIds: [v.pq], itemVariantIds: [v.pqv2] },
    ],
    served: [
      {
        position: SLOT.sP,
        itemVersionId: v.p2,
        servedAt: at(1_000),
        sectionId: v.sP,
        optionOrder: ['o1', 'o2', 'o3'],
      },
      {
        // Shuffled: the key o2 is shown third. Scored by id, never by the shown index.
        position: SLOT.sP + 1,
        itemVersionId: v.p1,
        servedAt: at(2_000),
        sectionId: v.sP,
        optionOrder: ['o3', 'o1', 'o2'],
        drawSeedSha256: seed,
      },
      {
        position: SLOT.sQ,
        itemVersionId: v.pq,
        servedAt: at(3_000),
        sectionId: v.sQ,
        itemVariantId: v.pqv2,
        optionOrder: ['o2', 'o1'],
      },
      { position: SLOT.sI, itemVersionId: v.ii1, servedAt: at(4_000), sectionId: v.sI },
    ],
    choices: [
      { position: SLOT.sP + 1, choice: 'o2' },
      { position: SLOT.sQ, choice: 'o2' }, // variant 2's key; variant 1's key is o1
      { position: SLOT.sI, choice: 'o1' },
    ],
    lines: [heartbeat(1, 10_000), paste(3, 20_000), heartbeat(5, 30_000)],
  };
};

// ---- what the stages wrote ----------------------------------------------------------------------------------------

const items = (session: string) =>
  q(
    'select si.item_version_id::text as item, si.section_id::text as section, si.position, ' +
      '(si.served_at is not null) as served, si.item_variant_id::text as variant, si.option_order, ' +
      'si.draw_seed_sha256 from public.session_items as si join public.sections as s on s.id = si.section_id ' +
      'where si.session_id = $1 order by s.position, si.position',
    [session],
  );
const exposure = async (session: string): Promise<number> =>
  Number(
    (
      await q(
        'select count(*)::int as n from public.item_exposure_events as e join public.session_items as si ' +
          'on si.id = e.session_item_id where si.session_id = $1',
        [session],
      )
    )[0]?.['n'],
  );
const qualityRows = async (session: string) => ({
  scores: await q(
    'select id::text, score, section_scores, scoring_version, meets_cutoff from quality.scores where session_id = $1',
    [session],
  ),
  runs: await q('select id::text from quality.grader_runs where session_id = $1 order by id', [
    session,
  ]),
  cards: await q(
    'select id::text, score, scoring_version from public.quality_cards where session_id = $1',
    [session],
  ),
});
const snapshot = async (session: string) => ({
  sessions: await q('select id::text, state, mirror_seq from public.sessions where id = $1', [
    session,
  ]),
  items: await q(
    'select id::text, item_version_id::text, position, served_at from public.session_items ' +
      'where session_id = $1 order by id',
    [session],
  ),
  responses: await q(
    'select id::text, final_choice from public.responses where session_id = $1 order by id',
    [session],
  ),
  exposure: await exposure(session),
  quality: await qualityRows(session),
  signals: await q('select id::text, kind from integrity.signals where session_id = $1', [session]),
  flags: await q('select id::text, rule_id from integrity.flags where session_id = $1', [session]),
  icards: await q('select id::text, band from public.integrity_cards where session_id = $1', [
    session,
  ]),
  reports: await q(
    'select id::text, quality_card_id::text, integrity_card_id::text from public.reports where session_id = $1',
    [session],
  ),
  keys: await q(
    "select scope, result_ref from public.idempotency_keys where key like $1 || ':%' order by scope",
    [session],
  ),
  invitation: await q('select status::text from public.invitations where session_id = $1', [
    session,
  ]),
});
/** Nothing of the session was committed: no session row, no items, invitation still started, no key. */
const expectNothing = async (s: Session) => {
  const snap = await snapshot(s.session);
  expect(snap.sessions).toEqual([]);
  expect(snap.items).toEqual([]);
  expect(snap.responses).toEqual([]);
  expect(snap.exposure).toBe(0);
  expect(snap.keys).toEqual([]);
  expect(snap.invitation).toEqual([{ status: 'started' }]);
};
const codeOf = async (p: Promise<unknown>): Promise<{ message: string; code: unknown }> => {
  try {
    await p;
  } catch (err) {
    return { message: (err as Error).message, code: (err as { code?: unknown }).code };
  }
  throw new Error('expected the stage to fail');
};

beforeAll(async () => {
  const started = Date.now();
  h = await openHarness();
  await cleanupStaleOrgs(h.admin);
  schemaBefore = String((await q(SCHEMA_STATE_SQL))[0]?.['fp']);
  v = await seedV2();
  console.info(`db-test v2 setup ${Date.now() - started} ms`);
}, 60_000);

afterAll(async () => {
  if (h === undefined) return;
  try {
    await cleanupOrg(h.admin, ORG);
    const left = await q(
      'select (select count(*) from public.orgs where id = $1) + (select count(*) from public.audit_log where org_id = $1) ' +
        '+ (select count(*) from integrity.band_rule_versions where org_id = $1) as n',
      [ORG],
    );
    expect(Number(left[0]?.['n'])).toBe(0);
    expect(String((await q(SCHEMA_STATE_SQL))[0]?.['fp'])).toBe(schemaBefore);
  } finally {
    await h.close();
  }
}, 60_000);

describe('package v2 through the three stages (AT-M1-21; R5-19, R5-41, R5-42, R5-47, R5-59 a)', () => {
  let main: Session;

  it('(1)(2)(4)(5) a mixed draw: rows at their draw positions, variant 2 key, empty slots score 0', async () => {
    main = await startSession(mainPlan());
    await mirror(main);
    // (1) one row per drawn pool item at its draw position; the inline item at its served slot.
    expect(await items(main.session)).toEqual([
      expect.objectContaining({ item: v.p2, section: v.sP, position: 1, served: true }),
      expect.objectContaining({
        item: v.p1,
        section: v.sP,
        position: 2,
        served: true,
        option_order: ['o3', 'o1', 'o2'],
      }),
      expect.objectContaining({ item: v.p3, section: v.sP, position: 3, served: false }),
      expect.objectContaining({
        item: v.pq,
        section: v.sQ,
        position: 1,
        served: true,
        variant: v.pqv2,
      }),
      expect.objectContaining({ item: v.ii1, section: v.sI, position: SLOT.sI, served: true }),
    ]);
    const withSeed = (await items(main.session)).filter((r) => r['draw_seed_sha256'] !== null);
    expect(withSeed.map((r) => r['item'])).toEqual([v.p1]);
    // R5-41: exactly one exposure event per served row, none for the drawn-but-unserved p3.
    expect(await exposure(main.session)).toBe(4);

    await quality(main);
    const qr = await qualityRows(main.session);
    // (5) sP: p1 100, p2 0, p3 0 -> 3333; sQ: pq as variant 2 -> 10000; sN never entered: 2 slots at 0; sI: ii1 100,
    // ii2 never served 0 -> 5000. Score = round((40·33.33 + 20·100 + 20·0 + 20·50) / 100) = 43.
    expect(qr.scores).toEqual([
      expect.objectContaining({
        score: 43,
        meets_cutoff: true,
        scoring_version: 'm1-scoring-v1',
        section_scores: [
          expect.objectContaining({ sectionId: v.sP, scoreHundredths: 3333 }),
          expect.objectContaining({ sectionId: v.sQ, scoreHundredths: 10000 }),
          expect.objectContaining({ sectionId: v.sN, scoreHundredths: 0 }),
          expect.objectContaining({ sectionId: v.sI, scoreHundredths: 5000 }),
        ],
      }),
    ]);
    expect(qr.cards).toEqual([
      expect.objectContaining({ score: 43, scoring_version: 'm1-scoring-v1' }),
    ]);
    expect(qr.runs).toEqual([]);
  });

  it('(9) integrity reads the pinned signal settings, writes its card and never touches quality rows', async () => {
    const before = await qualityRows(main.session);
    await integrity(main);
    expect(await qualityRows(main.session)).toEqual(before);
    const snap = await snapshot(main.session);
    expect(snap.icards).toHaveLength(1);
    expect(snap.signals).toEqual([expect.objectContaining({ kind: 'paste' })]);
    const settings = await q(
      "select (signal_settings -> 'paste' ->> 'enabled')::boolean as paste from public.ruleset_versions where id = $1",
      [v.ruleset],
    );
    const pasteOn = settings[0]?.['paste'] === true;
    expect(snap.flags.map((f) => f['rule_id'])).toEqual(pasteOn ? ['D1-PASTE'] : []);
    expect(snap.reports).toEqual([
      expect.objectContaining({
        quality_card_id: before.cards[0]?.['id'],
        integrity_card_id: snap.icards[0]?.['id'],
      }),
    ]);
    expect(snap.keys.map((k) => k['scope'])).toEqual([
      'integrity_band',
      'quality_score',
      'session_mirror',
    ]);
  });

  it('(6) re-delivery of each stage returns at its key and writes nothing new', async () => {
    const before = await snapshot(main.session);
    await mirror(main);
    await quality(main);
    await integrity(main);
    expect(await snapshot(main.session)).toEqual(before);
  });

  it('(11) a stage bound to another org writes nothing', async () => {
    const other = newId();
    const before = await snapshot(main.session);
    await expect(quality(main, other)).rejects.toThrow(/^quality_session_missing$/);
    await expect(integrity(main, other)).rejects.toThrow();
    expect(await snapshot(main.session)).toEqual(before);

    const s = await startSession(mainPlan());
    await expect(mirror(s, other)).rejects.toThrow(/^mirror_invitation_missing$/);
    await expectNothing(s);
  });
});

describe('package v2 refusals: nothing commits', () => {
  it('(7) a draw longer than draw_count is refused by the guard (42501)', async () => {
    const plan = mainPlan();
    plan.draws = [
      {
        sectionId: v.sP,
        itemVersionIds: [v.p2, v.p1, v.p3, v.p4],
        itemVariantIds: [null, null, null, null],
      },
      { sectionId: v.sQ, itemVersionIds: [v.pq], itemVariantIds: [v.pqv2] },
    ];
    const s = await startSession(plan);
    expect(await codeOf(mirror(s))).toEqual({ message: 'mirror_failed', code: '42501' });
    await expectNothing(s);
  });

  it('(8) a drawn item outside the published snapshot is refused (42501)', async () => {
    const plan = mainPlan();
    plan.draws = [
      { sectionId: v.sP, itemVersionIds: [v.p2, v.p1, v.s9], itemVariantIds: [null, null, null] },
      { sectionId: v.sQ, itemVersionIds: [v.pq], itemVariantIds: [v.pqv2] },
    ];
    const s = await startSession(plan);
    expect(await codeOf(mirror(s))).toEqual({ message: 'mirror_failed', code: '42501' });
    await expectNothing(s);
  });

  it('(8) an option order that is not a permutation of the served options is refused (42501)', async () => {
    const plan = mainPlan();
    const p1 = plan.served.find((r) => r.itemVersionId === v.p1);
    if (p1 === undefined) throw new Error('no p1');
    p1.optionOrder = ['o1', 'o2']; // o3 missing: not a repeat, so only the guard sees it
    const s = await startSession(plan);
    expect(await codeOf(mirror(s))).toEqual({ message: 'mirror_failed', code: '42501' });
    await expectNothing(s);
  });

  it('(10) a v1 message on a package v2 version is refused by the quality stage (quality_bad_package)', async () => {
    const s = await startSession({ served: [], draws: [], choices: [], asV1: true });
    await mirror(s);
    await expect(quality(s)).rejects.toThrow(/^quality_bad_package$/);
    expect((await qualityRows(s.session)).scores).toEqual([]);
  });

  it('R5-59 a: swapped pool served positions are stored by the mirror but never scored', async () => {
    const plan = mainPlan();
    const p2 = plan.served.find((r) => r.itemVersionId === v.p2);
    const p1 = plan.served.find((r) => r.itemVersionId === v.p1);
    if (p1 === undefined || p2 === undefined) throw new Error('no rows');
    p2.position = SLOT.sP + 1;
    p1.position = SLOT.sP;
    plan.choices = [{ position: SLOT.sP, choice: 'o2' }];
    const s = await startSession(plan);
    await mirror(s);
    await expect(quality(s)).rejects.toThrow(/^quality_bad_served_position$/);
    expect(await qualityRows(s.session)).toEqual({ scores: [], runs: [], cards: [] });
  });

  it('R5-59 a: a pool section missing from poolSectionIds is never scored', async () => {
    const s = await startSession({ ...mainPlan(), poolSectionIds: [v.sP, v.sQ] });
    await mirror(s);
    await expect(quality(s)).rejects.toThrow(/^quality_bad_draws$/);
    expect((await qualityRows(s.session)).scores).toEqual([]);
  });
});
