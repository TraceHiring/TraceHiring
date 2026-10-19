// The candidate store against the real database (docs/reviews/D1-spec-review-r3a.md finding 1): every trace_api
// statement of services/api/src/modules/candidate/store.ts (resolve, invitation, insertConsent ... on conflict,
// declareAdult, setSessionId, markStarted, markExpired) runs end to end here, through the real edge and api Workers,
// the real api_login -> trace_api connection and the real migration-2 guards, not the unit tests' fakeStore().
// specs/d1-demo-slice.md §4.1-§4.5 (candidate flow, endpoints, tokens, start photo), §6.2 (org endpoints), §7.2.
//
// API level only (Playwright request contexts against api 8788 and edge 8787; the browser only encodes the start
// photo). scripts/e2e-local.mjs sets up the stack and passes the synthetic users, their generated password and the
// org id in the environment. Skipped unless E2E_LOCAL=1. Synthetic data only (`@example.test`). No token, link, OTP,
// password or body is ever printed: failures carry a step, an HTTP status and a constant error code.
// Product rules checked on the way: the receipt is exactly {receiptRef, submittedAt} (rule 5, D1-11); an under-18
// answer creates nothing (rule 9); the results row carries quality only, no band (rules 1 and 6).
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { amrOf, claimsOf, signInWithTotp } from '../support/auth.js';
import {
  canvasJpeg,
  edgeClient,
  requestOtp,
  sha256Hex,
  type Receipt,
  type ServedItem,
  type SessionView,
} from '../support/candidate.js';
import { psql, readDb } from '../support/db.js';
import { env, expectRefusal, jsonOf, keysOf, poll } from '../support/http.js';
import { linkTokenIn, linkTokenOfUrl, outboxReader } from '../support/outbox.js';

test.skip(process.env['E2E_LOCAL'] !== '1', 'set E2E_LOCAL=1 (scripts/e2e-local.mjs) to run');
test.describe.configure({ mode: 'serial' });

const API = process.env['E2E_API_URL'] ?? 'http://127.0.0.1:8788';
const EDGE = process.env['E2E_EDGE_URL'] ?? 'http://127.0.0.1:8787';
const RUN = randomBytes(4).toString('hex');
const STEP_MS = 30_000;
const JOBS_WAIT_MS = 120_000;
const CUTOFF = 40;
const ANCHORS = ['queue', 'retry', 'idempotent'];

type Key = 'A' | 'M' | 'N' | 'R' | 'X';
interface Invite {
  invitationId: string;
  label: string;
  status: string;
  /** The raw link token, read from the demo outbox (null for the inviter-"No" invitation). */
  token: string | null;
}

/** What the serial tests hand each other (one worker, one file). */
const run: {
  jwt: string;
  orgId: string;
  testId: string;
  versionId: string;
  testName: string;
  invites: Partial<Record<Key, Invite>>;
  a?: { sessionId: string; startedAt: string; receipt: Receipt; otpIds: Set<string> };
} = { jwt: '', orgId: '', testId: '', versionId: '', testName: '', invites: {} };

const invite = (key: Key): Invite => {
  const found = run.invites[key];
  if (found === undefined) throw new Error(`invitation ${key} was not created`);
  return found;
};
const tokenOf = (key: Key): string => {
  const token = invite(key).token;
  if (token === null) throw new Error(`invitation ${key} has no link`);
  return token;
};
const org = (path: string) => `${API}/v1/orgs/${run.orgId}${path}`;
const authed = () => ({ Authorization: `Bearer ${run.jwt}` });

/** One invitation's row as the database holds it, read as postgres in a rolled-back read-only transaction. */
const invitationRow = (id: string) => {
  const [line] = readDb(
    `select status, coalesce(adult_self_declared::text, 'null'), coalesce(age_block_source, 'null'),
            session_id is not null, coalesce((extract(epoch from started_at) * 1000)::bigint::text, 'null')
       from public.invitations where id = :'inv';`,
    { inv: id },
    'reading the invitation',
  );
  const [status, adult, source, hasSession, startedMs] = (line ?? '').split('|');
  return {
    status,
    adultSelfDeclared: adult,
    ageBlockSource: source,
    hasSession: hasSession === 't',
    startedAtMs: startedMs === 'null' || startedMs === undefined ? null : Number(startedMs),
  };
};
const countOf = (sql: string, vars: Record<string, string>, what: string): number =>
  Number(readDb(sql, vars, what)[0] ?? 'NaN');

