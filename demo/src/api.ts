// Typed client for the demo Worker. Every endpoint the Worker serves is listed here.
import type {
  Analytics, AuditEntry, CandidateReportView, CandidateTestView, Candidate, DemoUserId,
  FinalDecision, IntegrityEvent, Item, Report, ReviewerInboxRow, Test, TestSummary, TriageRow,
} from './shared/types';

const USER_KEY = 'trace-demo-user';

export function getActingUser(): DemoUserId {
  try {
    return (localStorage.getItem(USER_KEY) as DemoUserId) || 'recruiter-riya';
  } catch {
    return 'recruiter-riya';
  }
}

export function setActingUser(id: DemoUserId) {
  try { localStorage.setItem(USER_KEY, id); } catch { /* ignore */ }
  window.dispatchEvent(new Event('trace-user-changed'));
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-demo-user': getActingUser() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  // Demo controls
  reset: () => call<{ ok: true }>('POST', '/demo/reset'),
  fastForward: (candidateId: string) => call<{ ok: true }>('POST', `/demo/fast-forward/${candidateId}`),
  analytics: () => call<Analytics>('GET', '/analytics'),
  audit: () => call<AuditEntry[]>('GET', '/audit'),

  // Recruiter
  listTests: () => call<TestSummary[]>('GET', '/tests'),
  createTest: (t: { title: string; role: string; durationSec: number; mode: 'standard' | 'strict'; items: Item[] }) =>
    call<Test>('POST', '/tests', t),
  getTest: (id: string) => call<Test>('GET', `/tests/${id}`),
  invite: (testId: string, c: { name: string; email: string }) =>
    call<{ candidate: Candidate; link: string }>('POST', `/tests/${testId}/invites`, c),
  triage: (testId: string) => call<TriageRow[]>('GET', `/tests/${testId}/candidates`),
  shortlist: (testId: string, cutoff: number) =>
    call<{ shortlisted: number; belowCutoff: number }>('POST', `/tests/${testId}/shortlist`, { cutoff }),
  advance: (candidateId: string) => call<{ ok: true }>('POST', `/candidates/${candidateId}/advance`),

  // Candidate (token = invite link)
  candidateView: (token: string) => call<CandidateTestView>('GET', `/c/${token}`),
  start: (token: string, b: { ageConfirmed: boolean; consent: boolean; startPhoto?: string }) =>
    call<CandidateTestView>('POST', `/c/${token}/start`, b),
  saveAnswer: (token: string, b: { itemId: string; value: string | number; seq: number }) =>
    call<{ ok: true; savedAt: string }>('POST', `/c/${token}/answer`, b),
  sendEvents: (token: string, events: Omit<IntegrityEvent, 'seq' | 'tier'>[]) =>
    call<{ ok: true; requestSnapshot: boolean }>('POST', `/c/${token}/events`, { events }),
  submit: (token: string) => call<{ ok: true }>('POST', `/c/${token}/submit`),
  candidateReport: (token: string) => call<CandidateReportView>('GET', `/c/${token}/report`),
  respond: (token: string, text: string) => call<{ ok: true }>('POST', `/c/${token}/respond`, { text }),

  // Reviewer
  inbox: () => call<ReviewerInboxRow[]>('GET', '/reviewer/inbox'),
  report: (candidateId: string) => call<Report>('GET', `/reports/${candidateId}`),
  decideFlag: (candidateId: string, flagId: string, b: { action: 'confirm' | 'overturn'; rationale: string }) =>
    call<Report>('POST', `/reports/${candidateId}/flags/${flagId}`, b),
  sendNotice: (candidateId: string) => call<Report>('POST', `/reports/${candidateId}/notice`),
  finalDecision: (candidateId: string, b: { outcome: FinalDecision['outcome']; rationale: string }) =>
    call<Report>('POST', `/reports/${candidateId}/final`, b),
};
