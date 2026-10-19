// Synthetic fixtures for the real-database stage tests: one random org per file with a published test version
// (MCQ section weight 1, written section weight 2, four items, item 4 never served), written on the operator path
// as the pgTAP files do, and sessions brought to `started` through trace_api exactly as services/api does. The R2
// side (final.json, events.ndjson, start photo, mirror.json) lives in an in-memory bucket. Synthetic data only:
// generated labels, `@example.test` contacts, random ids.
import { randomBytes } from 'node:crypto';
import type {
  EvidenceEventLine,
  FinalAnswers,
  SessionMirrorMessage,
} from '@trace/shared/contracts/candidate';
import { MemoryEvidence, ndjson } from '../src/integrity/world.test-helpers.js';
import { sha256Hex } from '../src/mirror/evidence.js';
import { newId, type Harness } from './harness.js';

export interface OrgFixture {
  org: string;
  workspace: string;
  test: string;
  /** Test versions by cutoff. */
  versions: Map<number, VersionFixture>;
}

export interface VersionFixture {
  id: string;
  ruleset: string;
  notice: string;
  items: { mcq1: string; mcq2: string; w3: string; w4: string };
}

const hex = (n: number): string => randomBytes(n).toString('hex');

const criteria = (anchors: string[], minHits: number) =>
  JSON.stringify([
    { id: 'c1', label: 'Names the mechanism', max_points: 4, anchors, min_hits: minHits },
  ]);

export const seedOrg = async (
  h: Harness,
  org: string,
  cutoffs: readonly number[],
): Promise<OrgFixture> => {
  const a = h.admin;
  const workspace = newId();
  const test = newId();
  await a.unsafe(
    "insert into public.orgs (id, kind, name, slug) values ($1, 'customer', 'Jobs DB test', $2)",
    [org, `jobs-dbtest-${hex(6)}`],
  );
  await a.unsafe(
    "insert into public.workspaces (id, org_id, name, kind, is_default) values ($1, $2, 'Default', 'default', true)",
    [workspace, org],
  );
  await a.unsafe(
    "insert into public.tests (id, org_id, workspace_id, name) values ($1, $2, $3, 'Synthetic test')",
    [test, org, workspace],
  );
  const versions = new Map<number, VersionFixture>();
  let versionNo = 0;
  for (const cutoff of cutoffs) {
    versionNo += 1;
    const id = newId();
    const r3 = newId();
    const r4 = newId();
    for (const [rid, crit] of [
      [r3, criteria(['queue', 'retry'], 2)],
      [r4, criteria(['index'], 1)],
    ] as const) {
      await a.unsafe(
        'insert into public.rubric_versions (id, org_id, rubric_key, version_no, criteria, content_sha256) ' +
          'values ($1, $2, $3, 1, $4::text::jsonb, $5)',
        [rid, org, `k-${hex(6)}`, crit, hex(32)],
      );
    }
    await a.unsafe(
      'insert into public.test_versions (id, org_id, test_id, version_no, total_time_seconds, quality_cutoff) ' +
        'values ($1, $2, $3, $4, 1800, $5)',
      [id, org, test, versionNo, cutoff],
    );
    const s1 = newId();
    const s2 = newId();
    await a.unsafe(
      'insert into public.sections (id, org_id, test_version_id, position, name, format, weight) values ' +
        "($1, $3, $4, 1, 'Choices', 'mcq', 1), ($2, $3, $4, 2, 'Written', 'written', 2)",
      [s1, s2, org, id],
    );
    const items = { mcq1: newId(), mcq2: newId(), w3: newId(), w4: newId() };
    const opts = JSON.stringify([
      { id: 'a', text: 'Alpha' },
      { id: 'b', text: 'Beta' },
      { id: 'c', text: 'Gamma' },
    ]);
    const insertItem =
      'insert into public.item_versions (id, org_id, test_version_id, section_id, format, position, stem, options, ' +
      "rubric_version_id, origin, content_sha256) values ($1, $2, $3, $4, $5::public.section_format, $6, $7, $8::text::jsonb, $9, 'human', $10)";
    await a.unsafe(insertItem, [
      items.mcq1,
      org,
      id,
      s1,
      'mcq',
      1,
      'Synthetic prompt 1',
      opts,
      null,
      hex(32),
    ]);
    await a.unsafe(insertItem, [
      items.mcq2,
      org,
      id,
      s1,
      'mcq',
      2,
      'Synthetic prompt 2',
      opts,
      null,
      hex(32),
    ]);
    await a.unsafe(insertItem, [
      items.w3,
      org,
      id,
      s2,
      'written',
      3,
      'Synthetic prompt 3',
      null,
      r3,
      hex(32),
    ]);
    await a.unsafe(insertItem, [
      items.w4,
      org,
      id,
      s2,
      'written',
      4,
      'Synthetic prompt 4',
      null,
      r4,
      hex(32),
    ]);
    const insertKey =
      "insert into public.item_answer_keys (org_id, item_version_id, format, key) values ($1, $2, 'mcq', $3::text::jsonb)";
    await a.unsafe(insertKey, [org, items.mcq1, '{"option_id":"b"}']);
    await a.unsafe(insertKey, [org, items.mcq2, '{"option_id":"c"}']);
    await a.unsafe(
      "update public.test_versions set status = 'published', content_sha256 = $2 where id = $1",
      [id, hex(32)],
    );
    const pins = await a.unsafe<{ ruleset: string; notice: string }[]>(
      'select ruleset_version_id::text as ruleset, notice_version_id::text as notice from public.test_versions where id = $1',
      [id],
    );
    versions.set(cutoff, { id, ruleset: pins[0]!.ruleset, notice: pins[0]!.notice, items });
  }
  return { org, workspace, test, versions };
};

