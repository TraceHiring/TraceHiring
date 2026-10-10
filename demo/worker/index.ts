// Trace demo Worker: /api/* goes to a single Durable Object (DemoStore); everything else is static assets.
import { DurableObject } from 'cloudflare:workers';
import type {
  Analytics, Appeal, AuditEntry, LiveSessionRow, Band, Candidate, CandidateReportView, CandidateTestView, DemoUserId, EventType,
  FinalDecision, Flag, IntegrityEvent, IntegrityResult, Item, Notice, QualityResult, Report, ReviewerInboxRow,
  Session, Test, TestSummary, TriageRow,
} from '../src/shared/types';
import { DEMO_USERS, RULESET_VERSION } from '../src/shared/types';
import { computeIntegrity, finalizeSession } from './engine';
import { buildSeed } from './seed';

export interface Env {
  STORE: DurableObjectNamespace<DemoStore>;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const stub = env.STORE.get(env.STORE.idFromName('demo-org'));
      return stub.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

type Results = { quality: QualityResult; integrity: IntegrityResult };

const GRACE_MS = 5_000;
const NOTICE_MS = 72 * 3600_000;
const MAX_MEDIA = 600_000;
const CLIENT_EVENTS = new Set<EventType>([
  'tab_hidden', 'tab_visible', 'window_blur', 'fullscreen_exit', 'fullscreen_enter', 'paste', 'copy_question',
  'untrusted_input', 'burst_after_return', 'snapshot', 'camera_off', 'diary', 'answer_saved',
  'face_absent', 'multiple_faces', 'face_present', 'mic_speech',
]);
const REVIEWERS: DemoUserId[] = ['reviewer-arjun', 'reviewer-meera'];
const SUBMITTED: Candidate['status'][] = ['submitted', 'shortlisted', 'below_cutoff', 'advanced'];

function rand(n: number): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function stripItems(items: Item[]): Item[] {
  return items.map((it) => {
    if (it.kind === 'mcq') {
      const { correctIndex: _c, ...rest } = it;
      return rest;
    }
    const { rubric: _r, ...rest } = it;
    return rest;
  });
}

function str(v: unknown, field: string, max = 2000): string {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${field} is required.`);
  if (v.length > max) throw new HttpError(400, `${field} is too long.`);
  return v.trim();
}

export class DemoStore extends DurableObject<Env> {
  private get s() {
    return this.ctx.storage;
  }

  // ---------- storage helpers ----------
  private async tests(): Promise<Test[]> {
    return (await this.s.get<Test[]>('tests')) ?? [];
  }
  private async candidates(): Promise<Candidate[]> {
    return (await this.s.get<Candidate[]>('candidates')) ?? [];
  }
  private async session(cid: string) {
    return this.s.get<Session>(`session:${cid}`);
  }
  private async results(cid: string) {
    return this.s.get<Results>(`result:${cid}`);
  }
  private async notice(cid: string) {
    return this.s.get<Notice>(`notice:${cid}`);
  }
  private async final(cid: string) {
    return this.s.get<FinalDecision>(`final:${cid}`);
  }
  private async saveCandidate(c: Candidate) {
    const all = await this.candidates();
    const i = all.findIndex((x) => x.id === c.id);
    if (i >= 0) all[i] = c;
    else all.push(c);
    await this.s.put('candidates', all);
  }
  private async audit(actor: string, action: string, candidateId?: string) {
    const log = (await this.s.get<AuditEntry[]>('audit')) ?? [];
    log.push({ at: new Date().toISOString(), actor, action, ...(candidateId ? { candidateId } : {}) });
    await this.s.put('audit', log.slice(-500));
  }
  private async testOr404(id: string) {
    const t = (await this.tests()).find((x) => x.id === id);
    if (!t) throw new HttpError(404, 'Test not found.');
    return t;
  }
  private async candOr404(id: string) {
    const c = (await this.candidates()).find((x) => x.id === id);
    if (!c) throw new HttpError(404, 'Candidate not found.');
    return c;
  }
  private async candByToken(token: string) {
    const c = (await this.candidates()).find((x) => x.token === token);
    if (!c) throw new HttpError(404, 'This invite link is not valid.');
    return c;
  }

  private async reset() {
    await this.s.deleteAll();
    const seed = buildSeed(Date.now());
    await this.s.put('tests', seed.tests);
    await this.s.put('candidates', seed.candidates);
    for (const [cid, sess] of Object.entries(seed.sessions)) await this.s.put(`session:${cid}`, sess);
    for (const [cid, r] of Object.entries(seed.results)) await this.s.put(`result:${cid}`, r);
    for (const [cid, a] of Object.entries(seed.appeals)) await this.s.put(`appeals:${cid}`, a);
    await this.s.put('audit', [{ at: new Date().toISOString(), actor: 'system', action: 'demo data reset and seeded' }]);
    await this.s.put('seeded', true);
  }

  /** Server holds the truth: sessions past deadline + grace are submitted automatically. */
  private async sweepExpired() {
    const now = Date.now();
    for (const c of await this.candidates()) {
      if (c.status !== 'in_progress') continue;
      const sess = await this.session(c.id);
      if (sess && !sess.submittedAt && now > Date.parse(sess.deadline) + GRACE_MS) {
        await this.doSubmit(c, sess, sess.deadline, 'system');
      }
    }
  }

  private async doSubmit(c: Candidate, sess: Session, at: string, actor: string) {
    const test = await this.testOr404(c.testId);
    const done = finalizeSession(test, sess, at);
    await this.s.put(`session:${c.id}`, done.session);
    await this.s.put(`result:${c.id}`, { quality: done.quality, integrity: done.integrity });
    await this.saveCandidate({ ...c, status: 'submitted' });
    await this.audit(actor, 'submitted assessment', c.id);
  }

  private async hydrate(sess: Session): Promise<Session> {
    const refs = [sess.startPhoto, ...sess.events.map((e) => e.media)].filter(
      (m): m is string => !!m && m.startsWith('ref:'),
    );
    if (!refs.length) return sess;
    const map = await this.s.get<string>(refs.map((r) => r.slice(4)));
    const val = (m?: string) => (m && m.startsWith('ref:') ? map.get(m.slice(4)) : m);
    const photo = val(sess.startPhoto);
    return {
      ...sess,
      ...(photo ? { startPhoto: photo } : {}),
      events: sess.events.map((e) => {
        if (!e.media) return e;
        const m = val(e.media);
        return m ? { ...e, media: m } : (({ media: _m, ...rest }) => rest)(e);
      }),
    };
  }

  private async buildReport(cid: string): Promise<Report> {
    const candidate = await this.candOr404(cid);
    const test = await this.testOr404(candidate.testId);
    const sess = await this.session(cid);
    const r = await this.results(cid);
    const notice = await this.notice(cid);
    const finalDecision = await this.final(cid);
    const appeals = await this.s.get<Appeal[]>(`appeals:${cid}`);
    return {
      candidate, test,
      ...(sess ? { session: await this.hydrate(sess) } : {}),
      ...(r ? { quality: r.quality, integrity: r.integrity } : {}),
      ...(notice ? { notice } : {}),
      ...(finalDecision ? { finalDecision } : {}),
      ...(appeals?.length ? { appeals } : {}),
    };
  }

  private async candidateView(c: Candidate): Promise<CandidateTestView> {
    const test = await this.testOr404(c.testId);
    const sess = await this.session(c.id);
    return {
      candidateName: c.name,
      test: { ...test, items: stripItems(test.items) },
      status: c.status,
      ...(sess
        ? { session: { startedAt: sess.startedAt, deadline: sess.deadline, ...(sess.submittedAt ? { submittedAt: sess.submittedAt } : {}), answers: sess.answers } }
        : {}),
      serverNow: new Date().toISOString(),
    };
  }

  private requireReviewer(actor: DemoUserId) {
    if (!REVIEWERS.includes(actor)) throw new HttpError(403, 'Only reviewers can make integrity decisions.');
  }

  // ---------- request handling ----------
  async fetch(request: Request): Promise<Response> {
    try {
      if (!(await this.s.get<boolean>('seeded'))) await this.reset();
      await this.sweepExpired();
      return json(await this.route(request));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      return json({ error: 'Internal error' }, 500);
    }
  }

  private async body(request: Request): Promise<Record<string, unknown>> {
    if (request.method === 'GET') return {};
    const text = await request.text();
    if (!text) return {};
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    } catch {
      throw new HttpError(400, 'Invalid JSON body.');
    }
  }

  private async route(request: Request): Promise<unknown> {
    const url = new URL(request.url);
    const seg = url.pathname.replace(/^\/api\//, '').split('/').filter(Boolean).map(decodeURIComponent);
    const m = request.method;
    const hdr = request.headers.get('x-demo-user');
    const actor: DemoUserId = DEMO_USERS.some((u) => u.id === hdr) ? (hdr as DemoUserId) : 'recruiter-riya';
    const b = await this.body(request);
    const [a0, a1, a2, a3] = seg;

    // Demo controls
    if (a0 === 'demo') {
      if (m === 'POST' && a1 === 'reset' && !a2) {
        await this.reset();
        return { ok: true };
      }
      if (m === 'POST' && a1 === 'fast-forward' && a2) {
        await this.candOr404(a2);
        const n = await this.notice(a2);
        if (!n) throw new HttpError(409, 'No notice has been sent for this candidate.');
        await this.s.put(`notice:${a2}`, { ...n, dueAt: new Date(Date.now() - 60_000).toISOString() });
        await this.audit(actor, 'demo: fast-forwarded 72 h response window', a2);
        return { ok: true };
      }
    }
    if (m === 'GET' && a0 === 'analytics' && !a1) return this.analytics();
    if (m === 'GET' && a0 === 'audit' && !a1) {
      const log = (await this.s.get<AuditEntry[]>('audit')) ?? [];
      return log.slice(-100).reverse();
    }

    // Recruiter
    if (a0 === 'tests') {
      if (!a1 && m === 'GET') return this.listTests();
      if (!a1 && m === 'POST') return this.createTest(b, actor);
      if (a1 && !a2 && m === 'GET') return this.testOr404(a1);
      if (a1 && a2 === 'invites' && !a3 && m === 'POST') return this.invite(a1, b, actor);
      if (a1 && a2 === 'candidates' && !a3 && m === 'GET') return this.triage(a1);
      if (a1 && a2 === 'shortlist' && !a3 && m === 'POST') return this.shortlist(a1, b, actor);
      if (a1 && a2 === 'live' && !a3 && m === 'GET') return this.live(a1);
    }
    if (a0 === 'candidates' && a1 && a2 === 'advance' && !a3 && m === 'POST') return this.advance(a1, actor);

    // Candidate
    if (a0 === 'c' && a1) {
      const c = await this.candByToken(a1);
      if (!a2 && m === 'GET') return this.candidateView(c);
      if (a2 === 'start' && m === 'POST') return this.start(c, b);
      if (a2 === 'answer' && m === 'POST') return this.answer(c, b);
      if (a2 === 'events' && m === 'POST') return this.events(c, b);
      if (a2 === 'submit' && m === 'POST') {
        const sess = await this.session(c.id);
        if (!sess) throw new HttpError(409, 'The test has not been started.');
        if (!sess.submittedAt) await this.doSubmit(c, sess, new Date().toISOString(), 'candidate');
        return { ok: true };
      }
      if (a2 === 'report' && m === 'GET') return this.candidateReport(c);
      if (a2 === 'appeal' && m === 'POST') return this.appeal(c, b);
      if (a2 === 'respond' && m === 'POST') {
        const n = await this.notice(c.id);
        if (!n) throw new HttpError(409, 'There is no notice to respond to.');
        if (n.response) throw new HttpError(409, 'You have already responded to this notice.');
        const text = str(b.text, 'Response', 4000);
        await this.s.put(`notice:${c.id}`, { ...n, response: text, respondedAt: new Date().toISOString() });
        await this.audit('candidate', 'responded to integrity notice', c.id);
        return { ok: true };
      }
    }

    // Reviewer
    if (m === 'GET' && a0 === 'reviewer' && a1 === 'inbox' && !a2) return this.inbox();
    if (a0 === 'reports' && a1) {
      if (!a2 && m === 'GET') {
        const rep = await this.buildReport(a1);
        await this.audit(actor, 'viewed evidence', a1);
        return rep;
      }
      if (a2 === 'flags' && a3 && m === 'POST') return this.decideFlag(a1, a3, b, actor);
      if (a2 === 'notice' && !a3 && m === 'POST') return this.sendNotice(a1, actor);
      if (a2 === 'final' && !a3 && m === 'POST') return this.finalDecision(a1, b, actor);
    }
    throw new HttpError(404, 'Not found.');
  }

  // ---------- recruiter ----------
  private async listTests(): Promise<TestSummary[]> {
    const cands = await this.candidates();
    return (await this.tests()).map((test) => {
      const mine = cands.filter((c) => c.testId === test.id);
      return {
        test,
        invited: mine.length,
        submitted: mine.filter((c) => SUBMITTED.includes(c.status)).length,
        shortlisted: mine.filter((c) => c.status === 'shortlisted' || c.status === 'advanced').length,
      };
    });
  }

  private async createTest(b: Record<string, unknown>, actor: DemoUserId): Promise<Test> {
    const title = str(b.title, 'Title', 200);
    const role = str(b.role, 'Role', 200);
    const durationSec = Number(b.durationSec);
    if (!Number.isFinite(durationSec) || durationSec < 60 || durationSec > 4 * 3600) {
      throw new HttpError(400, 'Duration must be between 1 minute and 4 hours.');
    }
    const mode = b.mode === 'strict' ? 'strict' : 'standard';
    if (!Array.isArray(b.items) || b.items.length === 0) throw new HttpError(400, 'Add at least one question.');
    if (b.items.length > 100) throw new HttpError(400, 'Too many questions.');
    const items: Item[] = (b.items as unknown[]).map((raw, i) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      const id = typeof it.id === 'string' && it.id ? it.id.slice(0, 64) : `q${i + 1}`;
      const prompt = str(it.prompt, `Question ${i + 1} prompt`, 4000);
      const points = Number(it.points) > 0 ? Math.min(1000, Number(it.points)) : 10;
      if (it.kind === 'mcq') {
        const options = Array.isArray(it.options) ? it.options.map((o) => String(o)).filter((o) => o.trim()) : [];
        if (options.length < 2) throw new HttpError(400, `Question ${i + 1} needs at least 2 options.`);
        const correctIndex = Number(it.correctIndex);
        if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
          throw new HttpError(400, `Question ${i + 1} needs a valid correct option.`);
        }
        return { id, kind: 'mcq', prompt, options, correctIndex, points };
      }
      if (it.kind === 'written') {
        const rubric = Array.isArray(it.rubric) ? it.rubric.map((k) => String(k).trim()).filter(Boolean) : [];
        const minWords = Number(it.minWords) > 0 ? Math.round(Number(it.minWords)) : 50;
        return { id, kind: 'written', prompt, rubric, minWords, points };
      }
      throw new HttpError(400, `Question ${i + 1} has an unknown kind.`);
    });
    if (new Set(items.map((i) => i.id)).size !== items.length) throw new HttpError(400, 'Question ids must be unique.');
    const test: Test = {
      id: 'tst_' + rand(8), title, role, durationSec: Math.round(durationSec), mode, items,
      rulesetVersion: RULESET_VERSION, rulesetFrozen: false, createdAt: new Date().toISOString(),
    };
    const all = await this.tests();
    all.push(test);
    await this.s.put('tests', all);
    await this.audit(actor, `created test "${title}"`);
    return test;
  }

  private async invite(testId: string, b: Record<string, unknown>, actor: DemoUserId) {
    await this.testOr404(testId);
    const name = str(b.name, 'Name', 200);
    const email = str(b.email, 'Email', 320);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Email is not valid.');
    const candidate: Candidate = {
      id: 'cnd_' + rand(8), testId, name, email, token: rand(10), status: 'invited', createdAt: new Date().toISOString(),
    };
    await this.saveCandidate(candidate);
    await this.audit(actor, 'invited candidate', candidate.id);
    return { candidate, link: `/t/${candidate.token}` };
  }

  private async triage(testId: string): Promise<TriageRow[]> {
    await this.testOr404(testId);
    const rows: TriageRow[] = [];
    for (const c of (await this.candidates()).filter((x) => x.testId === testId)) {
      const r = await this.results(c.id);
      const sess = await this.session(c.id);
      rows.push({
        candidate: c,
        ...(r ? { qualityScore: r.quality.score, band: r.integrity.band } : {}),
        flagCount: r ? r.integrity.flags.filter((f) => f.status === 'confirmed').length : 0, // human-confirmed only
        ...(sess?.submittedAt ? { submittedAt: sess.submittedAt } : {}),
      });
    }
    return rows.sort((x, y) => (y.qualityScore ?? -1) - (x.qualityScore ?? -1));
  }

  /** Score-first triage. Works ONLY on the Answer Quality cutoff; never on integrity. */
  private async shortlist(testId: string, b: Record<string, unknown>, actor: DemoUserId) {
    await this.testOr404(testId);
    const cutoff = Number(b.cutoff);
    if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 100) throw new HttpError(400, 'Cutoff must be 0–100.');
    let shortlisted = 0;
    let belowCutoff = 0;
    for (const c of (await this.candidates()).filter((x) => x.testId === testId)) {
      if (!['submitted', 'shortlisted', 'below_cutoff'].includes(c.status)) continue;
      const r = await this.results(c.id);
      if (!r) continue;
      if (r.quality.score >= cutoff) {
        shortlisted++;
        const flags = r.integrity.flags.map((f): Flag =>
          f.status === 'not_used' ? { ...f, status: f.decidedAt ? f.status : 'pending' } : f);
        await this.s.put(`result:${c.id}`, { ...r, integrity: { ...r.integrity, flags } });
        await this.saveCandidate({ ...c, status: 'shortlisted' });
      } else {
        belowCutoff++;
        const flags = r.integrity.flags.map((f): Flag => ({ ...f, status: 'not_used' }));
        await this.s.put(`result:${c.id}`, { ...r, integrity: { ...r.integrity, flags } });
        await this.saveCandidate({ ...c, status: 'below_cutoff' });
      }
    }
    await this.audit(actor, `shortlisted on Answer Quality cutoff ${cutoff}: ${shortlisted} shortlisted, ${belowCutoff} below cutoff`);
    return { shortlisted, belowCutoff };
  }

  private async advance(cid: string, actor: DemoUserId) {
    const c = await this.candOr404(cid);
    if (c.status === 'advanced') return { ok: true };
    if (c.status !== 'shortlisted') throw new HttpError(409, 'Only shortlisted candidates can be advanced.');
    const r = await this.results(cid);
    const fin = await this.final(cid);
    const flags = r?.integrity.flags ?? [];
    const pending = flags.some((f) => f.status === 'pending');
    const confirmed = flags.some((f) => f.status === 'confirmed');
    const ok = r?.integrity.band === 'clear' || !!fin || (!pending && !confirmed);
    if (!ok) throw new HttpError(409, 'Integrity review pending');
    await this.saveCandidate({ ...c, status: 'advanced' });
    await this.audit(actor, 'advanced candidate to next round', cid);
    return { ok: true };
  }

  // ---------- candidate ----------
  private async start(c: Candidate, b: Record<string, unknown>): Promise<CandidateTestView> {
    const existing = await this.session(c.id);
    if (existing) return this.candidateView(c);
    if (b.ageConfirmed !== true) throw new HttpError(403, 'Candidates under 18 cannot take this assessment.');
    if (b.consent !== true) throw new HttpError(400, 'Consent is required to start the assessment.');
    const test = await this.testOr404(c.testId);
    const now = Date.now();
    const sess: Session = {
      candidateId: c.id, startedAt: new Date(now).toISOString(),
      deadline: new Date(now + test.durationSec * 1000).toISOString(),
      answers: {}, events: [{ seq: 1, t: 0, type: 'start', tier: 'T2' }],
    };
    if (typeof b.startPhoto === 'string' && b.startPhoto.startsWith('data:image/') && b.startPhoto.length <= MAX_MEDIA) {
      await this.s.put(`photo:${c.id}`, b.startPhoto);
      sess.startPhoto = `ref:photo:${c.id}`;
    }
    await this.s.put(`session:${c.id}`, sess);
    if (!test.rulesetFrozen) {
      const all = await this.tests();
      await this.s.put('tests', all.map((t) => (t.id === test.id ? { ...t, rulesetFrozen: true } : t)));
    }
    const updated: Candidate = { ...c, status: 'in_progress' };
    await this.saveCandidate(updated);
    await this.audit('candidate', 'started assessment (age 18+ and consent confirmed)', c.id);
    return this.candidateView(updated);
  }

  private async liveSession(c: Candidate): Promise<Session> {
    const sess = await this.session(c.id);
    if (!sess) throw new HttpError(409, 'The test has not been started.');
    if (sess.submittedAt) throw new HttpError(409, 'This test has already been submitted.');
    return sess;
  }

  private async answer(c: Candidate, b: Record<string, unknown>) {
    const sess = await this.liveSession(c);
    if (Date.now() > Date.parse(sess.deadline) + GRACE_MS) throw new HttpError(409, 'Time is up. Answers can no longer be saved.');
    const test = await this.testOr404(c.testId);
    const item = test.items.find((i) => i.id === b.itemId);
    if (!item) throw new HttpError(400, 'Unknown question.');
    const seq = Number(b.seq);
    if (!Number.isFinite(seq)) throw new HttpError(400, 'seq is required.');
    let value: string | number;
    if (item.kind === 'mcq') {
      const v = Number(b.value);
      if (!Number.isInteger(v) || v < 0 || v >= item.options.length) throw new HttpError(400, 'Invalid option.');
      value = v;
    } else {
      if (typeof b.value !== 'string') throw new HttpError(400, 'Answer must be text.');
      if (b.value.length > 20_000) throw new HttpError(400, 'Answer is too long.');
      value = b.value;
    }
    const prev = sess.answers[item.id];
    if (prev && prev.seq >= seq) return { ok: true as const, savedAt: prev.savedAt };
    const savedAt = new Date().toISOString();
    sess.answers[item.id] = { value, savedAt, seq };
    await this.s.put(`session:${c.id}`, sess);
    return { ok: true as const, savedAt };
  }

  private async events(c: Candidate, b: Record<string, unknown>) {
    const sess = await this.liveSession(c);
    if (!Array.isArray(b.events)) throw new HttpError(400, 'events must be an array.');
    if (b.events.length > 200) throw new HttpError(400, 'Too many events in one batch.');
    const elapsed = Date.now() - Date.parse(sess.startedAt);
    let seq = sess.events.reduce((mx, e) => Math.max(mx, e.seq), 0);
    const mediaCount = sess.events.filter((e) => e.media).length;
    let stored = 0;
    for (const raw of b.events as unknown[]) {
      const e = (raw ?? {}) as Record<string, unknown>;
      const type = e.type as EventType;
      if (!CLIENT_EVENTS.has(type)) continue; // server-only types (T1/T2, start, submit) are never accepted from clients
      const ct = Number(e.t);
      const t = Number.isFinite(ct) && ct >= 0 && ct <= elapsed + 5_000 ? Math.round(ct) : elapsed;
      const ev: IntegrityEvent = { seq: ++seq, t, type, tier: 'T3' };
      if (typeof e.itemId === 'string') ev.itemId = e.itemId.slice(0, 64);
      if (typeof e.detail === 'string') ev.detail = e.detail.slice(0, 500);
      if (typeof e.media === 'string' && e.media.startsWith('data:image/') && e.media.length <= MAX_MEDIA && mediaCount + stored < 40) {
        const key = `media:${c.id}:${ev.seq}`;
        await this.s.put(key, e.media);
        ev.media = `ref:${key}`;
        stored++;
      }
      sess.events.push(ev);
    }
    if (sess.events.length > 3000) throw new HttpError(409, 'Event limit reached for this session.');
    await this.s.put(`session:${c.id}`, sess);
    return { ok: true as const, requestSnapshot: Math.random() < 0.25 };
  }

  /** Candidate projection: own data only, no reviewer identities, no media. */
  private async candidateReport(c: Candidate): Promise<CandidateReportView> {
    const test = await this.testOr404(c.testId);
    const sess = await this.session(c.id);
    const r = await this.results(c.id);
    const notice = await this.notice(c.id);
    const fin = await this.final(c.id);
    const view: CandidateReportView = {
      candidateName: c.name,
      testTitle: test.title,
      timeline: (sess?.events ?? []).map((e) => ({ seq: e.seq, t: e.t, type: e.type, ...(e.detail ? { detail: e.detail } : {}) })),
    };
    if (sess?.submittedAt) view.submittedAt = sess.submittedAt;
    if (r && sess?.submittedAt) {
      view.quality = r.quality;
      const flags = r.integrity.flags;
      const allDecided = flags.every((f) => f.status !== 'pending');
      view.integrity = {
        band: flags.length === 0 || allDecided ? r.integrity.band : 'under_review',
        flags: flags
          .filter((f) => f.status === 'confirmed' || f.status === 'overturned' || f.status === 'not_used')
          .map((f) => ({ id: f.id, label: f.label, status: f.status, summary: f.summary, ...(f.rationale ? { rationale: f.rationale } : {}) })),
      };
    }
    if (notice) {
      const { sentBy: _sb, ...rest } = notice; // strip reviewer identity
      view.notice = rest;
    }
    const appeals = await this.s.get<Appeal[]>(`appeals:${c.id}`);
    if (appeals?.length) view.appeals = appeals;
    if (fin) view.finalDecision = { outcome: fin.outcome, rationale: fin.rationale, at: fin.at };
    return view;
  }

  /** Candidate disputes a flag. Never changes any score or band. */
  private async appeal(c: Candidate, b: Record<string, unknown>) {
    const r = await this.results(c.id);
    const flag = r?.integrity.flags.find((f) => f.id === b.flagId);
    if (!r || !flag) throw new HttpError(400, 'That flag is not on your report.');
    if (flag.status === 'not_used') throw new HttpError(400, 'This flag was not used in any decision, so it cannot be appealed.');
    const text = str(b.text, 'Appeal text', 4000);
    const appeal: Appeal = { flagId: flag.id, text, at: new Date().toISOString() };
    const list = (await this.s.get<Appeal[]>(`appeals:${c.id}`)) ?? [];
    list.push(appeal);
    await this.s.put(`appeals:${c.id}`, list);
    const sess = await this.session(c.id);
    if (sess) {
      const seq = sess.events.reduce((mx, e) => Math.max(mx, e.seq), 0) + 1;
      sess.events.push({ seq, t: Math.max(0, Date.now() - Date.parse(sess.startedAt)), type: 'appeal', tier: 'T3', detail: text });
      await this.s.put(`session:${c.id}`, sess);
    }
    await this.audit('candidate', `appealed flag ${flag.signal}`, c.id);
    return { ok: true as const, appeal };
  }

  /** Recruiter live monitor: allow-listed stills only, never a live feed. */
  private async live(testId: string): Promise<LiveSessionRow[]> {
    const test = await this.testOr404(testId);
    const now = Date.now();
    const rows: LiveSessionRow[] = [];
    for (const c of (await this.candidates()).filter((x) => x.testId === testId && x.status === 'in_progress')) {
      const sess = await this.session(c.id);
      if (!sess || sess.submittedAt || now > Date.parse(sess.deadline) + GRACE_MS) continue;
      const faceEv = [...sess.events].reverse().find((e) =>
        e.type === 'face_present' || e.type === 'face_absent' || e.type === 'multiple_faces' || e.type === 'camera_off');
      const hasCam = !!sess.startPhoto || sess.events.some((e) => e.type === 'snapshot');
      let presence: LiveSessionRow['presence'] = 'unknown';
      if (!hasCam || faceEv?.type === 'camera_off') presence = 'no_camera';
      else if (faceEv?.type === 'face_present') presence = 'present';
      else if (faceEv?.type === 'face_absent') presence = 'absent';
      else if (faceEv?.type === 'multiple_faces') presence = 'multiple';
      const stillEv = [...sess.events].reverse().find((e) => !!e.media);
      const hydrated = await this.hydrate({
        ...sess, events: stillEv ? [stillEv] : [],
      });
      const lastStill = hydrated.events[0]?.media ?? hydrated.startPhoto;
      rows.push({
        candidate: c, startedAt: sess.startedAt, deadline: sess.deadline,
        answered: Object.keys(sess.answers).length, totalItems: test.items.length, presence,
        ...(lastStill && lastStill.startsWith('data:') ? { lastStill } : {}),
        ...(stillEv && hydrated.events[0]?.media ? { lastStillAt: stillEv.t } : lastStill ? { lastStillAt: 0 } : {}),
        recentEvents: sess.events.slice(-8).map((e) => ({ seq: e.seq, t: e.t, type: e.type, ...(e.detail ? { detail: e.detail } : {}) })),
        flagsSoFar: computeIntegrity(sess).flags.length,
        serverNow: new Date(now).toISOString(),
      });
    }
    return rows;
  }

  // ---------- reviewer ----------
  private async inbox(): Promise<ReviewerInboxRow[]> {
    const tests = await this.tests();
    const rows: ReviewerInboxRow[] = [];
    for (const c of await this.candidates()) {
      if (c.status !== 'shortlisted') continue;
      const r = await this.results(c.id);
      if (!r || (r.integrity.band !== 'review' && r.integrity.band !== 'strong_concern')) continue;
      const notice = await this.notice(c.id);
      rows.push({
        candidate: c,
        testTitle: tests.find((t) => t.id === c.testId)?.title ?? '',
        qualityScore: r.quality.score,
        band: r.integrity.band,
        pendingFlags: r.integrity.flags.filter((f) => f.status === 'pending').length,
        ...(notice ? { notice } : {}),
      });
    }
    return rows.sort((x, y) => y.qualityScore - x.qualityScore);
  }

  private async decideFlag(cid: string, fid: string, b: Record<string, unknown>, actor: DemoUserId): Promise<Report> {
    this.requireReviewer(actor);
    const c = await this.candOr404(cid);
    const r = await this.results(cid);
    const flag = r?.integrity.flags.find((f) => f.id === fid);
    if (!r || !flag) throw new HttpError(404, 'Flag not found.');
    if (c.status === 'below_cutoff' || flag.status === 'not_used') {
      throw new HttpError(409, 'This candidate is below the Answer Quality cutoff; their flags are not used.');
    }
    if (c.status !== 'shortlisted' && c.status !== 'advanced') {
      throw new HttpError(409, 'Integrity is reviewed only for shortlisted candidates. Shortlist on Answer Quality first.');
    }
    if (await this.final(cid)) throw new HttpError(409, 'A final decision has already been made.');
    const action = b.action;
    if (action !== 'confirm' && action !== 'overturn') throw new HttpError(400, 'action must be confirm or overturn.');
    const rationale = typeof b.rationale === 'string' ? b.rationale.trim().slice(0, 4000) : '';
    if (action === 'confirm' && !rationale) throw new HttpError(400, 'A rationale is required to confirm a flag. The candidate will see it.');
    const updated: Flag = {
      ...flag, status: action === 'confirm' ? 'confirmed' : 'overturned',
      rationale: rationale || 'Overturned by reviewer.', decidedBy: actor, decidedAt: new Date().toISOString(),
    };
    // Only the flag changes. The quality score is never touched by an integrity decision.
    await this.s.put(`result:${cid}`, {
      ...r, integrity: { ...r.integrity, flags: r.integrity.flags.map((f) => (f.id === fid ? updated : f)) },
    });
    await this.audit(actor, `${action === 'confirm' ? 'confirmed' : 'overturned'} flag ${flag.signal}`, cid);
    return this.buildReport(cid);
  }

  private async sendNotice(cid: string, actor: DemoUserId): Promise<Report> {
    await this.candOr404(cid);
    const r = await this.results(cid);
    if (!r?.integrity.flags.some((f) => f.status === 'confirmed')) {
      throw new HttpError(409, 'A notice needs at least one confirmed flag.');
    }
    if (!(await this.notice(cid))) {
      const sent = Date.now();
      const n: Notice = { sentAt: new Date(sent).toISOString(), dueAt: new Date(sent + NOTICE_MS).toISOString(), sentBy: actor };
      await this.s.put(`notice:${cid}`, n);
      await this.audit(actor, 'sent integrity notice (72 h to respond)', cid);
    }
    return this.buildReport(cid);
  }

  private async finalDecision(cid: string, b: Record<string, unknown>, actor: DemoUserId): Promise<Report> {
    this.requireReviewer(actor);
    await this.candOr404(cid);
    if (await this.final(cid)) throw new HttpError(409, 'A final decision has already been made.');
    const r = await this.results(cid);
    const confirmed = r?.integrity.flags.filter((f) => f.status === 'confirmed') ?? [];
    if (confirmed.some((f) => f.decidedBy === actor)) {
      throw new HttpError(409, 'A different reviewer must make the final call (you confirmed a flag on this report).');
    }
    const n = await this.notice(cid);
    if (!n) throw new HttpError(409, 'Send the candidate a notice before any integrity-based decision.');
    if (!n.response && Date.parse(n.dueAt) > Date.now()) {
      throw new HttpError(409, 'The candidate still has time to respond (72 h window).');
    }
    const outcomes: FinalDecision['outcome'][] = ['uphold', 'partial', 'overturn', 'reattempt'];
    if (!outcomes.includes(b.outcome as FinalDecision['outcome'])) throw new HttpError(400, 'Invalid outcome.');
    const rationale = str(b.rationale, 'Rationale', 4000);
    const fin: FinalDecision = { by: actor, outcome: b.outcome as FinalDecision['outcome'], rationale, at: new Date().toISOString() };
    await this.s.put(`final:${cid}`, fin);
    await this.audit(actor, `final decision: ${fin.outcome}`, cid);
    return this.buildReport(cid);
  }

  private async analytics(): Promise<Analytics> {
    const cands = await this.candidates();
    const bands: Record<Band, number> = { clear: 0, review: 0, strong_concern: 0, insufficient: 0 };
    const flagOutcomes = { confirmed: 0, overturned: 0, pending: 0, not_used: 0 };
    const bySignal = new Map<string, { signal: string; label: string; confirmed: number; overturned: number }>();
    let qSum = 0;
    let qN = 0;
    for (const c of cands) {
      const r = await this.results(c.id);
      if (!r) continue;
      qSum += r.quality.score;
      qN++;
      bands[r.integrity.band]++;
      for (const f of r.integrity.flags) {
        flagOutcomes[f.status]++;
        const row = bySignal.get(f.signal) ?? { signal: f.signal, label: f.label, confirmed: 0, overturned: 0 };
        if (f.status === 'confirmed') row.confirmed++;
        if (f.status === 'overturned') row.overturned++;
        bySignal.set(f.signal, row);
      }
    }
    return {
      tests: (await this.tests()).length,
      invited: cands.length,
      submitted: cands.filter((c) => SUBMITTED.includes(c.status)).length,
      avgQuality: qN ? Math.round(qSum / qN) : 0,
      bands,
      flagOutcomes,
      overturnRateBySignal: [...bySignal.values()],
    };
  }
}
