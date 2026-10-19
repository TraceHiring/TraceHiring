// The results, review-queue and report endpoints as the E2E slice reads them (specs/d1-demo-slice.md §6.2, L-19):
// the report is three separate GETs (header, Answer Quality, Integrity Signals), and the start photo is a single-use
// link. The shapes are hand-typed from packages/shared/src/contracts-d1.ts (e2e imports nothing from @trace/shared).
// Failures carry the step, the status and the constant code only; never a body, a link or a token.
import type { APIRequestContext } from '@playwright/test';
import { jsonOf, poll } from './http.js';

export interface OrgApi {
  api: string;
  orgId: string;
  /** Returns the caller's current access token (re-read on every call). */
  jwt: () => Promise<string>;
}

export type ResultQuality =
  { state: 'pending' } | { state: 'ready'; score: number; belowCutoff: boolean };
export interface ResultRow {
  reportId: string;
  label: string;
  submittedAt: string;
  quality: ResultQuality;
}
export interface ResultsList {
  cutoff: number;
  rows: ResultRow[];
}
export interface QueueRow extends ResultRow {
  testId: string;
  testName: string;
}
export interface ReportMeta {
  report: {
    id: string;
    label: string;
    testName: string;
    testVersion: number;
    submittedAt: string;
    receiptRefPrefix: string;
    noticeHashPrefix: string;
  };
  versions: {
    quality: { rubricVersion: string; scoringVersion: string } | null;
    integrity: { rulesetVersion: string };
  };
}
export type QualityCard =
  | { state: 'pending' }
  | {
      state: 'ready';
      score: number;
      sections: { sectionId: string; name: string; weight: number; scoreHundredths: number }[];
      graderModelId: string;
      rubricVersion: string;
      scoringVersion: string;
    };
export interface Flag {
  ruleId: string;
  family: 'paste' | 'input_origin' | 'focus';
  tier: 'T1' | 'T2' | 'T3';
  atMs: number;
  count: number;
  observed: { len?: number; durationMs?: number; count?: number };
  signalSeqs: number[];
  state: 'pending';
}
export type Band = 'clear' | 'review' | 'strong_concern' | 'insufficient_evidence';
export type IntegrityCard =
  | { state: 'pending' }
  | { state: 'not_used_below_cutoff' }
  | {
      state: 'ready';
      band: Band;
      evidenceStrength: number;
      coveragePct: number;
      photoMissing: boolean;
      reasons: string[];
      flags: Flag[];
      timeline: unknown[];
      signalsByFamily: unknown[];
      ruleTableVersion: string;
      engineVersion: string;
    };
export interface MediaLink {
  url: string;
  expiresAt: string;
  watermark: { viewerRole: string; org: string; issuedAt: string };
}

/** The band labels of apps/recruiter/src/reports/labels.ts. */
export const BAND_LABEL: Readonly<Record<Band, string>> = {
  clear: 'Clear',
  review: 'Review suggested',
  strong_concern: 'Strong concern',
  insufficient_evidence: 'Insufficient evidence',
};

/** Keys that would blend the two results or name a combined value (AT-D3); none may appear in any payload. */
export const BLENDED_KEY = /overall|combined|total|trust|honesty|composite/i;
/** Words that name a reject-type control or path (AT-D13); none may be a control on any D1 screen. */
export const REJECT_WORDS = /reject|decision|decide|confirm|overturn|appeal|notice|shortlist/i;
/**
 * The same blended-value words as whole words, for on-screen text: "Untrusted input" (the tier note of an
 * input-origin flag, §6.1) is evidence wording, not a trust score.
 */
export const BLENDED_WORD = /\b(overall|combined|total|trust|honesty|composite)\b/i;

/** Rule 7 on screen: no gaze, no IP address, no ASN, anywhere in a report's visible text. */
export const NEVER_BUILD_TEXT = /\bgaze\b|IP address|\bASN\b/i;
const NEVER_BUILD_WORDS: ReadonlySet<string> = new Set(['ip', 'asn', 'gaze']);
/** A key's words (camelCase and snake_case split, lower case): `ipAddress` is ip+address, `description` is one word. */
export const keyWords = (key: string): string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase());
/** Rule 7 on the wire: keys (any depth) with a word ip, asn or gaze; whole words only, so `zip` is not one. */
export const neverBuildKeys = (value: unknown): string[] =>
  keysDeep(value).filter((k) => keyWords(k).some((w) => NEVER_BUILD_WORDS.has(w)));
/**
 * The D1 flag families (rule table packages/band-engine/src/rules/d1-v1.json and SIGNAL_CATALOG in
 * packages/shared/src/signal-catalog.ts); `connectivity` exists only for context entries, never for a flag.
 */
export const D1_FLAG_FAMILIES: readonly string[] = ['paste', 'input_origin', 'focus'];
export const D1_CONTEXT_FAMILIES: readonly string[] = [...D1_FLAG_FAMILIES, 'connectivity'];

/** Every key of a JSON value at any depth. */
export const keysDeep = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)]);
};

export const orgClient = (request: APIRequestContext, o: OrgApi) => {
  const url = (path: string) => `${o.api}/v1/orgs/${o.orgId}${path}`;
  const get = async <T>(path: string, what: string): Promise<T> =>
    jsonOf<T>(
      await request.get(url(path), { headers: { Authorization: `Bearer ${await o.jwt()}` } }),
      200,
      what,
    );
  return {
    results: (testId: string) =>
      get<ResultsList>(`/tests/${testId}/results`, 'reading the results'),
    reviewQueue: () => get<{ reports: QueueRow[] }>('/review/reports', 'reading the review queue'),
    assignments: (testId: string) =>
      get<{ assignments: { id: string; membershipId: string; asRole: string }[] }>(
        `/tests/${testId}/assignments`,
        'reading the assignments',
      ),
    invitations: (testId: string) =>
      get<{ invitations: { id: string; label: string; status: string }[] }>(
        `/tests/${testId}/invitations`,
        'reading the invitations',
      ),
    meta: (reportId: string) => get<ReportMeta>(`/reports/${reportId}`, 'reading a report header'),
    quality: (reportId: string) =>
      get<QualityCard>(`/reports/${reportId}/quality`, 'reading a quality card'),
    integrity: (reportId: string) =>
      get<IntegrityCard>(`/reports/${reportId}/integrity`, 'reading an integrity card'),
    /** Waits until the results list has a ready quality value for `label`. */
    readyRow: (testId: string, label: string, timeoutMs: number) =>
      poll(`a quality result for ${label}`, { timeoutMs, everyMs: 1000 }, async () => {
        const list = await get<ResultsList>(`/tests/${testId}/results`, 'reading the results');
        const row = list.rows.find((r) => r.label === label);
        return row !== undefined && row.quality.state === 'ready' ? row : undefined;
      }),
  };
};
export type OrgClient = ReturnType<typeof orgClient>;
