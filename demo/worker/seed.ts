// Synthetic seed data. Names and emails are invented (@example.com). No real PII.
import type {
  Appeal, Candidate, EventType, IntegrityEvent, IntegrityResult, QualityResult, Session, Test, Tier,
} from '../src/shared/types';
import { RULESET_VERSION } from '../src/shared/types';
import { finalizeSession } from './engine';

export function still(label: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120' viewBox='0 0 160 120'>` +
    `<rect width='160' height='120' fill='#d9dce1'/><circle cx='80' cy='46' r='22' fill='#9aa1ab'/>` +
    `<path d='M34 120c4-30 22-44 46-44s42 14 46 44z' fill='#9aa1ab'/>` +
    `<rect x='0' y='102' width='160' height='18' fill='#00000099'/>` +
    `<text x='6' y='115' font-family='monospace' font-size='10' fill='#ffffff'>${label}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export function twoFacesStill(label: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120' viewBox='0 0 160 120'>` +
    `<rect width='160' height='120' fill='#d9dce1'/>` +
    `<circle cx='58' cy='46' r='20' fill='#9aa1ab'/><path d='M18 120c4-28 18-42 40-42s36 14 40 42z' fill='#9aa1ab'/>` +
    `<circle cx='118' cy='40' r='15' fill='#7d848e'/><path d='M90 104c3-20 13-30 28-30s25 10 28 30z' fill='#7d848e'/>` +
    `<rect x='0' y='102' width='160' height='18' fill='#00000099'/>` +
    `<text x='6' y='115' font-family='monospace' font-size='10' fill='#ffffff'>${label}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export interface SeedData {
  appeals: Record<string, Appeal[]>;
  tests: Test[];
  candidates: Candidate[];
  sessions: Record<string, Session>;
  results: Record<string, { quality: QualityResult; integrity: IntegrityResult }>;
}

const W1_GOOD =
  'Dear Customer, I am truly sorry for the delay and I sincerely apologise for the inconvenience this has caused. ' +
  'I have checked your order and the refund was approved on our side; our payments team has now escalated it with the bank. ' +
  'It should reach your account within 3 working days. I will personally send you an update by tomorrow evening, ' +
  'and you can reply to this message at any time. Thank you for your patience. Regards, Customer Support Team';
const W1_MID =
  'Hello, sorry for the delay in your refund. We have checked and it is in process. It will come in 5 to 7 days. ' +
  'Please wait and contact us again if it does not come.';
const W1_LOW = 'Sorry for delay. We will check and revert.';
const W2_GOOD =
  'First I would listen without interrupting and show empathy, acknowledging that calling three times is frustrating. ' +
  'I would check the earlier ticket history so they do not have to repeat themselves, then confirm the fault and offer a ' +
  'replacement where policy allows. If I cannot resolve it on the call, I would escalate to my supervisor with full notes, ' +
  'give the customer a reference number and a clear time, and follow up myself the same day.';
const W2_MID =
  'I would say sorry and check the ticket. Then I will escalate to the senior team so they can solve it fast and the customer is happy.';
const W2_LOW = 'Tell them to wait. Someone will call.';

function makeTests(now: number): Test[] {
  const created = new Date(now - 6 * 86400_000).toISOString();
  return [
    {
      id: 'tst_support', title: 'Customer Support Associate — Hindi/English', role: 'Customer Support',
      durationSec: 20 * 60, mode: 'standard', rulesetVersion: RULESET_VERSION, rulesetFrozen: true, createdAt: created,
      items: [
        { id: 'cs-q1', kind: 'mcq', points: 10, correctIndex: 1,
          prompt: 'A customer writes to you in Hindi. You are more comfortable in English. What is the best approach?',
          options: ['Reply in English only', 'Reply in Hindi, using simple and clear language', 'Transfer the chat without telling them', 'Ask them to write in English'] },
        { id: 'cs-q2', kind: 'mcq', points: 10, correctIndex: 1,
          prompt: 'Your first-response target is 2 minutes. A new chat arrives while you are finishing notes on the previous one. What do you do?',
          options: ['Finish the notes first, however long it takes', 'Send a short greeting to acknowledge the chat, then finish the notes', 'Ignore the chat until the notes are done', 'Close the notes without saving'] },
        { id: 'cs-q3', kind: 'mcq', points: 10, correctIndex: 0,
          prompt: 'A customer types their OTP into the chat to "speed things up". What should you do?',
          options: ['Tell them never to share OTPs, and do not use or store it', 'Use it to verify them faster', 'Save it in the ticket notes for later', 'Forward it to your team lead'] },
        { id: 'cs-q4', kind: 'mcq', points: 10, correctIndex: 3,
          prompt: 'What is the best way to close a resolved ticket?',
          options: ['Close it silently', 'Ask the customer to close it themselves', 'Leave it open for a week just in case', 'Confirm the issue is resolved and ask if anything else is needed'] },
        { id: 'cs-q5', kind: 'mcq', points: 10, correctIndex: 2,
          prompt: 'An angry customer starts using abusive language. What is the right response?',
          options: ['Respond in the same tone', 'End the chat immediately', 'Stay calm, set a respectful boundary, and keep helping', 'Stop replying to their messages'] },
        { id: 'cs-w1', kind: 'written', points: 25, minWords: 60,
          prompt: "A customer's refund has been delayed by 10 days. Write your reply to them.",
          rubric: ['apolog', 'refund', 'days', 'update', 'sorry', 'team'] },
        { id: 'cs-w2', kind: 'written', points: 25, minWords: 50,
          prompt: 'A customer has called three times about a broken product and says they will post about it on social media. Describe how you would handle and escalate this.',
          rubric: ['listen', 'empath', 'ticket', 'escalat', 'supervisor', 'follow'] },
      ],
    },
    {
      id: 'tst_analyst', title: 'Junior Data Analyst', role: 'Data Analyst',
      durationSec: 25 * 60, mode: 'standard', rulesetVersion: RULESET_VERSION, rulesetFrozen: false, createdAt: created,
      items: [
        { id: 'da-q1', kind: 'mcq', points: 10, correctIndex: 1,
          prompt: 'Which SQL clause filters rows after aggregation?', options: ['WHERE', 'HAVING', 'ORDER BY', 'LIMIT'] },
        { id: 'da-q2', kind: 'mcq', points: 10, correctIndex: 1,
          prompt: 'In Excel, which function looks up a value in another table by a key?', options: ['SUMIF', 'XLOOKUP', 'CONCAT', 'TRIM'] },
        { id: 'da-q3', kind: 'mcq', points: 10, correctIndex: 0,
          prompt: 'What is the median of 3, 7, 9, 20, 41?', options: ['9', '16', '20', '7'] },
        { id: 'da-q4', kind: 'mcq', points: 10, correctIndex: 1,
          prompt: 'Which join keeps every row from the left table?', options: ['INNER JOIN', 'LEFT JOIN', 'CROSS JOIN', 'SELF JOIN'] },
        { id: 'da-w1', kind: 'written', points: 40, minWords: 60,
          prompt: 'Weekly sales dropped 18% in one city while other cities were flat. Describe how you would investigate.',
          rubric: ['segment', 'trend', 'data', 'compare', 'hypothes', 'season'] },
      ],
    },
  ];
}

type Extra = [sec: number, type: EventType, detail?: string, itemId?: string, media?: string];

interface Profile {
  name: string; email: string; daysAgo: number; photo: boolean; fullscreen: boolean;
  mcq: number[]; w1: string; w2: string; extra: Extra[]; durationMin: number;
}

const PROFILES: Profile[] = [
  { name: 'Ananya Iyer', email: 'ananya.iyer@example.com', daysAgo: 3.2, photo: true, fullscreen: true,
    mcq: [1, 1, 0, 3, 2], w1: W1_GOOD, w2: W2_GOOD, durationMin: 16, extra: [] },
  { name: 'Rohan Mehta', email: 'rohan.mehta@example.com', daysAgo: 3.0, photo: true, fullscreen: true,
    mcq: [1, 1, 0, 3, 2], w1: W1_GOOD, w2: W2_MID, durationMin: 14,
    extra: [[300, 'tab_hidden'], [312, 'tab_visible'], [420, 'diary', 'My internet dropped for a few seconds.']] },
  { name: 'Priya Nair', email: 'priya.nair@example.com', daysAgo: 2.8, photo: true, fullscreen: true,
    mcq: [1, 1, 0, 3, 0], w1: W1_GOOD, w2: W2_GOOD, durationMin: 18, extra: [] },
  { name: 'Vikram Singh', email: 'vikram.singh@example.com', daysAgo: 2.5, photo: true, fullscreen: true,
    mcq: [1, 1, 0, 3, 2], w1: W1_GOOD, w2: W2_GOOD, durationMin: 17,
    extra: [
      [120, 'tab_hidden'], [151, 'tab_visible'], [260, 'tab_hidden'], [298, 'tab_visible'],
      [410, 'tab_hidden'], [436, 'tab_visible'], [520, 'tab_hidden'], [575, 'tab_visible'],
      [580, 'paste', 'Pasted 120 characters into answer', 'cs-w1'],
      [640, 'face_absent', '35'], [676, 'face_present'],
    ] },
  { name: 'Sneha Reddy', email: 'sneha.reddy@example.com', daysAgo: 2.2, photo: true, fullscreen: true,
    mcq: [1, 1, 0, 3, 2], w1: W1_GOOD, w2: W2_GOOD, durationMin: 9,
    extra: [
      [200, 'untrusted_input', 'isTrusted=false keystrokes (212 chars in 0.4 s)', 'cs-w1'],
      [380, 'untrusted_input', 'isTrusted=false keystrokes (180 chars in 0.3 s)', 'cs-w2'],
      [390, 'untrusted_input', 'isTrusted=false keystrokes (64 chars in 0.1 s)', 'cs-w2'],
      [450, 'multiple_faces', '14', undefined, twoFacesStill('2 faces 07:30')], [464, 'face_present'],
    ] },
  { name: 'Karan Malhotra', email: 'karan.malhotra@example.com', daysAgo: 2.0, photo: true, fullscreen: true,
    mcq: [1, 0, 0, 0, 2], w1: W1_GOOD, w2: W2_MID, durationMin: 15,
    extra: [[900, 'shared_wrong_answers',
      'Same rare wrong options on cs-q2 and cs-q4 as another candidate in this test, answered within 40 s of each other.']] },
  { name: 'Divya Pillai', email: 'divya.pillai@example.com', daysAgo: 1.6, photo: false, fullscreen: false,
    mcq: [0, 1, 0, 3, 2], w1: W1_MID, w2: W2_GOOD, durationMin: 19, extra: [[60, 'camera_off', 'Camera permission denied']] },
  { name: 'Rahul Verma', email: 'rahul.verma@example.com', daysAgo: 1.2, photo: true, fullscreen: true,
    mcq: [0, 0, 2, 3, 0], w1: W1_LOW, w2: W2_LOW, durationMin: 11,
    extra: [[100, 'tab_hidden'], [140, 'tab_visible'], [300, 'tab_hidden'], [330, 'tab_visible'], [500, 'tab_hidden'], [560, 'tab_visible']] },
];

function tierFor(type: EventType): Tier {
  if (type === 'shared_wrong_answers') return 'T1';
  if (type === 'grader_injection' || type === 'start' || type === 'submit') return 'T2';
  return 'T3';
}

export function buildSeed(now: number): SeedData {
  const tests = makeTests(now);
  const support = tests[0]!;
  const candidates: Candidate[] = [];
  const sessions: Record<string, Session> = {};
  const results: SeedData['results'] = {};

  PROFILES.forEach((p, i) => {
    const id = `cnd_s${i + 1}`;
    const start = Math.round(now - p.daysAgo * 86400_000);
    const end = start + p.durationMin * 60_000;
    const cand: Candidate = {
      id, testId: support.id, name: p.name, email: p.email, token: `seed${i + 1}tok`,
      status: 'submitted', createdAt: new Date(start - 86400_000).toISOString(),
    };
    const raw: Omit<IntegrityEvent, 'seq'>[] = [{ t: 0, type: 'start', tier: 'T2' }];
    if (p.fullscreen) raw.push({ t: 2_000, type: 'fullscreen_enter', tier: 'T3' });
    for (const sec of [90, 330, 610, p.durationMin * 60 - 45]) {
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      raw.push({ t: sec * 1000, type: 'snapshot', tier: 'T3', detail: 'Server-requested random still', media: still(`still ${mm}:${ss}`) });
    }
    for (const [sec, type, detail, itemId, media] of p.extra) {
      raw.push({
        t: sec * 1000, type, tier: tierFor(type),
        ...(detail ? { detail } : {}), ...(itemId ? { itemId } : {}), ...(media ? { media } : {}),
      });
    }
    raw.sort((a, b) => a.t - b.t);
    const events: IntegrityEvent[] = raw.map((e, idx) => ({ ...e, seq: idx + 1 }));
    const answers: Session['answers'] = {};
    const mcqItems = support.items.filter((it) => it.kind === 'mcq');
    mcqItems.forEach((it, k) => {
      answers[it.id] = { value: p.mcq[k]!, savedAt: new Date(start + (k + 1) * 70_000).toISOString(), seq: k + 1 };
    });
    answers['cs-w1'] = { value: p.w1, savedAt: new Date(end - 300_000).toISOString(), seq: 20 };
    answers['cs-w2'] = { value: p.w2, savedAt: new Date(end - 60_000).toISOString(), seq: 30 };
    const session: Session = {
      candidateId: id, startedAt: new Date(start).toISOString(),
      deadline: new Date(start + support.durationSec * 1000).toISOString(),
      answers, events, ...(p.photo ? { startPhoto: still('start photo') } : {}),
    };
    const done = finalizeSession(support, session, new Date(end).toISOString());
    candidates.push(cand);
    sessions[id] = done.session;
    results[id] = { quality: done.quality, integrity: done.integrity };
  });

  const invited = (id: string, testId: string, name: string, email: string, token: string): Candidate => ({
    id, testId, name, email, token, status: 'invited', createdAt: new Date(now - 86400_000).toISOString(),
  });
  candidates.push(
    invited('cnd_demo', support.id, 'Meenakshi Sundaram', 'meenakshi.s@example.com', 'demo-candidate'),
    invited('cnd_s10', support.id, 'Aditya Kulkarni', 'aditya.k@example.com', 'seed10tok'),
    invited('cnd_a1', 'tst_analyst', 'Fatima Sheikh', 'fatima.sheikh@example.com', 'seeda1tok'),
    invited('cnd_a2', 'tst_analyst', 'Harpreet Kaur', 'harpreet.kaur@example.com', 'seeda2tok'),
  );
  // One seeded appeal: Vikram disputes the paste flag (never changes score or band).
  const appeals: Record<string, Appeal[]> = {};
  const vik = sessions['cnd_s4'];
  if (vik) {
    const text = 'I pasted my own draft from the notes app on the same laptop; I wrote it during the test.';
    const at = new Date(Date.parse(vik.submittedAt ?? vik.startedAt) + 3600_000).toISOString();
    appeals['cnd_s4'] = [{ flagId: 'flg_paste_external', text, at }];
    const seq = vik.events.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
    vik.events.push({ seq, t: Date.parse(at) - Date.parse(vik.startedAt), type: 'appeal', tier: 'T3', detail: text });
  }
  return { tests, candidates, sessions, results, appeals };
}
