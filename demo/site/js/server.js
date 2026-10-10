// The simulated server. In the product this is the API Worker + a Durable Object per session +
// Postgres. Here it is a module over localStorage, but it keeps the same rules:
// - the server holds the truth: the deadline, the served items and the final answer (rebuilt
//   from edit events), so a refresh never resets the timer;
// - results are exactly-once: jobs are keyed by session + job + version, edits by sequence;
// - review rules (rule 4) are enforced here, not only in the UI.
import { load, save } from './store.js';
import { grade, GRADER_VERSION } from './grader.js';
import { evaluate, RULESET_VERSION } from './band.js';
import { randomToken, shortRef, seededRandom, HOUR } from './util.js';

const KEY = 'trace-demo:server:v2';
export const CONSENT_VERSION = 'consent v1 · English';
export const NOTICE_WINDOW_MS = 72 * HOUR;
export const DEADLINE_GRACE_MS = 2000;

let db = load(KEY, null);
const listeners = new Set();

export class ServerError extends Error {}

export function hasData() {
  return Boolean(db && db.tests);
}

export function replaceAll(next) {
  db = next;
  persist();
}

export function reloadFromStorage() {
  db = load(KEY, db);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persist() {
  save(KEY, db);
  for (const fn of listeners) fn();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Simulated network latency so "Saving…" is visible. */
async function rpc(fn) {
  await wait(120 + Math.floor(Math.random() * 220));
  return fn();
}

export const now = () => Date.now();

// ---------------- reads (synchronous: think of them as cached GETs) ----------------
export const listTests = () => db.tests;
export const getTest = (id) => db.tests.find((t) => t.id === id) ?? null;
export const getInvite = (token) => db.invites.find((i) => i.token === token) ?? null;
export const invitesForTest = (testId) => db.invites.filter((i) => i.testId === testId);
export const getAttempt = (id) => db.attempts.find((a) => a.id === id) ?? null;
export const attemptsForTest = (testId) => db.attempts.filter((a) => a.testId === testId);
export const allAttempts = () => db.attempts;
export const attemptForInvite = (token) => db.attempts.find((a) => a.inviteToken === token) ?? null;

function mustAttempt(id) {
  const a = getAttempt(id);
  if (!a) throw new ServerError('Attempt not found');
  return a;
}

function audit(attempt, actor, action) {
  attempt.audit.push({ t: now(), actor, action });
}

// ---------------- recruiter: tests and invites ----------------
export function validateTest(draft) {
  const problems = [];
  if (!draft.title?.trim()) problems.push('Add a title.');
  const d = Number(draft.durationMin);
  if (!Number.isFinite(d) || d < 1 || d > 180) problems.push('Duration must be 1–180 minutes.');
  if (!draft.items?.length) problems.push('Add at least one question.');
  draft.items?.forEach((item, i) => {
    const n = i + 1;
    if (!item.prompt?.trim()) problems.push(`Question ${n}: add the question text.`);
    if (!(Number(item.points) > 0)) problems.push(`Question ${n}: points must be above 0.`);
    if (item.type === 'mcq') {
      const opts = item.options.filter((o) => o.trim());
      if (opts.length < 2) problems.push(`Question ${n}: add at least two options.`);
      if (!item.options[item.correct]?.trim())
        problems.push(`Question ${n}: mark a correct option.`);
    } else {
      if (!item.rubric.keywords.length)
        problems.push(`Question ${n}: add at least one rubric point.`);
      if (!(Number(item.rubric.minWords) > 0))
        problems.push(`Question ${n}: set a minimum word count.`);
    }
  });
  return problems;
}

export function saveTest(draft) {
  return rpc(() => {
    const existing = draft.id ? getTest(draft.id) : null;
    if (existing && existing.status !== 'draft') {
      throw new ServerError('A published test is frozen. Duplicate it to make a new version.');
    }
    const record = {
      id: existing?.id ?? randomToken('tst_', 10),
      title: draft.title.trim(),
      durationMin: Number(draft.durationMin),
      pastePolicy: draft.pastePolicy,
      preset: 'Standard',
      status: 'draft',
      createdAt: existing?.createdAt ?? now(),
      publishedAt: null,
      version: 1,
      ruleset: { version: RULESET_VERSION, frozenAt: null },
      items: draft.items.map((item, i) => normaliseItem(item, i)),
    };
    if (existing) Object.assign(existing, record);
    else db.tests.unshift(record);
    persist();
    return record;
  });
}

function normaliseItem(item, i) {
  const id = item.id || `q${i + 1}_${randomToken('', 4)}`;
  if (item.type === 'mcq') {
    const options = item.options.map((o) => o.trim()).filter(Boolean);
    const correctText = item.options[item.correct]?.trim();
    return {
      id,
      type: 'mcq',
      prompt: item.prompt.trim(),
      options,
      correct: Math.max(0, options.indexOf(correctText)),
      points: Number(item.points),
    };
  }
  return {
    id,
    type: 'written',
    prompt: item.prompt.trim(),
    rubric: {
      keywords: item.rubric.keywords.map((k) => k.trim()).filter(Boolean),
      minWords: Number(item.rubric.minWords),
    },
    points: Number(item.points),
  };
}

export function publishTest(id) {
  return rpc(() => {
    const test = getTest(id);
    if (!test) throw new ServerError('Test not found');
    const problems = validateTest(test);
    if (problems.length) throw new ServerError(problems.join(' '));
    test.status = 'published';
    test.publishedAt = now();
    persist();
    return test;
  });
}

export function createInvite(testId, candidateLabel, email) {
  return rpc(() => {
    const test = getTest(testId);
    if (!test || test.status !== 'published')
      throw new ServerError('Publish the test before inviting.');
    if (!/@example\.invalid$/i.test(email)) {
      throw new ServerError('Demo rule: use a synthetic address ending in @example.invalid.');
    }
    const invite = {
      token: randomToken('inv_'),
      testId,
      candidateLabel: candidateLabel.trim(),
      email: email.trim().toLowerCase(),
      createdAt: now(),
    };
    db.invites.unshift(invite);
    persist();
    return invite;
  });
}

// ---------------- candidate: session lifecycle ----------------
export function openInvite(token) {
  const invite = getInvite(token);
  if (!invite) throw new ServerError('This invite link is not valid.');
  let attempt = attemptForInvite(token);
  if (!attempt) {
    attempt = newAttempt(invite);
    db.attempts.push(attempt);
    persist();
  }
  return attempt;
}

export function newAttempt(invite) {
  return {
    id: randomToken('att_', 10),
    testId: invite.testId,
    inviteToken: invite.token,
    candidateLabel: invite.candidateLabel,
    stage: 'consent',
    consent: null,
    adultConfirmed: false,
    camera: null,
    startStillId: null,
    device: null,
    startedAt: null,
    deadline: null,
    submittedAt: null,
    autoSubmitted: false,
    lastSeq: 0,
    editEvents: [],
    events: [],
    eventSeq: 0,
    stillRequests: [],
    finalAnswers: null,
    receipt: null,
    results: {},
    shortlist: null,
    scoreDecision: null,
    review: { flags: {}, notice: null, final: null },
    audit: [],
  };
}

export function recordConsent(attemptId) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    a.consent = { version: CONSENT_VERSION, at: now() };
    if (a.stage === 'consent') a.stage = 'age';
    audit(a, 'candidate', `Consent recorded (${CONSENT_VERSION})`);
    persist();
    return a;
  });
}

