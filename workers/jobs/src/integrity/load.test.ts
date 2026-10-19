// AT-D14 (spec d1 §5.1): the integrity stage's only access to quality data is public.quality_cards.meets_cutoff,
// and integrity/** imports no quality type. Plus the evidence loader: hash check, canonical key, gseq rules, gaps
// and the fail-closed photo check.
import { describe, expect, it } from 'vitest';
import { SQL } from './store.js';
import {
  MAX_EVENTS_BYTES,
  gapSignals,
  isPhotoMissing,
  loadSignals,
  parseEventLines,
} from './load.js';
import {
  IDS,
  MemoryEvidence,
  heartbeat,
  integrityWorld,
  ndjson,
  paste,
  tabHidden,
} from './world.test-helpers.js';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true });

describe('integrity reads meets_cutoff and nothing else of quality data (AT-D14)', () => {
  it('exactly one statement touches a quality table, and it selects meets_cutoff only', () => {
    const touching = Object.entries(SQL).filter(([, text]) =>
      /quality_cards|\bquality\./i.test(text),
    );
    expect(touching.map(([name]) => name)).toEqual(['meetsCutoff']);
    const select = /^select (.+?) from public\.quality_cards /.exec(SQL.meetsCutoff);
    expect(select?.[1]).toBe('meets_cutoff');
    // no statement reads a score, a grade or the quality schema
    for (const text of Object.values(SQL)) {
      expect(text).not.toMatch(/quality\.|\bscore\b|section_scores|quality_cutoff/);
    }
  });

  it('no integrity file imports quality code, a quality type or the vendors package', () => {
    const files = Object.entries(sources).filter(([path]) => !path.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const [path, text] of files) {
      const specifiers = [...text.matchAll(/^\s*(?:import|export)[^'"]*from\s+'([^']+)'/gm)].map(
        (m) => m[1],
      );
      for (const spec of specifiers) {
        expect(spec, path).toMatch(
          /^(\.\/[a-z.-]+\.js|@trace\/shared(\/.*)?|@trace\/band-engine(\/.*)?)$/,
        );
        expect(spec, path).not.toMatch(/quality|vendors|\.\.\//);
      }
      const imported = [...text.matchAll(/^\s*import\s+(?:type\s+)?\{([^}]*)\}/gm)].flatMap((m) =>
        (m[1] ?? '').split(',').map((s) => s.trim()),
      );
      for (const name of imported) expect(name, path).not.toMatch(/quality|score|grade/i);
    }
  });
});

describe('events.ndjson loader', () => {
  it('drops heartbeats, keeps gseq, sorts by gseq and computes server-time offsets', () => {
    const body = ndjson([paste(5, 9_000), heartbeat(1, 1_000), tabHidden(3, 4_000, 3_500)]);
    const out = parseEventLines(body, { startedAt: '2026-10-15T09:00:00.000Z', lastEventSeq: 5 });
    expect(out.map((s) => [s.seq, s.kind, s.offsetMs])).toEqual([
      [3, 'tab_hidden', 4_000],
      [5, 'paste', 9_000],
    ]);
    expect(out[0]?.event).toEqual({
      seq: 3,
      atMs: 4_000,
      kind: 'tab_hidden',
      durationMs: 3_500,
      attrs: {},
    });
    expect(out[0]?.details).toEqual({ duration_ms: 3_500 });
  });

  it('refuses a duplicate gseq, a gseq past lastEventSeq, an answer line and a malformed line', () => {
    const m = { startedAt: '2026-10-15T09:00:00.000Z', lastEventSeq: 3 };
    const bad = [
      ndjson([paste(2, 1_000), paste(2, 2_000)]),
      ndjson([paste(4, 1_000)]),
      `${JSON.stringify({ gseq: 1, streamId: IDS.streamA, t: 1, tServer: '2026-10-15T09:00:01.000Z', kind: 'answer.text', item: 1, p: 0, d: 0, i: 'x' })}\n`,
      `${JSON.stringify({ ...paste(1, 1_000), text: 'pasted words' })}\n`,
      '{not json}\n',
    ];
    for (const body of bad)
      expect(() => parseEventLines(body, m)).toThrow(/^integrity_bad_events$/);
  });

  it('numbers connectivity gaps after lastEventSeq', () => {
    const gaps = gapSignals({
      startedAt: '2026-10-15T09:00:00.000Z',
      lastEventSeq: 10,
      gaps: [
        { from: '2026-10-15T09:01:00.000Z', to: '2026-10-15T09:01:40.000Z', label: 'connectivity' },
      ],
    });
    expect(gaps).toEqual([
      expect.objectContaining({
        seq: 11,
        kind: 'connectivity_gap',
        offsetMs: 60_000,
        details: { duration_ms: 40_000 },
      }),
    ]);
  });

  it('fails closed on a missing object, an oversize object and a hash mismatch', async () => {
    const w = await integrityWorld();
    const empty = new MemoryEvidence();
    await expect(loadSignals(empty, w.message)).rejects.toThrow(/^integrity_events_missing$/);

    const big = new MemoryEvidence();
    big.put(w.message.evidence.eventsKey, 'x', {}, MAX_EVENTS_BYTES + 1);
    await expect(loadSignals(big, w.message)).rejects.toThrow(/^integrity_events_too_large$/);

    const tampered = new MemoryEvidence();
    tampered.put(w.message.evidence.eventsKey, ndjson([paste(1, 1_000), paste(2, 2_000)]));
    await expect(loadSignals(tampered, w.message)).rejects.toThrow(
      /^integrity_events_hash_mismatch$/,
    );
  });

  it('photoMissing is true unless the canonical photo exists with the mirrored sha256 and size', async () => {
    const ok = await integrityWorld();
    expect(await isPhotoMissing(ok.evidence, ok.message)).toBe(false);
    for (const photo of ['none', 'missing_object', 'other_sha'] as const) {
      const w = await integrityWorld({ photo });
      expect(await isPhotoMissing(w.evidence, w.message)).toBe(true);
    }
    const otherKey = await integrityWorld();
    const message = {
      ...otherKey.message,
      photo: {
        ...otherKey.message.photo!,
        key: `media/${IDS.org}/${IDS.otherOrg}/start_photo.jpg`,
      },
    };
    expect(await isPhotoMissing(otherKey.evidence, message)).toBe(true);
  });
});
