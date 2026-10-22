// Synthetic fixtures for the report tests (no real person, no real address). Test use only.
import type { IntegrityCard, QualityCard, ReportMetaResponse } from '@trace/shared/contracts/d1';
import type { FetchLike } from '../api/client';

export const ORG_ID = '11111111-1111-4111-8111-111111111111';
export const REPORT_ID = '22222222-2222-4222-8222-222222222222';
export const API_ORIGIN = 'https://trace-api-staging.example-sub.workers.dev';

export const META: ReportMetaResponse = {
  report: {
    id: REPORT_ID,
    label: 'Candidate 3',
    testName: 'Synthetic backend test',
    testVersion: 2,
    submittedAt: '2026-10-19T10:00:00.000Z',
    receiptRefPrefix: 'ABCD1234',
    noticeHashPrefix: 'a1b2c3d4',
  },
  versions: {
    quality: { rubricVersion: 'rubric-v1', scoringVersion: 'scoring-v1' },
    integrity: { rulesetVersion: 'ruleset-v1' },
  },
};

export const QUALITY_READY: QualityCard = {
  state: 'ready',
  score: 78,
  sections: [
    {
      sectionId: '33333333-3333-4333-8333-333333333333',
      name: 'Multiple choice',
      weight: 40,
      scoreHundredths: 8000,
    },
    {
      sectionId: '44444444-4444-4444-8444-444444444444',
      name: 'Written answer',
      weight: 60,
      scoreHundredths: 7667,
    },
  ],
  graderModelId: 'mock-grader-v1',
  rubricVersion: 'rubric-v1',
  scoringVersion: 'scoring-v1',
};

export type ReadyIntegrity = Extract<IntegrityCard, { state: 'ready' }>;

export const INTEGRITY_READY: ReadyIntegrity = {
  state: 'ready',
  band: 'review',
  evidenceStrength: 0.62,
  coveragePct: 88,
  photoMissing: false,
  reasons: ['1 paste event matched rule D1-PASTE (client-reported, T3, can reach Review only).'],
  flags: [
    {
      ruleId: 'D1-PASTE',
      family: 'paste',
      tier: 'T3',
      atMs: 372_000,
      count: 1,
      observed: { len: 38, count: 1 },
      signalSeqs: [14],
      state: 'pending',
    },
    {
      ruleId: 'D1-UNTRUSTED-INPUT',
      family: 'input_origin',
      tier: 'T3',
      atMs: 1_872_000,
      count: 2,
      observed: { count: 2 },
      signalSeqs: [40, 41],
      state: 'pending',
    },
  ],
  timeline: [
    {
      position: 1,
      entryKind: 'flag',
      signalKind: 'paste',
      family: 'paste',
      ruleId: 'D1-PASTE',
      tier: 'T3',
      atMs: 372_000,
      count: 1,
      observed: { len: 38, count: 1 },
      flagState: 'pending',
      signalSeqs: [14],
    },
    {
      position: 2,
      entryKind: 'context',
      signalKind: 'tab_hidden',
      family: 'focus',
      ruleId: null,
      tier: null,
      atMs: 900_000,
      count: 1,
      observed: { durationMs: 4200 },
      flagState: null,
      signalSeqs: [22],
    },
    {
      position: 3,
      entryKind: 'context',
      signalKind: 'connectivity_gap',
      family: 'connectivity',
      ruleId: null,
      tier: null,
      atMs: 1_200_000,
      count: 1,
      observed: { durationMs: 8000 },
      flagState: null,
      signalSeqs: [30],
    },
    {
      position: 4,
      entryKind: 'flag',
      signalKind: 'untrusted_input',
      family: 'input_origin',
      ruleId: 'D1-UNTRUSTED-INPUT',
      tier: 'T3',
      atMs: 1_872_000,
      count: 2,
      observed: { count: 2 },
      flagState: 'pending',
      signalSeqs: [40, 41],
    },
  ],
  signalsByFamily: [
    { family: 'paste', flagCount: 1, contextCount: 0 },
    { family: 'input_origin', flagCount: 1, contextCount: 0 },
    { family: 'focus', flagCount: 0, contextCount: 1 },
    { family: 'connectivity', flagCount: 0, contextCount: 1 },
  ],
  ruleTableVersion: 'd1-v1',
  engineVersion: 'band-engine-1',
};

export const WATERMARK = {
  viewerRole: 'recruiter' as const,
  org: 'Synthetic Staffing',
  issuedAt: '2026-10-19T10:05:00.000Z',
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface RouteTable {
  meta?: () => Response | Promise<Response>;
  quality?: () => Response | Promise<Response>;
  integrity?: () => Response | Promise<Response>;
  link?: () => Response | Promise<Response>;
  media?: () => Response | Promise<Response>;
}

/** A fake fetch that answers the report endpoints from `table`, and records every URL. */
export function fakeApiFetch(table: RouteTable): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: FetchLike = (url) => {
    urls.push(url);
    const path = new URL(url).pathname;
    if (path.endsWith('/quality') && table.quality) return Promise.resolve(table.quality());
    if (path.endsWith('/integrity') && table.integrity) return Promise.resolve(table.integrity());
    if (path.endsWith('/start-photo-link') && table.link) return Promise.resolve(table.link());
    if (path.startsWith('/media/') && table.media) return Promise.resolve(table.media());
    if (/\/reports\/[^/]+$/.test(path) && table.meta) return Promise.resolve(table.meta());
    return Promise.resolve(json({ error: { code: 'not_found' } }, 404));
  };
  return { fetch: fetchImpl, urls };
}