/** Only the yes/no result is stored, never the date of birth. Under 18 is blocked (rule 9). */
export function recordAge(attemptId, isAdult) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    if (isAdult) {
      a.adultConfirmed = true;
      a.stage = 'photo';
      audit(a, 'candidate', 'Age check passed (18+); date of birth not stored');
    } else {
      a.stage = 'blocked_age';
      audit(a, 'candidate', 'Age check: under 18, blocked at launch');
    }
    persist();
    return a;
  });
}

export function resetAgeBlock(attemptId) {
  const a = mustAttempt(attemptId);
  if (a.stage === 'blocked_age') a.stage = 'age';
  persist();
}

export function recordPhoto(attemptId, { camera, stillId }) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    a.camera = camera;
    a.startStillId = stillId ?? null;
    a.stage = 'ready';
    audit(
      a,
      'candidate',
      camera === 'allowed' ? 'Start photo taken (kept on this device)' : 'Camera declined',
    );
    persist();
    return a;
  });
}

/** Starts the clock. The deadline is set here and only here. */
export function startTest(attemptId, device) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    const test = getTest(a.testId);
    if (a.stage === 'in_progress' || a.stage === 'submitted') return a;
    if (!a.adultConfirmed || !a.consent)
      throw new ServerError('Consent and the age check come first.');
    const t0 = now();
    a.startedAt = t0;
    a.deadline = t0 + test.durationMin * 60 * 1000;
    a.stage = 'in_progress';
    a.device = device;
    // The ruleset freezes when the first candidate starts (rule 3).
    if (!test.ruleset.frozenAt) test.ruleset.frozenAt = t0;
    // Server-requested random stills: 3 offsets, reproducible per session.
    const rand = seededRandom(a.id);
    const span = test.durationMin * 60 * 1000;
    a.stillRequests = [0.15, 0.45, 0.75]
      .map((base) => Math.floor(span * (base + rand() * 0.2)))
      .map((offset) => ({ offset, fulfilled: false, stillId: null }));
    if (a.startStillId)
      addEvent(a, { type: 'still', reason: 'start', stillId: a.startStillId, t: 0 });
    audit(a, 'system', `Test started; deadline set by the server; ${RULESET_VERSION} frozen`);
    persist();
    return a;
  });
}