test.describe('candidate store on the real database (spec review r3a #1)', () => {
  test('a recruiter signs in, creates and publishes a test and invites five candidates', async ({
    request,
  }) => {
    test.setTimeout(240_000);
    run.orgId = env('E2E_ORG_ID');

    await test.step(
      'the recruiter signs in with password and TOTP (aal2)',
      async () => {
        run.jwt = await signInWithTotp(request, {
          supabaseUrl: env('E2E_SUPABASE_URL'),
          publishableKey: env('E2E_SUPABASE_PUBLISHABLE_KEY'),
          email: env('E2E_STORE_RECRUITER_EMAIL'),
          password: env('E2E_USER_PASSWORD'),
        });
        const claims = claimsOf(run.jwt);
        expect(claims.aal).toBe('aal2');
        expect(amrOf(claims)).toEqual(['password', 'totp']);
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'creates a test: 3 MCQ items, 1 written item with rubric anchors, cutoff 40',
      async () => {
        run.testName = `E2E store ${RUN}`;
        const created = await jsonOf<{
          test: { id: string };
          version: { id: string; status: string; qualityCutoff: number };
        }>(
          await request.post(org('/tests'), {
            headers: authed(),
            data: { name: run.testName, durationMinutes: 30 },
          }),
          201,
          'creating the test',
        );
        expect(created.version.status).toBe('draft');
        // The editor's default cutoff (spec §6.2, L-15).
        expect(created.version.qualityCutoff).toBe(CUTOFF);
        run.testId = created.test.id;
        run.versionId = created.version.id;
        const mcq = (n: number) => ({
          format: 'mcq',
          prompt: `Synthetic question ${n}: which option is marked correct?`,
          options: [
            { id: 'a', text: 'The correct option' },
            { id: 'b', text: 'A wrong option' },
            { id: 'c', text: 'Another wrong option' },
          ],
          correctOptionId: 'a',
        });
        const detail = await jsonOf<{
          version: { qualityCutoff: number; sections: { items: unknown[] }[] };
        }>(
          await request.put(org(`/tests/${run.testId}`), {
            headers: authed(),
            data: {
              name: run.testName,
              durationMinutes: 30,
              qualityCutoff: CUTOFF,
              sections: [
                { format: 'mcq', name: 'Reasoning', weight: 60, items: [mcq(1), mcq(2), mcq(3)] },
                {
                  format: 'written',
                  name: 'Writing',
                  weight: 40,
                  items: [
                    {
                      format: 'written',
                      prompt:
                        'Synthetic task: explain how a background job avoids doing work twice.',
                      rubric: {
                        criteria: [
                          {
                            id: 'c1',
                            label: 'Names the delivery ideas',
                            maxPoints: 10,
                            anchors: ANCHORS,
                            minHits: 2,
                          },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          }),
          200,
          'saving the draft',
        );
        expect(detail.version.qualityCutoff).toBe(CUTOFF);
        expect(detail.version.sections.map((s) => s.items.length)).toEqual([3, 1]);
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'publishes it',
      async () => {
        const published = await jsonOf<{ status: string; qualityCutoff: number }>(
          await request.post(org(`/tests/${run.testId}/publish`), {
            headers: authed(),
            data: { testVersionId: run.versionId },
          }),
          200,
          'publishing the test',
        );
        expect(published.status).toBe('published');
        expect(published.qualityCutoff).toBe(CUTOFF);
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'invites A, M, R and X (18+ yes) and one inviter-"No" invitation',
      async () => {
        const plan: [Key, boolean][] = [
          ['A', true],
          ['M', true],
          ['N', false],
          ['R', true],
          ['X', true],
        ];
        for (const [key, adult] of plan) {
          const res = await jsonOf<{
            invitationId: string;
            label: string;
            status: string;
            inviteUrl: string | null;
          }>(
            await request.post(org(`/tests/${run.testId}/invitations`), {
              headers: authed(),
              data: {
                contactEmail: `e2e-${RUN}-${key.toLowerCase()}@example.test`,
                adultConfirmedByInviter: adult,
              },
            }),
            201,
            `inviting ${key}`,
          );
          if (adult) {
            // L-1: `sent` only after the outbox write.
            expect(res.status, key).toBe('sent');
            expect(res.inviteUrl, key).not.toBeNull();
          } else {
            // Rule 9: an inviter's "under 18" is blocked at once, with no link and no message.
            expect(res.status, key).toBe('blocked_age');
            expect(res.inviteUrl, key).toBeNull();
          }
          const fromResponse = res.inviteUrl === null ? null : linkTokenOfUrl(res.inviteUrl);
          run.invites[key] = {
            invitationId: res.invitationId,
            label: res.label,
            status: res.status,
            token: fromResponse,
          };
        }
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'reads each link from the demo outbox; the inviter-"No" invitation has none',
      async () => {
        const entries = await outboxReader(request, {
          api: API,
          orgId: run.orgId,
          jwt: run.jwt,
        }).list();
        for (const key of ['A', 'M', 'R', 'X'] as const) {
          const inv = invite(key);
          const mine = entries.filter((e) => e.kind === 'invite' && e.candidateLabel === inv.label);
          expect(mine, key).toHaveLength(1);
          const token = linkTokenIn(mine[0]?.bodyText ?? '');
          expect(token, key).not.toBeNull();
          // The outbox carries the same link the create answer returned once.
          expect(token === inv.token, key).toBe(true);
          inv.token = token;
        }
        const n = invite('N');
        expect(entries.filter((e) => e.candidateLabel === n.label)).toHaveLength(0);
        const row = invitationRow(n.invitationId);
        expect(row).toMatchObject({ status: 'blocked_age', ageBlockSource: 'inviter' });
      },
      { timeout: STEP_MS },
    );
  });

  test('candidate A: link, OTP, age, notice, consent, photo, start, answers, submit, receipt', async ({
    request,
    page,
  }) => {
    test.setTimeout(240_000);
    const edge = edgeClient(request, EDGE);
    const outbox = outboxReader(request, { api: API, orgId: run.orgId, jwt: run.jwt });
    const a = invite('A');
    const token = tokenOf('A');
    const otpIds = new Set<string>();
    let lobby = '';
    let session = '';
    let view: SessionView | undefined;

    await test.step(
      'resolve: the link is live and names the test',
      async () => {
        const res = await jsonOf<{ state: string; title?: string; durationMinutes?: number }>(
          await edge.resolve(token),
          200,
          'resolving A',
        );
        expect(res).toEqual({ state: 'sent', title: run.testName, durationMinutes: 30 });
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'OTP: request, read the code from the demo outbox, verify',
      async () => {
        const sent = await requestOtp(edge, token);
        expect(sent.channel).toBe('email');
        const otp = await outbox.nextOtp(a.label, otpIds);
        otpIds.add(otp.id);
        const verified = await jsonOf<{ lobbyToken: string; next: string }>(
          await edge.otpVerify(token, otp.code),
          200,
          'verifying the OTP',
        );
        expect(verified.next).toBe('age');
        lobby = verified.lobbyToken;
        expect(invitationRow(a.invitationId).status).toBe('otp_verified');
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'age: 18 or over',
      async () => {
        const res = await jsonOf<unknown>(
          await edge.lobbyPost('/v1/lobby/age', lobby, { adult: true }),
          200,
          'declaring the age',
        );
        expect(res).toEqual({ ok: true });
        expect(invitationRow(a.invitationId)).toMatchObject({
          status: 'otp_verified',
          adultSelfDeclared: 'true',
          hasSession: false,
        });
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'notice and consent: one consents row and the session id, before any camera',
      async () => {
        const notice = await jsonOf<{
          noticeVersionId: string;
          language: string;
          bodyText: string;
          renderedSha256: string;
        }>(await edge.lobbyGet('/v1/lobby/notice', lobby), 200, 'reading the notice');
        expect(notice.language).toBe('en');
        expect(sha256Hex(notice.bodyText)).toBe(notice.renderedSha256);
        const consent = {
          noticeVersionId: notice.noticeVersionId,
          renderedSha256: notice.renderedSha256,
          accepted: true,
        };
        expect(
          await jsonOf<unknown>(
            await edge.lobbyPost('/v1/lobby/consent', lobby, consent),
            200,
            'recording the consent',
          ),
        ).toEqual({ ok: true });
        // A repeat is idempotent (insertConsent ... on conflict; setSessionId is set once).
        await jsonOf<unknown>(
          await edge.lobbyPost('/v1/lobby/consent', lobby, consent),
          200,
          'repeating the consent',
        );
        const consents = countOf(
          `select count(*) from public.consents where invitation_id = :'inv';`,
          { inv: a.invitationId },
          'counting consents',
        );
        expect(consents).toBe(1);
        expect(invitationRow(a.invitationId).hasSession).toBe(true);
      },
      { timeout: STEP_MS },
    );

    let photoSha = '';
    await test.step(
      'start photo: a real canvas JPEG (JFIF APP0 only) is accepted',
      async () => {
        await page.goto('about:blank');
        const jpeg = await canvasJpeg(page);
        // SOI then APP0 (JFIF): the header the edge accepts (no EXIF, no COM).
        expect([...jpeg.subarray(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0]);
        const res = await jsonOf<{ sha256: string; bytes: number }>(
          await edge.photo(lobby, jpeg),
          200,
          'uploading the start photo',
        );
        expect(res).toEqual({ sha256: sha256Hex(jpeg), bytes: jpeg.length });
        photoSha = res.sha256;
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'session start: the invitation is started, with the DO start time',
      async () => {
        const started = await jsonOf<{ sessionToken: string; view: SessionView }>(
          await edge.lobbyPost('/v1/session/start', lobby, {
            rulesAcknowledged: true,
            photo: { sha256: photoSha },
          }),
          200,
          'starting the session',
        );
        session = started.sessionToken;
        view = started.view;
        expect(view.state).toBe('in_progress');
        expect(view.items.map((i) => i.kind)).toEqual(['mcq', 'mcq', 'mcq', 'written']);
        const row = invitationRow(a.invitationId);
        expect(row.status).toBe('started');
        // markStarted copies the DO's started_at (set once).
        expect(row.startedAtMs).toBe(Date.parse(view.startedAt));
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'items, answers (MCQ choices and an answer.text splice) and submit: the receipt only',
      async () => {
        if (view === undefined) throw new Error('no session view');
        const events: unknown[] = [];
        let seq = 0;
        for (const item of view.items) {
          const served = await jsonOf<ServedItem>(
            await edge.sessionGet(`/v1/session/items/${item.position}`, session),
            200,
            `reading item ${item.position}`,
          );
          expect(served.kind).toBe(item.kind);
          seq += 1;
          if (served.kind === 'mcq') {
            expect(served.options?.map((o) => o.id)).toEqual(['a', 'b', 'c']);
            events.push({
              seq,
              t: seq * 1000,
              kind: 'answer.choice',
              item: item.position,
              option: 'a',
            });
          } else {
            events.push({
              seq,
              t: seq * 1000,
              kind: 'answer.text',
              item: item.position,
              p: 0,
              d: 0,
              i: `Put each job on a ${ANCHORS[0]}, ${ANCHORS[1]} on failure, and keep every step ${ANCHORS[2]} with a stable key.`,
            });
          }
        }
        seq += 1;
        events.push({ seq, t: seq * 1000, kind: 'heartbeat' });
        const ack = await jsonOf<{ ackSeq: number; state: string }>(
          await edge.sessionPost('/v1/session/events', session, {
            streamId: view.streamId,
            events,
          }),
          200,
          'sending the events',
        );
        expect(ack).toMatchObject({ ackSeq: seq, state: 'in_progress' });
        const receipt = await jsonOf<Receipt>(
          await edge.sessionPost('/v1/session/submit', session, {
            streamId: view.streamId,
            finalSeq: seq,
          }),
          200,
          'submitting',
        );
        // D1-11, rule 5: exactly the receipt, never a score or band.
        expect(keysOf(receipt)).toEqual(['receiptRef', 'submittedAt']);
        expect(receipt.receiptRef).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
        run.a = { sessionId: view.sessionId, startedAt: view.startedAt, receipt, otpIds };
      },
      { timeout: STEP_MS },
    );
  });

  test('A signs in again: session start answers the same receipt', async ({ request }) => {
    test.setTimeout(180_000);
    const edge = edgeClient(request, EDGE);
    const outbox = outboxReader(request, { api: API, orgId: run.orgId, jwt: run.jwt });
    const a = invite('A');
    const token = tokenOf('A');
    const done = run.a;
    if (done === undefined) throw new Error('candidate A did not submit');

    await test.step(
      'a second OTP (after the 30-second resend gap) and verify: next is start',
      async () => {
        await requestOtp(edge, token);
        const otp = await outbox.nextOtp(a.label, done.otpIds);
        done.otpIds.add(otp.id);
        const verified = await jsonOf<{ lobbyToken: string; next: string }>(
          await edge.otpVerify(token, otp.code),
          200,
          'verifying the second OTP',
        );
        expect(verified.next).toBe('start');
        const again = await jsonOf<{ state?: string; receipt?: Receipt }>(
          await edge.lobbyPost('/v1/session/start', verified.lobbyToken, {
            rulesAcknowledged: true,
            photo: { skippedReason: 'declined' },
          }),
          200,
          'starting again after submit',
        );
        expect(keysOf(again)).toEqual(['receipt', 'state']);
        expect(again.state).toBe('submitted');
        expect(again.receipt).toEqual(done.receipt);
      },
      { timeout: 120_000 },
    );
  });

  test('M answers under 18: 403 not_eligible, no consent and no session', async ({ request }) => {
    test.setTimeout(120_000);
    const edge = edgeClient(request, EDGE);
    const outbox = outboxReader(request, { api: API, orgId: run.orgId, jwt: run.jwt });
    const m = invite('M');
    const token = tokenOf('M');

    await test.step(
      'OTP, then age false is refused and blocks the invitation',
      async () => {
        await requestOtp(edge, token);
        const otp = await outbox.nextOtp(m.label, new Set());
        const verified = await jsonOf<{ lobbyToken: string; next: string }>(
          await edge.otpVerify(token, otp.code),
          200,
          'verifying M',
        );
        expect(verified.next).toBe('age');
        const lobby = verified.lobbyToken;
        await expectRefusal(
          await edge.lobbyPost('/v1/lobby/age', lobby, { adult: false }),
          403,
          'not_eligible',
          'M declares under 18',
        );
        // Nothing after the age step is reachable (rule 9): no notice, no consent row, no session id.
        await expectRefusal(
          await edge.lobbyGet('/v1/lobby/notice', lobby),
          403,
          'not_eligible',
          'M reads the notice',
        );
        await expectRefusal(
          await edge.lobbyPost('/v1/lobby/consent', lobby, {
            noticeVersionId: '00000000-0000-4000-8000-000000000000',
            renderedSha256: '0'.repeat(64),
            accepted: true,
          }),
          403,
          'not_eligible',
          'M consents',
        );
        expect(invitationRow(m.invitationId)).toMatchObject({
          status: 'blocked_age',
          adultSelfDeclared: 'false',
          ageBlockSource: 'self_declared',
          hasSession: false,
        });
        const counts = readDb(
          `select (select count(*) from public.consents where invitation_id = :'inv')
               || '|' || (select count(*) from public.sessions where invitation_id = :'inv');`,
          { inv: m.invitationId },
          'counting M consents and sessions',
        );
        expect(counts).toEqual(['0|0']);
        // Sticky: the link now resolves as blocked.
        const resolved = await jsonOf<{ state: string }>(
          await edge.resolve(token),
          200,
          'resolving M',
        );
        expect(resolved.state).toBe('blocked_age');
      },
      { timeout: 90_000 },
    );
  });

  test('R is revoked and X expires: resolve says so and no new code is sent', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const edge = edgeClient(request, EDGE);
    const r = invite('R');
    const x = invite('X');

    await test.step(
      'the recruiter revokes R; resolve says revoked',
      async () => {
        const list = await jsonOf<{ invitations: { id: string; status: string }[] }>(
          await request.post(org(`/tests/${run.testId}/invitations/${r.invitationId}/revoke`), {
            headers: authed(),
          }),
          200,
          'revoking R',
        );
        expect(list.invitations.find((i) => i.id === r.invitationId)?.status).toBe('revoked');
        const resolved = await jsonOf<Record<string, unknown>>(
          await edge.resolve(tokenOf('R')),
          200,
          'resolving R',
        );
        expect(resolved).toEqual({ state: 'revoked' });
        await expectRefusal(
          await edge.otpRequest(tokenOf('R')),
          410,
          'link_revoked',
          'an OTP for R',
        );
      },
      { timeout: STEP_MS },
    );

    await test.step(
      'X expires_at moves into the past; resolve says expired and the status is written',
      async () => {
        // Local stack only: expires_at is immutable to every role (invitations_guard), so the row is aged as the
        // table owner with the guard and audit triggers off inside one transaction (no api path exists).
        const aged = psql(
          `begin;
           alter table public.invitations disable trigger invitations_guard;
           alter table public.invitations disable trigger invitations_audit;
           update public.invitations set expires_at = created_at + interval '1 millisecond'
            where id = :'inv' and status in ('created', 'sent') and session_id is null;
           alter table public.invitations enable trigger invitations_audit;
           alter table public.invitations enable trigger invitations_guard;
           select count(*) from public.invitations where id = :'inv' and expires_at < now();
           commit;`,
          { inv: x.invitationId },
          'ageing X',
        );
        expect(aged).toEqual(['1']);
        expect(invitationRow(x.invitationId).status).toBe('sent');
        const resolved = await jsonOf<Record<string, unknown>>(
          await edge.resolve(tokenOf('X')),
          200,
          'resolving X',
        );
        expect(resolved).toEqual({ state: 'expired' });
        // markExpired wrote the status (L-32: no session id yet).
        expect(invitationRow(x.invitationId)).toMatchObject({
          status: 'expired',
          hasSession: false,
        });
        await expectRefusal(
          await edge.otpRequest(tokenOf('X')),
          410,
          'link_expired',
          'an OTP for X',
        );
      },
      { timeout: STEP_MS },
    );
  });

  test('the mirror, quality and integrity jobs ran for A; the results row has no band', async ({
    request,
  }) => {
    test.setTimeout(JOBS_WAIT_MS + 60_000);
    const a = invite('A');
    const done = run.a;
    if (done === undefined) throw new Error('candidate A did not submit');

    await test.step(
      'the results list shows A with a quality state other than pending',
      async () => {
        const row = await poll(
          'a quality result for A',
          { timeoutMs: JOBS_WAIT_MS, everyMs: 2000 },
          async () => {
            const list = await jsonOf<{ cutoff: number; rows: Record<string, unknown>[] }>(
              await request.get(org(`/tests/${run.testId}/results`), { headers: authed() }),
              200,
              'reading the results',
            );
            expect(keysOf(list)).toEqual(['cutoff', 'rows']);
            expect(list.cutoff).toBe(CUTOFF);
            const mine = list.rows.find((r) => r['label'] === a.label);
            const quality = mine?.['quality'] as { state?: string } | undefined;
            return mine !== undefined && quality?.state !== 'pending' ? mine : undefined;
          },
        );
        // Rules 1 and 6: quality only; no band, integrity or combined field in the row.
        expect(keysOf(row)).toEqual(['label', 'quality', 'reportId', 'submittedAt']);
        expect(JSON.stringify(row)).not.toMatch(/band|integrity/i);
        const quality = row['quality'] as { state: string; score: number; belowCutoff: boolean };
        expect(keysOf(quality)).toEqual(['belowCutoff', 'score', 'state']);
        expect(quality.state).toBe('ready');
        expect(quality.belowCutoff).toBe(quality.score < CUTOFF);
      },
      { timeout: JOBS_WAIT_MS + 15_000 },
    );

    await test.step(
      'the database holds A as submitted: one consent, one session, both cards',
      async () => {
        const row = invitationRow(a.invitationId);
        expect(row.status).toBe('submitted');
        expect(row.startedAtMs).toBe(Date.parse(done.startedAt));
        const session = readDb(
          `select state, (extract(epoch from started_at) * 1000)::bigint
             from public.sessions where id = :'sid' and invitation_id = :'inv';`,
          { sid: done.sessionId, inv: a.invitationId },
          'reading the session',
        );
        expect(session).toEqual([`submitted|${Date.parse(done.startedAt)}`]);
        expect(
          countOf(
            `select count(*) from public.consents where invitation_id = :'inv';`,
            { inv: a.invitationId },
            'counting consents',
          ),
        ).toBe(1);
        // The integrity stage runs after quality; its card exists once it ran (read as postgres, not via the api).
        const cards = await poll(
          'the integrity card for A',
          { timeoutMs: 30_000, everyMs: 1000 },
          async () => {
            const [line] = readDb(
              `select (select count(*) from public.quality_cards where session_id = :'sid')
                   || '|' || (select count(*) from public.integrity_cards where session_id = :'sid');`,
              { sid: done.sessionId },
              'counting the cards',
            );
            return line === '1|1' ? line : undefined;
          },
        );
        expect(cards).toBe('1|1');
      },
      { timeout: 60_000 },
    );
  });
});
