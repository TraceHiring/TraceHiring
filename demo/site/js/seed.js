// Seed data: one sample test and six synthetic candidates with finished attempts.
// Every name is obviously fake, every address ends in @example.invalid, and there are no
// phone numbers. Seeded integrity events go through the same band engine as live ones.
import { replaceAll, newAttempt, runJobs, rebuildAnswers } from './server.js';
import { RULESET_VERSION } from './band.js';
import { putStill, clearDevice } from './store.js';
import { syntheticStill } from './camera.js';
import { randomToken, shortRef, HOUR } from './util.js';

const MIN = 60 * 1000;

export const SAMPLE_TEST_ITEMS = [
  {
    id: 'q1',
    type: 'mcq',
    prompt: 'A customer says their order arrived damaged. What should you do first?',
    options: [
      'Ask them to place a new order',
      'Apologise and ask for a photo of the damage',
      'Close the ticket as resolved',
      'Transfer them to billing',
    ],
    correct: 1,
    points: 10,
  },
  {
    id: 'q2',
    type: 'mcq',
    prompt:
      'A train travels 180 km in 3 hours. At the same speed, how far does it travel in 5 hours?',
    options: ['240 km', '270 km', '300 km', '360 km'],
    correct: 2,
    points: 10,
  },
  {
    id: 'q3',
    type: 'mcq',
    prompt: 'Which sentence is grammatically correct?',
    options: [
      "She don't know the answer.",
      "She doesn't knows the answer.",
      "She doesn't know the answer.",
      'She not know the answer.',
    ],
    correct: 2,
    points: 10,
  },
  {
    id: 'q4',
    type: 'mcq',
    prompt:
      'Average handle time is 6 minutes per call. How many calls can one agent handle in a 3-hour block with no breaks?',
    options: ['18', '24', '30', '36'],
    correct: 2,
    points: 10,
  },
  {
    id: 'q5',
    type: 'written',
    prompt:
      'A customer was charged twice for the same order. Write a short reply to them (about 50–120 words).',
    rubric: { keywords: ['apologise', 'refund', 'charge', 'days', 'order'], minWords: 50 },
    points: 30,
  },
  {
    id: 'q6',
    type: 'written',
    prompt:
      'An angry caller insists on speaking to a manager. Explain how you would handle the call (about 40–100 words).',
    rubric: { keywords: ['listen', 'calm', 'understand', 'solution', 'manager'], minWords: 40 },
    points: 30,
  },
];

const ANSWERS = {
  A: {
    q1: 1,
    q2: 2,
    q3: 2,
    q4: 1,
    q5: 'Hi, thank you for writing in, and I apologise for the trouble. I can see your order was charged twice by mistake. I have raised a refund for the duplicate payment today, and it should reach your original payment method within 5 to 7 working days. Your order itself is confirmed and will ship as planned. If the refund does not appear by then, reply here and I will follow it up personally.',
    q6: 'First I would let the caller finish and listen without interrupting, because people calm down once they feel heard. I would repeat the problem back so they know I understand it, then offer a clear solution with a time frame. If they still want a supervisor, I would arrange a callback from my team lead and tell them exactly when it will happen.',
  },
  B: {
    q1: 1,
    q2: 1,
    q3: 2,
    q4: 2,
    q5: 'Hello, I am sorry for this and I apologise for the confusion. Your order was charged two times because the payment page timed out. I have asked our billing team to refund the extra amount straight away. You will get an email once it is processed. Please keep this message for your records and contact us again if anything still looks wrong with your account.',
    q6: 'I would stay calm and listen to the full complaint first. Then I would say that I understand why they are upset and explain what I can do right now. If they still ask for a manager, I would note the details, transfer the call with a summary, and make sure they do not have to repeat everything again.',
  },
  C: {
    q1: 1,
    q2: 2,
    q3: 2,
    q4: 0,
    q5: 'Thank you for telling us about this. I checked your order and it was charged twice on the same day. I have started a refund for the second payment, and you should see it within 5 working days. Nothing else is needed from you. If you have any other question about this order, just reply to this email and we will help.',
    q6: 'I would listen carefully and keep my voice calm, and tell them I understand. Most angry callers want their problem fixed, so I would try to fix it on the call. If they insist, I would pass the call to my team lead with a short note of what happened so far, so the customer does not need to explain again.',
  },
  D: {
    q1: 1,
    q2: 0,
    q3: 2,
    q4: 1,
    q5: 'Sorry about this, and I apologise. The order was charged twice due to a bank retry. A refund for the extra payment has been started and you will get a confirmation email when it is complete. You do not need to do anything else. Thank you for your patience, and please write back if you see any other problem with your payment.',
    q6: 'Listen first, stay calm, and show that I understand the issue. Then I would offer a fix I can deliver today. If the caller still wants the manager, I would book a callback and confirm the time, and log the case so nothing is lost between teams.',
  },
  E: {
    q1: 1,
    q2: 2,
    q3: 0,
    q4: 3,
    q5: 'Thank you for telling us about this. I checked your order and it was charged twice on the same day. I have started a refund for the second payment, and you should see it soon. Nothing else is needed from you. If you have any other question, just reply to this email and we will help.',
    q6: 'I would listen and say sorry. If they want a manager I would transfer the call quickly so they are happy. Angry customers need fast action more than talking.',
  },
  F: {
    q1: 0,
    q2: 2,
    q3: 1,
    q4: 3,
    q5: 'Sorry for the problem. We will check the charge and refund you if it is correct. Please wait and we will contact you. Thanks for your patience and for choosing our company, have a nice day.',
    q6: 'Transfer to the manager if they shout. Try to stay calm and polite. Do not argue with them because it makes things worse for everyone.',
  },
};