function addEvent(a, event) {
  a.eventSeq += 1;
  a.events.push({ id: `e${a.eventSeq}`, at: now(), ...event });
}

export function remainingMs(attempt) {
  return attempt.deadline - now();
}

/** Called by the client on every tick and on load; the server enforces the deadline itself. */
export function enforceDeadline(attemptId) {
  const a = getAttempt(attemptId);
  if (a && a.stage === 'in_progress' && now() > a.deadline + DEADLINE_GRACE_MS) {
    finalise(a, true);
    persist();
    return true;
  }
  return false;
}

/** An edit event. Duplicate sequence numbers are ignored (at-least-once delivery). */
export function saveEdit(attemptId, { seq, itemId, value }) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    if (enforceDeadline(attemptId)) throw new ServerError('Time is up: the test was submitted.');
    if (a.stage !== 'in_progress') throw new ServerError('This test is not in progress.');
    if (a.editEvents.some((e) => e.seq === seq)) return { duplicate: true, seq };
    a.editEvents.push({ seq, itemId, value, t: now() - a.startedAt });
    a.lastSeq = Math.max(a.lastSeq, seq);
    persist();
    return { ok: true, seq };
  });
}

/** Integrity events from the client (T3). Stored with the server receive time. */
export function postEvent(attemptId, event) {
  const a = getAttempt(attemptId);
  if (!a || a.stage !== 'in_progress') return;
  addEvent(a, { ...event, t: now() - a.startedAt });
  persist();
}

export function dueStillRequests(attemptId) {
  const a = getAttempt(attemptId);
  if (!a || a.stage !== 'in_progress') return [];
  const elapsed = now() - a.startedAt;
  return a.stillRequests
    .map((r, index) => ({ ...r, index }))
    .filter((r) => !r.fulfilled && r.offset <= elapsed);
}

