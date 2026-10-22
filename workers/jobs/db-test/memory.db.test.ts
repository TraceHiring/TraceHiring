// C1b re-review note 4: the memory of the integrity stage's in-memory part on the largest events.ndjson a session can
// leave (the 20 MB per-session cap). Measured in Node (V8, like workerd) on the same code path the stage runs:
// get -> arrayBuffer -> SHA-256 -> decode -> line parse -> band engine -> flag and timeline rows -> the signals
// insert parameter. No database. Numbers are printed (sizes only) and bounded well below the 128 MB isolate limit.
// Run with --expose-gc (NODE_OPTIONS) for exact baselines; without it the figures include uncollected garbage and
// are upper bounds.
import v8 from 'node:v8';
import { describe, expect, it } from 'vitest';
import { callBand, flagRows, ruleTableOf, timelineRows } from '../src/integrity/band-call.js';
import {
  MAX_EVENTS_BYTES,
  MAX_EVENT_LINES,
  loadSignals,
  sha256HexBytes,
} from '../src/integrity/load.js';
import {
  D1_RULES as rules,
  MemoryEvidence,
  heartbeat,
  paste,
  tabHidden,
} from '../src/integrity/world.test-helpers.js';
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';

const MB = 1024 * 1024;
const gc = (globalThis as { gc?: () => void }).gc;
const used = (): number => {
  const m = process.memoryUsage();
  return m.heapUsed + m.external + m.arrayBuffers;
};

const ORG = '7c2e9a41-5b8d-4f36-a1e7-3d9b6c2f8e10';
const SESSION = '7c2e9a41-5b8d-4f36-a1e7-3d9b6c2f8e11';
const RULESET = '7c2e9a41-5b8d-4f36-a1e7-3d9b6c2f8e12';

/** NDJSON text up to `maxBytes` from a line generator (gseq from 1). */
const build = (
  maxBytes: number,
  maxLines: number,
  line: (gseq: number) => string,
): { text: string; lines: number } => {
  const parts: string[] = [];
  let size = 0;
  let n = 0;
  while (n < maxLines) {
    const l = `${line(n + 1)}\n`;
    if (size + l.length > maxBytes) break;
    parts.push(l);
    size += l.length;
    n += 1;
  }
  return { text: parts.join(''), lines: n };
};

const measure = async (label: string, text: string, lines: number) => {
  const bytes = new TextEncoder().encode(text);
  const evidence = new MemoryEvidence();
  const key = `sessions/${ORG}/${SESSION}/events.ndjson`;
  evidence.put(key, bytes);
  const message = {
    v: 1,
    jobKind: 'session_mirror',
    mirrorSeq: 1,
    jobKey: `${SESSION}:session_mirror:${RULESET}`,
    sessionId: SESSION,
    orgId: ORG,
    invitationId: SESSION,
    testVersionId: SESSION,
    rulesetVersionId: RULESET,
    consentId: SESSION,
    state: 'submitted',
    receiptRef: 'ABCD2345',
    startedAt: '2026-10-15T09:00:00.000Z',
    deadlineAt: '2026-10-15T11:00:00.000Z',
    submittedAt: '2026-10-15T11:00:00.000Z',
    lastEventSeq: lines,
    streamCount: 1,
    resumeCount: 0,
    served: [],
    evidence: {
      finalKey: `sessions/${ORG}/${SESSION}/final.json`,
      finalSha256: '0'.repeat(64),
      eventsKey: key,
      eventsSha256: await sha256HexBytes(bytes.buffer as ArrayBuffer),
    },
    replay: 'ok',
    signalCatalogVersion: 'd1-signals-v1',
    coverage: { activeMs: 7_200_000, coveredMs: 7_000_000 },
    gaps: [],
    photo: null,
    photoSkippedReason: 'declined',
  } satisfies SessionMirrorMessage;
  const table = ruleTableOf({
    id: RULESET,
    version_no: 1,
    families: JSON.stringify(rules.families),
    coverage_floor_permille: rules.coverageFloorPermille,
    coverage_photo_missing_factor_permille: rules.coveragePhotoMissingFactorPermille,
    rules: JSON.stringify(rules.rules),
  });

  gc?.();
  const rssBefore = process.resourceUsage().maxRSS;
  const heapBefore = process.memoryUsage().heapUsed;
  const base = used();
  const t0 = performance.now();
  const signals = await loadSignals(evidence, message);
  const afterLoad = used() - base;
  const band = await callBand(table, signals, message.coverage, message.signalCatalogVersion, true);
  const flags = flagRows(table, band.output);
  const timeline = timelineRows(band.output, signals);
  const param = JSON.stringify(
    signals.map((s) => ({
      seq: s.seq,
      kind: s.kind,
      offset_ms: s.offsetMs,
      item_position: s.itemPosition,
      details: s.details,
    })),
  );
  const peak = used() - base;
  const ms = Math.round(performance.now() - t0);
  gc?.();
  const retained = used() - base;
  const report = {
    label,
    fileMB: +(bytes.byteLength / MB).toFixed(1),
    lines,
    signals: signals.length,
    flags: flags.length,
    timeline: timeline.length,
    paramMB: +(param.length / MB).toFixed(1),
    afterLoadMB: +(afterLoad / MB).toFixed(1),
    peakMB: +(peak / MB).toFixed(1),
    retainedMB: +(retained / MB).toFixed(1),
    ms,
    heapBeforeMB: +(heapBefore / MB).toFixed(1),
    maxRssBeforeMB: +(rssBefore / 1024).toFixed(1),
    maxRssAfterMB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
    oldSpaceLimitMB: +(v8.getHeapStatistics().heap_size_limit / MB).toFixed(0),
    exactGc: gc !== undefined,
  };
  console.info(JSON.stringify(report));
  return report;
};

describe('integrity stage memory on the largest events.ndjson (C1b note 4)', () => {
  it('a 20 MB file is read and hash-checked, then refused past the 50 000-line DO cap', async () => {
    const { text, lines } = build(MAX_EVENTS_BYTES, Number.MAX_SAFE_INTEGER, (g) =>
      JSON.stringify(paste(g, g * 40, undefined, 12)),
    );
    expect(text.length).toBeGreaterThan(19.5 * MB);
    await expect(measure('paste-20MB', text, lines)).rejects.toThrow(
      /^integrity_events_too_large$/,
    );
  });

  it('worst accepted file: 50 000 paste lines, every line a signal', async () => {
    const { text, lines } = build(MAX_EVENTS_BYTES, MAX_EVENT_LINES, (g) =>
      JSON.stringify(paste(g, g * 40, undefined, 12)),
    );
    const r = await measure('paste-50k', text, lines);
    expect(r.signals).toBe(MAX_EVENT_LINES);
    expect(r.peakMB).toBeLessThan(96);
  });

  it('50 000 mixed lines: heartbeats and tab_hidden', async () => {
    const { text, lines } = build(MAX_EVENTS_BYTES, MAX_EVENT_LINES, (g) =>
      JSON.stringify(g % 2 === 0 ? heartbeat(g, g * 100) : tabHidden(g, g * 100, 4_000)),
    );
    const r = await measure('mixed-50k', text, lines);
    expect(r.peakMB).toBeLessThan(96);
  });
});