const PEOPLE = [
  { key: 'A', name: 'Asha', device: 'Laptop · Chrome', camera: 'allowed' },
  { key: 'B', name: 'Bharat', device: 'Laptop · Edge', camera: 'allowed' },
  { key: 'C', name: 'Chitra', device: 'Laptop · Chrome', camera: 'allowed' },
  { key: 'D', name: 'Dev', device: 'Phone · Chrome Android', camera: 'declined' },
  { key: 'E', name: 'Esha', device: 'Laptop · Firefox', camera: 'allowed' },
  { key: 'F', name: 'Farhan', device: 'Phone · Safari iOS', camera: 'allowed' },
];

export const label = (p) => `Candidate ${p.key} · ${p.name} (demo)`;

function editsFor(answers, startSeq = 1) {
  // A few progressive snapshots per written item, one per MCQ, like a real edit stream.
  const events = [];
  let seq = startSeq;
  let t = 40 * 1000;
  for (const [itemId, value] of Object.entries(answers)) {
    if (typeof value === 'string') {
      const words = value.split(' ');
      for (const share of [0.3, 0.7, 1]) {
        t += 45 * 1000;
        events.push({
          seq: seq++,
          itemId,
          value: words.slice(0, Math.ceil(words.length * share)).join(' '),
          t,
        });
      }
    } else {
      t += 30 * 1000;
      events.push({ seq: seq++, itemId, value, t });
    }
  }
  return events;
}