export function fulfilStill(attemptId, index, stillId) {
  const a = getAttempt(attemptId);
  if (!a || a.stage !== 'in_progress') return;
  const req = a.stillRequests[index];
  if (!req || req.fulfilled) return;
  req.fulfilled = true;
  req.stillId = stillId;
  if (stillId) addEvent(a, { type: 'still', reason: 'random', stillId, t: now() - a.startedAt });
  persist();
}

export function submit(attemptId) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    if (a.stage === 'submitted') return a;
    if (a.stage !== 'in_progress') throw new ServerError('This test is not in progress.');
    const late = now() > a.deadline + DEADLINE_GRACE_MS;
    finalise(a, late);
    persist();
    return a;
  });
}

/** The client reports the timer reached zero; the server checks its own clock before acting. */
export function timeUp(attemptId) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    if (a.stage !== 'in_progress') return a;
    if (now() < a.deadline) throw new ServerError('Time is not up yet (server clock).');
    finalise(a, true);
    persist();
    return a;
  });
}

/** Demo control: move the server deadline so the last seconds can be shown. */
export function demoSkipToEnd(attemptId, secondsLeft = 20) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    if (a.stage !== 'in_progress') return a;
    a.deadline = Math.min(a.deadline, now() + secondsLeft * 1000);
    audit(a, 'system', `Demo control: deadline moved to ${secondsLeft} s from now`);
    persist();
    return a;
  });
}

/** Rebuild the final answer from edit events: the last edit per item, by sequence. */
export function rebuildAnswers(editEvents) {
  const answers = {};
  for (const e of [...editEvents].sort((x, y) => x.seq - y.seq)) answers[e.itemId] = e.value;
  return answers;
}

function finalise(a, auto) {
  a.finalAnswers = rebuildAnswers(a.editEvents);
  a.submittedAt = auto ? Math.min(now(), a.deadline + DEADLINE_GRACE_MS) : now();
  a.autoSubmitted = auto;
  a.stage = 'submitted';
  a.receipt = a.receipt ?? shortRef();
  audit(a, 'system', auto ? 'Auto-submitted at time-out' : 'Submitted by the candidate');
  runJobs(a);
}

/**
 * Two independent jobs, each idempotent on its key. Neither job reads the other's output (rule 1).
 */
export function runJobs(a) {
  const test = getTest(a.testId);
  const aqKey = `${a.id}:aq:${GRADER_VERSION}`;
  if (!a.results.aq || a.results.aq.key !== aqKey) {
    a.results.aq = { key: aqKey, at: now(), ...grade(test, a.finalAnswers) };
  }
  const bandKey = `${a.id}:band:${RULESET_VERSION}`;
  if (!a.results.integrity || a.results.integrity.key !== bandKey) {
    const durationMs = Math.max(1, (a.submittedAt ?? now()) - (a.startedAt ?? now()));
    a.results.integrity = {
      key: bandKey,
      at: now(),
      ...evaluate(a.events, { pastePolicy: test.pastePolicy, camera: a.camera, durationMs }),
    };
  }
}

// ---------------- recruiter: score-first triage (rule 6, rule 2) ----------------
export function shortlistAtCutoff(testId, cutoff) {
  return rpc(() => {
    let n = 0;
    for (const a of attemptsForTest(testId)) {
      if (a.stage !== 'submitted' || a.scoreDecision || a.shortlist) continue;
      if (a.results.aq.score >= cutoff) {
        a.shortlist = { at: now(), by: 'recruiter', cutoff };
        audit(a, 'recruiter', `Shortlisted on Answer Quality (cutoff ${cutoff})`);
        n += 1;
      }
    }
    persist();
    return n;
  });
}

export function removeFromShortlist(attemptId) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    if (a.review.notice && !a.review.final) {
      throw new ServerError('A response window is open; finish the integrity review first.');
    }
    a.shortlist = null;
    audit(a, 'recruiter', 'Removed from shortlist; integrity flags now not used');
    persist();
    return a;
  });
}

