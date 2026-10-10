// Shared contract between the demo Worker (worker/) and the React app (src/).
// Synthetic data only. Answer Quality and Integrity are separate results and are never combined.

export type Band = 'clear' | 'review' | 'strong_concern' | 'insufficient';
export type Tier = 'T1' | 'T2' | 'T3';
export type DemoUserId = 'recruiter-riya' | 'reviewer-arjun' | 'reviewer-meera';

export const DEMO_USERS: { id: DemoUserId; name: string; role: 'recruiter' | 'reviewer' }[] = [
  { id: 'recruiter-riya', name: 'Riya (Recruiter)', role: 'recruiter' },
  { id: 'reviewer-arjun', name: 'Arjun (Reviewer)', role: 'reviewer' },
  { id: 'reviewer-meera', name: 'Meera (Reviewer)', role: 'reviewer' },
];

export const RULESET_VERSION = 'rs-2026.10-demo.1';
export const GRADER_VERSION = 'mock-grader-v1';

export interface McqItem {
  id: string;
  kind: 'mcq';
  prompt: string;
  options: string[];
  correctIndex?: number; // stripped from candidate payloads
  points: number;
}

export interface WrittenItem {
  id: string;
  kind: 'written';
  prompt: string;
  rubric?: string[]; // keywords the mock grader looks for; stripped from candidate payloads
  minWords: number;
  points: number;
}

export type Item = McqItem | WrittenItem;

export interface Test {
  id: string;
  title: string;
  role: string;
  durationSec: number;
  mode: 'standard' | 'strict';
  items: Item[];
  rulesetVersion: string;
  rulesetFrozen: boolean; // true once the first candidate starts
  createdAt: string;
}

export type CandidateStatus =
  | 'invited'
  | 'in_progress'
  | 'submitted'
  | 'shortlisted'
  | 'below_cutoff' // NOT rejected on integrity: only on Answer Quality cutoff
  | 'advanced';

export interface Candidate {
  id: string;
  testId: string;
  name: string; // synthetic
  email: string; // synthetic
  token: string; // invite link token
  status: CandidateStatus;
  createdAt: string;
}

export type EventType =
  | 'start'
  | 'tab_hidden'
  | 'tab_visible'
  | 'window_blur'
  | 'fullscreen_exit'
  | 'fullscreen_enter'
  | 'paste'
  | 'copy_question'
  | 'untrusted_input'
  | 'burst_after_return'
  | 'snapshot' // server-requested random still
  | 'camera_off'
  | 'diary' // candidate's own note ("my internet dropped")
  | 'answer_saved'
  | 'submit'
  | 'shared_wrong_answers' // T1, computed server-side
  | 'grader_injection' // T2, computed by grader guard
  | 'face_absent' // on-device face check: no face for N seconds (detail: seconds)
  | 'multiple_faces' // on-device face check: 2+ faces (media: still around the event)
  | 'face_present' // face back in frame
  | 'mic_speech' // context only, never a flag (Strict mode only)
  | 'appeal'; // candidate disputes a flag (detail: text)

export interface IntegrityEvent {
  seq: number;
  t: number; // ms since session start (server-adjusted)
  type: EventType;
  tier: Tier;
  itemId?: string;
  detail?: string;
  media?: string; // small JPEG data URL (allow-listed stills only)
}

export type FlagStatus = 'pending' | 'confirmed' | 'overturned' | 'not_used';

export interface Flag {
  id: string;
  signal: string; // e.g. 'paste_external'
  label: string; // human readable
  tier: Tier;
  capsAtReview: boolean;
  status: FlagStatus;
  evidenceSeqs: number[];
  summary: string;
  rationale?: string; // required to confirm; candidate sees it
  decidedBy?: DemoUserId;
  decidedAt?: string;
}

export interface QualityResult {
  score: number; // 0-100
  perItem: { itemId: string; score: number; max: number; feedback: string }[];
  graderVersion: string;
}

export interface IntegrityResult {
  band: Band;
  rulesetVersion: string;
  coverage: number; // 0-1
  reasons: string[];
  flags: Flag[];
}

export interface Notice {
  sentAt: string;
  dueAt: string; // sentAt + 72h
  sentBy: DemoUserId;
  response?: string;
  respondedAt?: string;
}

export interface FinalDecision {
  by: DemoUserId;
  outcome: 'uphold' | 'partial' | 'overturn' | 'reattempt';
  rationale: string;
  at: string;
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  candidateId?: string;
}

export interface Session {
  candidateId: string;
  startedAt: string;
  deadline: string;
  submittedAt?: string;
  answers: Record<string, { value: string | number; savedAt: string; seq: number }>;
  startPhoto?: string;
  events: IntegrityEvent[];
}

/** Recruiter/reviewer report. Two results, side by side, never blended. */
export interface Report {
  candidate: Candidate;
  test: Test;
  session?: Session;
  quality?: QualityResult;
  integrity?: IntegrityResult;
  notice?: Notice;
  finalDecision?: FinalDecision;
  appeals?: Appeal[];
}

/** Triage row: quality score and band shown in separate columns. */
export interface TriageRow {
  candidate: Candidate;
  qualityScore?: number;
  band?: Band;
  flagCount: number;
  submittedAt?: string;
}

export interface TestSummary {
  test: Test;
  invited: number;
  submitted: number;
  shortlisted: number;
}

/** Candidate-facing projection: own data only. */
export interface CandidateTestView {
  candidateName: string;
  test: Omit<Test, 'items'> & { items: Item[] }; // items without answer keys
  status: CandidateStatus;
  session?: { startedAt: string; deadline: string; submittedAt?: string; answers: Session['answers'] };
  serverNow: string;
}

export interface CandidateReportView {
  candidateName: string;
  testTitle: string;
  submittedAt?: string;
  quality?: QualityResult;
  integrity?: { band: Band | 'under_review'; flags: Pick<Flag, 'id' | 'label' | 'status' | 'rationale' | 'summary'>[] };
  notice?: Omit<Notice, 'sentBy'>; // reviewer identity never reaches the candidate
  finalDecision?: Pick<FinalDecision, 'outcome' | 'rationale' | 'at'>;
  appeals?: Appeal[];
  timeline: Pick<IntegrityEvent, 'seq' | 't' | 'type' | 'detail'>[];
}

export interface ReviewerInboxRow {
  candidate: Candidate;
  testTitle: string;
  qualityScore: number;
  band: Band;
  pendingFlags: number;
  notice?: Notice;
}

export interface Analytics {
  tests: number;
  invited: number;
  submitted: number;
  avgQuality: number;
  bands: Record<Band, number>;
  flagOutcomes: { confirmed: number; overturned: number; pending: number; not_used: number };
  overturnRateBySignal: { signal: string; label: string; confirmed: number; overturned: number }[];
}

/** Candidate dispute of a flag ("I was wrongly flagged"). Visible to reviewers; never changes any score. */
export interface Appeal {
  flagId: string;
  text: string;
  at: string;
}

/** Recruiter live monitor row. Shows only allow-listed stills, never a live camera feed. */
export interface LiveSessionRow {
  candidate: Candidate;
  startedAt: string;
  deadline: string;
  answered: number;
  totalItems: number;
  presence: 'present' | 'absent' | 'multiple' | 'no_camera' | 'unknown';
  lastStill?: string;
  lastStillAt?: number;
  recentEvents: Pick<IntegrityEvent, 'seq' | 't' | 'type' | 'detail'>[];
  flagsSoFar: number;
  serverNow: string;
}
