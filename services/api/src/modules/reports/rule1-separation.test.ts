// Rule 1 (two results, never blended) for the three report modules (spec §6.2 L-19, AT-D3). The ESLint wall
// (packages/config/test/rule1-separation.test.ts, lead-owned) runs on virtual files; this case checks the real ones:
//   - modules/reports (neutral) imports neither card module and reads no integrity table (here);
//   - report-quality and report-integrity import neither each other, nor any neutral module, nor a shared card type
//     (report-quality/rule1-separation.test.ts and report-integrity/rule1-separation.test.ts);
//   - for one cohort in every card state, no payload of the five report endpoints holds both a quality and an
//     integrity value, and no key matches overall|combined|total|trust|honesty|composite at any depth (here).
// This test file is neutral code: it may load both card routers to look at their payloads (a router wires both).
import { describe, expect, it } from 'vitest';
import { createReportIntegrityRoutes } from '../report-integrity/routes.js';
import { createReportQualityRoutes } from '../report-quality/routes.js';
import {
  baseTables,
  callerOf,
  candidateRows,
  ENV,
  fakeRest,
  keysDeep,
  merge,
  ORG,
  reportId,
  TEST,
  type Tables,
} from './reports.test-helpers.js';
import { createReportsRoutes } from './routes.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

// The trace/static-module-paths lint rule keeps a glob inside its own folder, so each card module checks its own
// files in its own rule1-separation.test.ts; this one checks the neutral module.
const neutral = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true });

const isTest = (path: string) => /\.test(-helpers)?\.ts$/.test(path);
const production = Object.fromEntries(Object.entries(neutral).filter(([path]) => !isTest(path)));

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const specifiers = (source: string) => [...source.matchAll(SPECIFIER)].map((m) => m[1] ?? '');

describe('rule 1: modules/reports stays neutral (static, real files)', () => {
  it('found the module sources', () => {
    expect(Object.keys(production).sort()).toEqual([
      './read.ts',
      './report-meta.ts',
      './results.ts',
      './routes.ts',
      './rows.ts',
    ]);
  });

  it('imports neither card module nor the band engine', () => {
    for (const [path, src] of Object.entries(production)) {
      for (const spec of specifiers(src)) {
        expect(spec, path).not.toMatch(/report-quality|report-integrity|band-engine/);
      }
    }
  });

  it('reads no integrity table and no internal schema', () => {
    for (const src of Object.values(production)) {
      expect(src).not.toMatch(/['"`]integrity_(cards|timeline_entries)['"`]/);
      expect(src).not.toMatch(/['"`](integrity|quality)\./);
    }
  });
});

describe('rule 1: no payload blends the two results (AT-D3)', () => {
  const QUALITY_VALUE = new Set([
    'score',
    'sections',
    'belowCutoff',
    'scoreHundredths',
    'graderModelId',
  ]);
  const INTEGRITY_VALUE = new Set([
    'band',
    'evidenceStrength',
    'coveragePct',
    'photoMissing',
    'reasons',
    'flags',
    'timeline',
    'signalsByFamily',
    'ruleTableVersion',
    'engineVersion',
  ]);
  const FORBIDDEN_KEY = /overall|combined|total|trust|honesty|composite/i;

  // One cohort covering every card state; the integrity rows are full table rows so a card can be `ready`.
  const cohort = (): Tables => {
    const t = merge(
      baseTables(),
      candidateRows({ n: 1, score: 72, integrity: 'reviewed' }),
      candidateRows({ n: 2, score: 15, integrity: 'not_reviewed_below_cutoff' }),
      candidateRows({ n: 3, score: null, integrity: 'awaiting_quality' }),
      candidateRows({ n: 4, score: 55 }),
    );
    for (const qc of t.quality_cards ?? []) {
      Object.assign(qc, {
        workspace_id: qc.workspace_id,
        quality_score_id: qc.id,
        section_scores: [],
        rubric_version_ids: [],
        grader_adapter_version: 'mock-1',
        computed_at: '2026-10-17T08:00:00+00:00',
      });
    }
    t.integrity_cards = (t.integrity_cards ?? []).map((c) => ({
      ...c,
      workspace_id: '33333333-3333-4333-8333-333333333333',
      test_id: TEST,
      integrity_result_id: c.id,
      ruleset_version_id: '99999999-9999-4999-8999-999999999999',
      band_rule_version_id: '99999999-9999-4999-8999-999999999998',
      engine_version: 'band-engine-1',
      band: 'review',
      evidence_strength: 0.5,
      coverage_permille: 900,
      coverage_floor_permille: 700,
      photo_missing: false,
      computed_at: '2026-10-17T08:00:00+00:00',
    }));
    t.sections = [];
    t.integrity_timeline_entries = [];
    return t;
  };

  const payloads = async () => {
    const tables = cohort();
    const { rest } = fakeRest(tables);
    const deps = { context: () => Promise.resolve({ caller: callerOf('aal2'), rest }) };
    const source = {
      select: (_r: Request, _e: Env, table: string, query: Readonly<Record<string, string>>) =>
        rest.select(table, query),
    };
    const reports = createReportsRoutes(deps);
    const qualityApp = createReportQualityRoutes(source);
    const integrityApp = createReportIntegrityRoutes(source);
    const fetchJson = async (path: string): Promise<unknown> => {
      const app = path.endsWith('/quality')
        ? qualityApp
        : path.endsWith('/integrity')
          ? integrityApp
          : reports;
      const res = await app.request(`http://api.test${path}`, {}, ENV);
      expect(res.status, path).toBe(200);
      return res.json();
    };
    const out: [string, unknown][] = [
      ['results', await fetchJson(`/v1/orgs/${ORG}/tests/${TEST}/results`)],
      ['queue', await fetchJson(`/v1/orgs/${ORG}/review/reports`)],
    ];
    for (const n of [1, 2, 3, 4]) {
      const base = `/v1/orgs/${ORG}/reports/${reportId(n)}`;
      out.push([`meta ${String(n)}`, await fetchJson(base)]);
      out.push([`quality ${String(n)}`, await fetchJson(`${base}/quality`)]);
      out.push([`integrity ${String(n)}`, await fetchJson(`${base}/integrity`)]);
    }
    return out;
  };

  it('every payload holds quality values or integrity values, never both, and no blended key', async () => {
    const all = await payloads();
    expect(all).toHaveLength(14);
    for (const [name, body] of all) {
      const keys = keysDeep(body);
      const q = keys.filter((k) => QUALITY_VALUE.has(k));
      const i = keys.filter((k) => INTEGRITY_VALUE.has(k));
      expect(q.length === 0 || i.length === 0, name).toBe(true);
      expect(
        keys.filter((k) => FORBIDDEN_KEY.test(k)),
        name,
      ).toEqual([]);
      if (name.startsWith('meta')) expect([...q, ...i], name).toEqual([]);
      if (name.startsWith('integrity')) expect(q, name).toEqual([]);
      if (name.startsWith('quality') || name === 'results' || name === 'queue') {
        expect(i, name).toEqual([]);
      }
    }
    const states = Object.fromEntries(
      all
        .filter(([n]) => n.startsWith('integrity'))
        .map(([n, b]) => [n, (b as { state: string }).state]),
    );
    expect(states).toEqual({
      'integrity 1': 'ready',
      'integrity 2': 'not_used_below_cutoff',
      'integrity 3': 'pending',
      'integrity 4': 'pending',
    });
  });
});