/** Bulk reject works only on Answer Quality (rule 2). It takes no integrity input at all. */
export function rejectBelowCutoff(testId, cutoff) {
  return rpc(() => {
    let n = 0;
    for (const a of attemptsForTest(testId)) {
      if (a.stage !== 'submitted' || a.shortlist || a.scoreDecision) continue;
      if (a.results.aq.score < cutoff) {
        a.scoreDecision = { outcome: 'not_progressed', basis: 'answer_quality', cutoff, at: now() };
        audit(a, 'recruiter', `Not progressed: Answer Quality below cutoff ${cutoff}`);
        n += 1;
      }
    }
    persist();
    return n;
  });
}

// ---------------- reviewer (rule 4: enforced here, not only in the UI) ----------------
function mustReviewable(a) {
  if (!a.shortlist) {
    throw new ServerError(
      'Integrity is reviewed only for shortlisted candidates; these flags are not used.',
    );
  }
}

export function flagState(a, flagId) {
  return a.review.flags[flagId] ?? { state: 'pending_review' };
}

export function confirmFlag(attemptId, flagId, reviewer, rationale) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    mustReviewable(a);
    if (!rationale?.trim())
      throw new ServerError('Confirming needs a written rationale (the candidate sees it).');
    if (a.review.notice) throw new ServerError('The notice is already sent; flags are locked.');
    a.review.flags[flagId] = {
      state: 'confirmed',
      by: reviewer,
      at: now(),
      rationale: rationale.trim(),
    };
    audit(a, reviewer, `Confirmed flag ${flagId}`);
    persist();
    return a;
  });
}

export function dismissFlag(attemptId, flagId, reviewer, rationale) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    mustReviewable(a);
    if (a.review.notice) throw new ServerError('The notice is already sent; flags are locked.');
    a.review.flags[flagId] = {
      state: 'overturned',
      by: reviewer,
      at: now(),
      rationale: rationale?.trim() || 'Overturned: not supported by the evidence.',
    };
    audit(a, reviewer, `Overturned flag ${flagId}`);
    persist();
    return a;
  });
}

export function sendNotice(attemptId, reviewer) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    mustReviewable(a);
    const confirmed = Object.entries(a.review.flags).filter(([, f]) => f.state === 'confirmed');
    if (!confirmed.length)
      throw new ServerError('Confirm at least one flag before sending a notice.');
    if (a.review.notice) throw new ServerError('The notice was already sent.');
    a.review.notice = { sentAt: now(), by: reviewer, skipMs: 0, response: null };
    audit(a, reviewer, 'Notice sent; 72-hour response window started');
    persist();
    return a;
  });
}

/** The notice window is measured on its own clock, so the demo can skip it. */
export function noticeElapsedMs(a) {
  const n = a.review.notice;
  if (!n) return 0;
  return now() - n.sentAt + n.skipMs;
}

export function noticeRemainingMs(a) {
  return NOTICE_WINDOW_MS - noticeElapsedMs(a);
}

export function simulate72h(attemptId) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    if (!a.review.notice) throw new ServerError('No notice has been sent.');
    a.review.notice.skipMs += NOTICE_WINDOW_MS;
    audit(a, 'system', 'Demo control: 72 hours simulated');
    persist();
    return a;
  });
}

export function candidateRespond(attemptId, text) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    const n = a.review.notice;
    if (!n) throw new ServerError('There is no open notice.');
    if (noticeRemainingMs(a) <= 0) throw new ServerError('The 72-hour window has closed.');
    if (!text?.trim()) throw new ServerError('Write a response first.');
    n.response = { text: text.trim(), at: now() };
    audit(a, 'candidate', 'Response submitted');
    persist();
    return a;
  });
}