export function seedDemo() {
  clearDevice();
  const t0 = Date.now();
  const test = {
    id: 'tst_sample',
    title: 'Customer Support Associate · Screening (sample)',
    durationMin: 15,
    pastePolicy: 'blocked',
    preset: 'Standard',
    status: 'published',
    createdAt: t0 - 72 * HOUR,
    publishedAt: t0 - 70 * HOUR,
    version: 1,
    ruleset: { version: RULESET_VERSION, frozenAt: null },
    items: SAMPLE_TEST_ITEMS,
  };
  const db = { version: 2, tests: [test], invites: [], attempts: [] };

  const attempts = {};
  PEOPLE.forEach((p, i) => {
    const invite = {
      token: randomToken('inv_'),
      testId: test.id,
      candidateLabel: label(p),
      email: `${p.name.toLowerCase()}.demo@example.invalid`,
      createdAt: t0 - 60 * HOUR,
    };
    db.invites.push(invite);
    const a = newAttempt(invite);
    const startedAt = t0 - (48 - i * 2) * HOUR;
    a.consent = { version: 'consent v1 · English', at: startedAt - 4 * MIN };
    a.adultConfirmed = true;
    a.camera = p.camera;
    a.device = { kind: p.device, fullscreen: !p.device.startsWith('Phone') };
    a.startedAt = startedAt;
    a.deadline = startedAt + test.durationMin * MIN;
    a.editEvents = editsFor(ANSWERS[p.key]);
    a.lastSeq = a.editEvents.length;
    a.finalAnswers = rebuildAnswers(a.editEvents);
    a.submittedAt = startedAt + (12 + (i % 3)) * MIN;
    a.stage = 'submitted';
    a.receipt = shortRef();
    a.audit.push({
      t: a.consent.at,
      actor: 'candidate',
      action: 'Consent recorded (consent v1 · English)',
    });
    a.audit.push({
      t: startedAt,
      actor: 'system',
      action: `Test started; ${RULESET_VERSION} frozen`,
    });
    a.audit.push({ t: a.submittedAt, actor: 'system', action: 'Submitted by the candidate' });
    if (!test.ruleset.frozenAt || startedAt < test.ruleset.frozenAt)
      test.ruleset.frozenAt = startedAt;
    attempts[p.key] = a;
    db.attempts.push(a);
  });

  const ev = (a, event) => {
    a.eventSeq += 1;
    a.events.push({ id: `e${a.eventSeq}`, at: a.startedAt + event.t, ...event });
  };
  const stills = (a, seed, extra = []) => {
    if (a.camera !== 'allowed') return;
    const start = randomToken('still_', 10);
    putStill(start, syntheticStill(seed, { label: 'SYNTHETIC · start photo' }));
    a.startStillId = start;
    ev(a, { type: 'still', reason: 'start', stillId: start, t: 0 });
    for (const t of [150000, 410000, 690000, ...extra]) {
      const id = randomToken('still_', 10);
      putStill(id, syntheticStill(seed, { label: 'SYNTHETIC · random still' }));
      ev(a, { type: 'still', reason: 'random', stillId: id, t });
    }
  };

  // A: one short tab switch only -> Clear.
  stills(attempts.A, 0);
  ev(attempts.A, { type: 'tab_hidden', t: 300000 });
  ev(attempts.A, { type: 'tab_visible', awayMs: 4000, t: 304000 });

  // B: three focus losses + a blocked paste attempt -> two T3 families -> Review.
  stills(attempts.B, 1);
  for (const [t, away] of [
    [200000, 9000],
    [410000, 21000],
    [620000, 14000],
  ]) {
    ev(attempts.B, { type: 'tab_hidden', t });
    ev(attempts.B, { type: 'window_blur', t: t + 120 });
    ev(attempts.B, { type: 'tab_visible', awayMs: away, t: t + away });
  }
  ev(attempts.B, {
    type: 'paste',
    itemId: 'q5',
    length: 212,
    blocked: true,
    internal: false,
    t: 636000,
  });

  // C: T1 similarity with E + a second face with a viewable still -> Strong concern.
  stills(attempts.C, 2);
  const faceStill = randomToken('still_', 10);
  putStill(faceStill, syntheticStill(2, { secondPerson: true, label: 'SYNTHETIC · flag still' }));
  ev(attempts.C, { type: 'second_face', durationS: 14, stillId: faceStill, t: 520000 });
  ev(attempts.C, {
    type: 'similarity',
    itemId: 'q5',
    itemLabel: 'Q5 (written)',
    similarity: 0.91,
    counterpartAttemptId: attempts.E.id,
    counterpartLabel: label(PEOPLE[4]),
    counterpartExcerpt: ANSWERS.E.q5,
    t: 780000,
  });

  // D: camera declined + connectivity gaps -> Insufficient evidence.
  ev(attempts.D, { type: 'connectivity_gap', durationMs: 150000, t: 260000 });
  ev(attempts.D, { type: 'connectivity_gap', durationMs: 90000, t: 520000 });

  // E: Review-level signals, but below the cutoff -> "not used".
  stills(attempts.E, 4);
  for (const t of [120000, 330000, 560000]) ev(attempts.E, { type: 'tab_hidden', t });
  ev(attempts.E, { type: 'question_copy', itemId: 'q5', length: 96, t: 125000 });

  // F: T1 replay mismatch, but below the cutoff -> "not used".
  stills(attempts.F, 5);
  ev(attempts.F, { type: 'replay_mismatch', itemId: 'q6', t: 760000 });

  // runJobs reads the test from the live db, so the seed db goes in first.
  replaceAll(db);
  for (const a of db.attempts) runJobs(a);
  // Seeded triage: the recruiter shortlisted at cutoff 65 (Answer Quality only).
  for (const a of db.attempts) {
    if (a.results.aq.score >= 65) {
      a.shortlist = { at: t0 - 20 * HOUR, by: 'recruiter', cutoff: 65 };
      a.audit.push({
        t: t0 - 20 * HOUR,
        actor: 'recruiter',
        action: 'Shortlisted on Answer Quality (cutoff 65)',
      });
    }
  }
  replaceAll(db);
  return db;
}
