// End-to-end API test for the Trace demo (D1 exit gate: full flow on staging).
// Usage: node e2e/e2e.mjs [BASE]   (default https://demo.tracehiring.tech)
// Synthetic data only. No dependencies (Node 22: global fetch, node:assert/strict).
import assert from 'node:assert/strict';

const BASE = (process.argv[2] || 'https://demo.tracehiring.tech').replace(/\/$/, '');
const RIYA = 'recruiter-riya';
const ARJUN = 'reviewer-arjun';
const MEERA = 'reviewer-meera';
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z';

let current = '';
async function api(method, path, { user = RIYA, body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-demo-user': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: res.status, data };
}
async function ok(method, path, opts) {
  const r = await api(method, path, opts);
  assert.ok(r.status >= 200 && r.status < 300, `${method} ${path} expected 2xx, got ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function expectStatus(status, method, path, opts) {
  const r = await api(method, path, opts);
  assert.equal(r.status, status, `${method} ${path} expected ${status}, got ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
}
async function step(name, fn) {
  current = name;
  await fn();
  console.log(`✓ ${name}`);
}

const DURATION = 1800;
const RUBRIC = ['index', 'query', 'latency'];
const items = [
  { id: 'q1', kind: 'mcq', prompt: 'E2E: 2 + 2 = ?', options: ['3', '4', '5'], correctIndex: 1, points: 1 },
  { id: 'q2', kind: 'mcq', prompt: 'E2E: capital letter of "a"?', options: ['A', 'B'], correctIndex: 0, points: 1 },
  { id: 'q3', kind: 'written', prompt: 'E2E: How would you speed up a slow query?', rubric: RUBRIC, minWords: 5, points: 4 },
];
const GOOD_ESSAY = 'I would add an index on the filtered column, rewrite the query to avoid full scans, and measure latency before and after the change.';

async function createTest(title) {
  const t = await ok('POST', '/tests', { body: { title, role: 'E2E Analyst', durationSec: DURATION, mode: 'standard', items } });
  assert.ok(t.id, 'created test has an id');
  return t;
}
async function invite(testId, n) {
  const r = await ok('POST', `/tests/${testId}/invites`, { body: { name: `E2E Candidate ${n}`, email: `e2e.cand${n}@example.test` } });
  assert.ok(r.candidate?.id && r.candidate?.token, 'invite returns candidate with id and token');
  return r.candidate;
}
async function startProperly(token) {
  return ok('POST', `/c/${token}/start`, { body: { ageConfirmed: true, consent: true, startPhoto: TINY_JPEG } });
}

async function main() {
  console.log(`Trace demo E2E against ${BASE}`);
  let test, cand, token, report, flag, qualityBefore;

  await step('1. reset demo', async () => {
    const r = await ok('POST', '/demo/reset');
    assert.equal(r.ok, true);
  });

  await step('2. recruiter creates test (2 MCQ + 1 written) and invites a synthetic candidate', async () => {
    test = await createTest('E2E Main Test');
    assert.equal(test.items.length, 3);
    assert.equal(test.rulesetFrozen, false, 'ruleset not frozen before first start');
    cand = await invite(test.id, 1);
    token = cand.token;
  });

  await step('2b. bulk invite: 10 synthetic candidates, distinct tokens and /t/<token> links', async () => {
    const invited = [];
    for (let i = 1; i <= 10; i++) {
      const name = `E2E Bulk Candidate ${i}`;
      const r = await ok('POST', `/tests/${test.id}/invites`, { body: { name, email: `e2e.bulk${i}@example.test` } });
      assert.ok(r.candidate?.token, `bulk invite ${i} returned no token`);
      assert.equal(r.link, `/t/${r.candidate.token}`, `bulk invite ${i} link format`);
      invited.push({ ...r.candidate, expectedName: name });
    }
    assert.equal(new Set(invited.map((c) => c.token)).size, 10, 'bulk invite tokens are not distinct');
    assert.equal(new Set(invited.map((c) => c.id)).size, 10, 'bulk invite ids are not distinct');
    for (const c of invited) {
      const v = await ok('GET', `/c/${c.token}`);
      assert.equal(v.candidateName, c.expectedName, `token ${c.token} shows wrong candidate`);
      assert.equal(v.status, 'invited');
    }
    const rows = await ok('GET', `/tests/${test.id}/candidates`);
    for (const c of invited) {
      const row = rows.find((r) => r.candidate.id === c.id);
      assert.ok(row, `bulk candidate ${c.id} missing from triage`);
      assert.equal(row.candidate.status, 'invited');
      assert.equal(row.qualityScore, undefined, `invited candidate ${c.id} has a qualityScore`);
    }
  });

  await step('3. candidate view strips answer keys and rubric', async () => {
    const v = await ok('GET', `/c/${token}`, { user: RIYA });
    assert.equal(v.test.items.length, 3);
    for (const it of v.test.items) {
      assert.ok(!('correctIndex' in it), `item ${it.id} leaks correctIndex`);
      assert.ok(!('rubric' in it), `item ${it.id} leaks rubric`);
    }
    assert.ok(!JSON.stringify(v).includes('correctIndex'), 'payload contains correctIndex');
  });

  await step('4. start without age confirmation -> 403 (under-18 block)', async () => {
    await expectStatus(403, 'POST', `/c/${token}/start`, { body: { ageConfirmed: false, consent: true } });
  });

  await step('5. start properly; server-held timer deadline - serverNow ~= duration', async () => {
    const v = await startProperly(token);
    assert.ok(v.session?.deadline, 'session has deadline');
    const remaining = (Date.parse(v.session.deadline) - Date.parse(v.serverNow)) / 1000;
    assert.ok(Math.abs(remaining - DURATION) <= 10, `deadline - serverNow = ${remaining}s, expected ~${DURATION}s`);
    const t = await ok('GET', `/tests/${test.id}`);
    assert.equal(t.rulesetFrozen, true, 'ruleset frozen after first candidate starts');
  });

  await step('6. save answers and send integrity events', async () => {
    await ok('POST', `/c/${token}/answer`, { body: { itemId: 'q1', value: 1, seq: 1 } });
    await ok('POST', `/c/${token}/answer`, { body: { itemId: 'q2', value: 0, seq: 2 } });
    await ok('POST', `/c/${token}/answer`, { body: { itemId: 'q3', value: GOOD_ESSAY, seq: 3 } });
    // A real client enters fullscreen at start (counts toward evidence coverage; without it the band is 'insufficient').
    const events = [{ t: 500, type: 'fullscreen_enter' }];
    for (let i = 0; i < 4; i++) {
      events.push({ t: 1000 + i * 2000, type: 'tab_hidden' }, { t: 2000 + i * 2000, type: 'tab_visible' });
    }
    events.push({ t: 10000, type: 'paste', itemId: 'q3', detail: 'external: 120 chars pasted' });
    events.push({ t: 11000, type: 'face_absent', detail: '25' });
    const r = await ok('POST', `/c/${token}/events`, { body: { events } });
    assert.equal(r.ok, true);
  });

  await step('7. submit (twice -> idempotent)', async () => {
    assert.equal((await ok('POST', `/c/${token}/submit`)).ok, true);
    assert.equal((await ok('POST', `/c/${token}/submit`)).ok, true);
    const v = await ok('GET', `/c/${token}`);
    assert.equal(v.status, 'submitted');
  });

  await step('8. triage shows quality 0-100 and band separately; cutoff 0 shortlists', async () => {
    const rows = await ok('GET', `/tests/${test.id}/candidates`);
    const row = rows.find((r) => r.candidate.id === cand.id);
    assert.ok(row, 'candidate in triage');
    assert.ok(typeof row.qualityScore === 'number' && row.qualityScore >= 0 && row.qualityScore <= 100, `qualityScore ${row.qualityScore}`);
    assert.ok(['clear', 'review', 'strong_concern', 'insufficient'].includes(row.band), `band ${row.band}`);
    const s = await ok('POST', `/tests/${test.id}/shortlist`, { body: { cutoff: 0 } });
    assert.equal(s.shortlisted, 1);
    const rows2 = await ok('GET', `/tests/${test.id}/candidates`);
    assert.equal(rows2.find((r) => r.candidate.id === cand.id).candidate.status, 'shortlisted');
  });

  await step('9. reviewer report: quality and integrity separate; T3 capped at review', async () => {
    report = await ok('GET', `/reports/${cand.id}`, { user: ARJUN });
    assert.ok(report.quality && typeof report.quality.score === 'number', 'quality object present');
    assert.ok(report.integrity && typeof report.integrity.band === 'string', 'integrity object present');
    assert.ok(!('band' in report.quality), 'quality object must not carry band');
    assert.ok(!('score' in report.integrity), 'integrity object must not carry a score');
    assert.notEqual(report.integrity.band, 'strong_concern', 'T3-only signals must not reach strong_concern');
    assert.equal(report.integrity.band, 'review', `expected band review, got ${report.integrity.band}`);
    assert.ok(report.integrity.flags.length >= 1, 'at least one flag raised');
    assert.ok(report.integrity.flags.every((f) => f.status === 'pending'), 'shortlisted flags are pending');
    flag = report.integrity.flags[0];
    qualityBefore = report.quality.score;
  });

  await step('10. flag decisions: recruiter 403, no rationale 400, arjun confirms; quality unchanged', async () => {
    await expectStatus(403, 'POST', `/reports/${cand.id}/flags/${flag.id}`, { user: RIYA, body: { action: 'confirm', rationale: 'x' } });
    await expectStatus(400, 'POST', `/reports/${cand.id}/flags/${flag.id}`, { user: ARJUN, body: { action: 'confirm', rationale: '' } });
    const r = await ok('POST', `/reports/${cand.id}/flags/${flag.id}`, { user: ARJUN, body: { action: 'confirm', rationale: 'E2E: evidence reviewed; pattern is clear.' } });
    const f = r.integrity.flags.find((x) => x.id === flag.id);
    assert.equal(f.status, 'confirmed');
    assert.equal(f.decidedBy, ARJUN);
    assert.equal(r.quality.score, qualityBefore, 'quality score changed after integrity confirm');
  });

  await step('11. advance -> 409 while integrity review pending', async () => {
    await expectStatus(409, 'POST', `/candidates/${cand.id}/advance`);
  });

  await step('12. notice; final in window 409; candidate responds + appeals; candidate view is clean', async () => {
    const r = await ok('POST', `/reports/${cand.id}/notice`, { user: ARJUN });
    assert.ok(r.notice?.dueAt, 'notice has dueAt');
    const hours = (Date.parse(r.notice.dueAt) - Date.parse(r.notice.sentAt)) / 3600_000;
    assert.ok(Math.abs(hours - 72) < 0.01, `notice window ${hours}h, expected 72h`);
    await expectStatus(409, 'POST', `/reports/${cand.id}/final`, { user: MEERA, body: { outcome: 'uphold', rationale: 'E2E too early' } });
    assert.equal((await ok('POST', `/c/${token}/respond`, { body: { text: 'E2E: my browser reopened a tab by itself.' } })).ok, true);
    const ap = await ok('POST', `/c/${token}/appeal`, { body: { flagId: flag.id, text: 'E2E: I dispute this flag.' } });
    assert.equal(ap.ok, true);
    const cr = await ok('GET', `/c/${token}/report`);
    const s = JSON.stringify(cr);
    assert.ok(!s.includes('reviewer-'), 'candidate report leaks reviewer identity');
    assert.ok(!s.includes('sentBy'), 'candidate report leaks sentBy');
    assert.ok(!s.includes('decidedBy'), 'candidate report leaks decidedBy');
    assert.ok(!s.includes('data:image'), 'candidate report leaks media');
    assert.ok(cr.integrity?.flags.some((f) => f.id === flag.id && f.status === 'confirmed'), 'candidate sees the confirmed flag');
  });

  await step('13. final: arjun 409 (different reviewer rule), meera ok; quality unchanged', async () => {
    await expectStatus(409, 'POST', `/reports/${cand.id}/final`, { user: ARJUN, body: { outcome: 'uphold', rationale: 'E2E same reviewer' } });
    const r = await ok('POST', `/reports/${cand.id}/final`, { user: MEERA, body: { outcome: 'partial', rationale: 'E2E: response considered; partial uphold.' } });
    assert.equal(r.finalDecision?.by, MEERA);
    assert.equal(r.quality.score, qualityBefore, 'quality score changed after final decision');
  });

  await step('14. score-first: poor candidate below cutoff 90, flags not_used', async () => {
    const t2 = await createTest('E2E Score-first Test');
    const c2 = await invite(t2.id, 2);
    await startProperly(c2.token);
    await ok('POST', `/c/${c2.token}/answer`, { body: { itemId: 'q1', value: 0, seq: 1 } });
    await ok('POST', `/c/${c2.token}/answer`, { body: { itemId: 'q2', value: 1, seq: 2 } });
    await ok('POST', `/c/${c2.token}/answer`, { body: { itemId: 'q3', value: 'no idea really sorry', seq: 3 } });
    const events = [];
    for (let i = 0; i < 4; i++) events.push({ t: 1000 + i * 2000, type: 'tab_hidden' }, { t: 2000 + i * 2000, type: 'tab_visible' });
    await ok('POST', `/c/${c2.token}/events`, { body: { events } });
    await ok('POST', `/c/${c2.token}/submit`);
    const s = await ok('POST', `/tests/${t2.id}/shortlist`, { body: { cutoff: 90 } });
    assert.equal(s.belowCutoff, 1);
    assert.equal(s.shortlisted, 0);
    const rep = await ok('GET', `/reports/${c2.id}`, { user: ARJUN });
    assert.equal(rep.candidate.status, 'below_cutoff');
    assert.ok(rep.quality.score < 90, `quality ${rep.quality.score} should be < 90`);
    assert.ok(rep.integrity.flags.length >= 1, 'tab flags raised for candidate 2');
    assert.ok(rep.integrity.flags.every((f) => f.status === 'not_used'), 'below-cutoff flags must be not_used');
    const f2 = rep.integrity.flags[0];
    await expectStatus(409, 'POST', `/reports/${c2.id}/flags/${f2.id}`, { user: ARJUN, body: { action: 'confirm', rationale: 'E2E' } });
    await expectStatus(400, 'POST', `/c/${c2.token}/appeal`, { body: { flagId: f2.id, text: 'E2E appeal' } });
  });

  await step('15. audit log records evidence views', async () => {
    const log = await ok('GET', '/audit');
    assert.ok(Array.isArray(log));
    assert.ok(log.some((e) => e.action === 'viewed evidence'), 'no "viewed evidence" audit entry');
  });

  await step('16. reset demo to a clean state', async () => {
    assert.equal((await ok('POST', '/demo/reset')).ok, true);
  });

  console.log('\nALL E2E STEPS PASSED');
}

main().catch((e) => {
  console.error(`✗ ${current}\n  ${e?.message ?? e}`);
  process.exit(1);
});