export function canDecide(a, reviewer) {
  const n = a.review.notice;
  if (!a.shortlist) return { ok: false, why: 'Not shortlisted: flags not used.' };
  if (!n)
    return { ok: false, why: 'Send the notice first: no integrity decision before notice + 72 h.' };
  if (a.review.final) return { ok: false, why: 'Already decided.' };
  if (!n.response && noticeRemainingMs(a) > 0) {
    return { ok: false, why: 'Waiting for the candidate: the 72-hour window is still open.' };
  }
  const confirmers = new Set(
    Object.values(a.review.flags)
      .filter((f) => f.state === 'confirmed')
      .map((f) => f.by),
  );
  confirmers.add(n.by);
  if (confirmers.has(reviewer)) {
    return {
      ok: false,
      why: 'A different reviewer from the one who confirmed must make the final call.',
    };
  }
  return { ok: true };
}

export function finalDecision(attemptId, reviewer, outcome, rationale) {
  return rpc(() => {
    const a = mustAttempt(attemptId);
    const gate = canDecide(a, reviewer);
    if (!gate.ok) throw new ServerError(`Blocked by the server: ${gate.why}`);
    if (!rationale?.trim()) throw new ServerError('A written rationale is required.');
    a.review.final = { outcome, by: reviewer, at: now(), rationale: rationale.trim() };
    audit(a, reviewer, `Final integrity decision: ${outcome}`);
    persist();
    return a;
  });
}

export function logView(attemptId, actor, what) {
  const a = getAttempt(attemptId);
  if (!a) return;
  audit(a, actor, what);
  persist();
}

/** Where a submitted attempt stands. Score-first (rule 6). */
export function triageStatus(a) {
  if (a.stage !== 'submitted')
    return { key: 'in_progress', label: stageLabel(a.stage), tone: 'neutral' };
  if (a.scoreDecision)
    return { key: 'not_progressed', label: 'Not progressed · score below cutoff', tone: 'neutral' };
  if (!a.shortlist)
    return { key: 'not_used', label: 'Not shortlisted · flags not used', tone: 'neutral' };
  const band = a.results.integrity.band;
  const r = a.review;
  if (r.final)
    return {
      key: 'decided',
      label: `Integrity decided: ${OUTCOMES[r.final.outcome]}`,
      tone: 'accent',
    };
  if (r.notice) {
    if (r.notice.response || noticeRemainingMs(a) <= 0) {
      return {
        key: 'ready_final',
        label: 'Ready for final call (second reviewer)',
        tone: 'review',
      };
    }
    return { key: 'awaiting', label: 'Integrity: awaiting response', tone: 'review' };
  }
  if (band === 'clear') return { key: 'advance', label: 'Advance', tone: 'clear' };
  if (band === 'insufficient')
    return {
      key: 'advance_interview',
      label: 'Advance · judge integrity at interview',
      tone: 'neutral',
    };
  const flags = a.results.integrity.flags;
  const states = flags.map((f) => flagState(a, f.id).state);
  if (flags.length && states.every((s) => s === 'overturned')) {
    return { key: 'cleared', label: 'Advance · all flags overturned', tone: 'clear' };
  }
  if (states.includes('confirmed') && !states.includes('pending_review')) {
    return { key: 'notice_due', label: 'Confirmed · send notice', tone: 'review' };
  }
  return { key: 'in_review', label: 'In review queue', tone: 'accent' };
}

export const OUTCOMES = {
  uphold: 'Upheld',
  partial: 'Partially upheld',
  overturn: 'Overturned',
  reattempt: 'Supervised re-attempt offered',
};

export function stageLabel(stage) {
  return (
    {
      consent: 'Invited · opened link',
      age: 'Consent given',
      photo: 'Age confirmed',
      ready: 'Ready to start',
      in_progress: 'In progress',
      submitted: 'Submitted',
      blocked_age: 'Blocked: under 18',
    }[stage] ?? stage
  );
}