export interface SessionFixture {
  invitation: string;
  session: string;
  consent: string;
  message: SessionMirrorMessage;
  evidence: MemoryEvidence;
}

export interface SessionOptions {
  cutoff: number;
  lines: readonly EvidenceEventLine[];
  photo?: 'ok' | 'other_sha';
  evidence?: MemoryEvidence;
}

const STARTED = '2026-10-15T09:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(STARTED) + ms).toISOString();
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const receipt = (): string => Array.from(randomBytes(8), (b) => CROCKFORD[b % 32]).join('');

/** One invitation brought to `started` the way services/api does it, plus the evidence and the mirror message. */
export const seedSession = async (
  h: Harness,
  f: OrgFixture,
  o: SessionOptions,
): Promise<SessionFixture> => {
  const v = f.versions.get(o.cutoff)!;
  const invitation = newId();
  const session = newId();
  const consent = newId();
  await h.admin.unsafe(
    'insert into public.invitations (id, org_id, workspace_id, test_id, test_version_id, candidate_label, ' +
      'contact_email, link_token_hash, adult_confirmed_by_inviter, status, expires_at) values ($1, $2, $3, $4, $5, ' +
      "'Candidate 0', $6, $7, true, 'created', '2030-01-01 00:00:00+00')",
    [invitation, f.org, f.workspace, f.test, v.id, `c-${hex(5)}@example.test`, hex(32)],
  );
  await h.stage('trace_api', f.org, async (tx) => {
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
      [consent, f.org, invitation, v.id, v.ruleset, v.notice, hex(32)],
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

  const evidence = o.evidence ?? new MemoryEvidence();
  const text3 = 'The queue will retry the message.';
  const final: FinalAnswers = {
    v: 1,
    sessionId: session,
    answers: [
      { position: 1, kind: 'choice', choice: 'b', sha256: await sha256Hex('b'), finalSeq: 2 },
      { position: 2, kind: 'choice', choice: 'a', sha256: await sha256Hex('a'), finalSeq: 3 },
      { position: 3, kind: 'text', text: text3, sha256: await sha256Hex(text3), finalSeq: 6 },
    ],
  };
  const finalBody = JSON.stringify(final);
  const eventsBody = ndjson(o.lines);
  const finalKey = `sessions/${f.org}/${session}/final.json`;
  const eventsKey = `sessions/${f.org}/${session}/events.ndjson`;
  const photoKey = `media/${f.org}/${session}/start_photo.jpg`;
  const photoSha = hex(32);
  evidence.put(finalKey, finalBody);
  evidence.put(eventsKey, eventsBody);
  evidence.put(photoKey, new Uint8Array(3000), {
    sha256: o.photo === 'other_sha' ? hex(32) : photoSha,
    blurred: '1',
  });
  const message: SessionMirrorMessage = {
    v: 1,
    jobKind: 'session_mirror',
    mirrorSeq: 1,
    jobKey: `${session}:session_mirror:${v.ruleset}`,
    sessionId: session,
    orgId: f.org,
    invitationId: invitation,
    testVersionId: v.id,
    rulesetVersionId: v.ruleset,
    consentId: consent,
    state: 'submitted',
    receiptRef: receipt(),
    startedAt: STARTED,
    deadlineAt: at(1_800_000),
    submittedAt: at(1_500_000),
    lastEventSeq: Math.max(6, ...o.lines.map((l) => l.gseq)),
    streamCount: 1,
    resumeCount: 0,
    served: [
      { position: 1, itemVersionId: v.items.mcq1, servedAt: at(1_000) },
      { position: 2, itemVersionId: v.items.mcq2, servedAt: at(2_000) },
      { position: 3, itemVersionId: v.items.w3, servedAt: at(3_000) },
    ],
    evidence: {
      finalKey,
      finalSha256: await sha256Hex(finalBody),
      eventsKey,
      eventsSha256: await sha256Hex(eventsBody),
    },
    replay: 'ok',
    signalCatalogVersion: 'd1-signals-v1',
    coverage: { activeMs: 1_500_000, coveredMs: 1_500_000 },
    gaps: [],
    photo: {
      key: photoKey,
      sha256: photoSha,
      bytes: 3000,
      mime: 'image/jpeg',
      blurredOnDevice: true,
    },
    photoSkippedReason: null,
  };
  evidence.put(`sessions/${f.org}/${session}/mirror.json`, JSON.stringify(message));
  return { invitation, session, consent, message, evidence };
};
