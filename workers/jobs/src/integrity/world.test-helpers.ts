// A synthetic mirrored session for the integrity tests: the public rows the mirror leaves, the org's seeded rule
// table (d1-v1), an in-memory evidence bucket with events.ndjson and the start photo, and the matching mirror message.
// Synthetic data only. Of quality data it can add one row with meets_cutoff (the only field the stage may read).
import rules from '@trace/band-engine/rules/d1-v1.json';
import type { EvidenceEventLine, SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import type { EvidenceHead, EvidenceObject, EvidenceReader } from '@trace/shared/jobs';
import { newDb, table, type FakeDb } from './fake-db.test-helpers.js';
import { sha256HexBytes } from './load.js';

/** The seeded rule table d1-v1 (the same JSON the migration seeds per org). */
export const D1_RULES = rules;

const id = (n: number): string =>
  `8f3d2b6a-1c9e-4a7f-b5d3-7e2c9a${(0x41b0 + n).toString(16).padStart(6, '0')}`;

export const IDS = {
  org: id(1),
  otherOrg: id(2),
  session: id(3),
  ruleset: id(4),
  bandRules: id(5),
  report: id(6),
  streamA: id(7),
  streamB: id(8),
  invitation: id(9),
  testVersion: id(10),
  consent: id(11),
} as const;

export const STARTED_AT = '2026-10-15T09:00:00.000Z';
const START_MS = Date.parse(STARTED_AT);
export const at = (offsetMs: number): string => new Date(START_MS + offsetMs).toISOString();

export const PHOTO_SHA = 'f'.repeat(64);
export const PHOTO_BYTES = 4096;

const enc = new TextEncoder();

export class MemoryEvidence implements EvidenceReader {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; meta: Record<string, string>; size?: number }
  >();
  gets = 0;
  put(
    key: string,
    body: string | Uint8Array,
    meta: Record<string, string> = {},
    size?: number,
  ): void {
    const bytes = typeof body === 'string' ? enc.encode(body) : body;
    this.objects.set(key, size === undefined ? { bytes, meta } : { bytes, meta, size });
  }
  get(key: string): Promise<EvidenceObject | null> {
    this.gets += 1;
    const o = this.objects.get(key);
    if (o === undefined) return Promise.resolve(null);
    return Promise.resolve({
      size: o.size ?? o.bytes.byteLength,
      customMetadata: o.meta,
      text: () => Promise.resolve(new TextDecoder().decode(o.bytes)),
      arrayBuffer: () => Promise.resolve(o.bytes.slice().buffer),
    });
  }
  head(key: string): Promise<EvidenceHead | null> {
    const o = this.objects.get(key);
    return Promise.resolve(
      o === undefined ? null : { size: o.size ?? o.bytes.byteLength, customMetadata: o.meta },
    );
  }
}

type Line = EvidenceEventLine;
const env = (gseq: number, offsetMs: number, streamId: string = IDS.streamA) => ({
  gseq,
  streamId,
  t: offsetMs,
  tServer: at(offsetMs),
});
export const heartbeat = (gseq: number, offsetMs: number, streamId?: string): Line => ({
  ...env(gseq, offsetMs, streamId),
  kind: 'heartbeat',
});
export const paste = (gseq: number, offsetMs: number, streamId?: string, len = 42): Line => ({
  ...env(gseq, offsetMs, streamId),
  kind: 'signal',
  sig: 'paste',
  item: 1,
  len,
});
export const untrusted = (gseq: number, offsetMs: number): Line => ({
  ...env(gseq, offsetMs),
  kind: 'signal',
  sig: 'untrusted_input',
  item: 2,
  via: 'keydown',
  count: 3,
});
export const tabHidden = (gseq: number, offsetMs: number, ms = 5000): Line => ({
  ...env(gseq, offsetMs),
  kind: 'signal',
  sig: 'tab_hidden',
  item: null,
  ms,
});
export const fullscreenExit = (gseq: number, offsetMs: number): Line => ({
  ...env(gseq, offsetMs),
  kind: 'signal',
  sig: 'fullscreen_exit',
  item: null,
});

export const ndjson = (lines: readonly Line[]): string =>
  lines.map((l) => `${JSON.stringify(l)}\n`).join('');

export interface IntegrityWorldOptions {
  lines?: readonly Line[];
  /** null: no quality card yet; otherwise its meets_cutoff. */
  meetsCutoff?: boolean | null;
  coverage?: { activeMs: number; coveredMs: number };
  photo?: 'ok' | 'none' | 'missing_object' | 'other_sha';
  gaps?: SessionMirrorMessage['gaps'];
  lastEventSeq?: number;
}

export interface IntegrityWorld {
  db: FakeDb;
  evidence: MemoryEvidence;
  message: SessionMirrorMessage;
}

export const integrityWorld = async (opts: IntegrityWorldOptions = {}): Promise<IntegrityWorld> => {
  const db = newDb();
  const org = IDS.org;
  table(db, 'sessions').push({
    org_id: org,
    id: IDS.session,
    ruleset_version_id: IDS.ruleset,
    state: 'submitted',
  });
  table(db, 'ruleset_versions').push({
    org_id: org,
    id: IDS.ruleset,
    band_rule_version_id: IDS.bandRules,
  });
  table(db, 'band_rule_versions').push({
    org_id: org,
    id: IDS.bandRules,
    version_no: 1,
    families: rules.families,
    coverage_floor_permille: rules.coverageFloorPermille,
    coverage_photo_missing_factor_permille: rules.coveragePhotoMissingFactorPermille,
    rules: rules.rules,
  });
  table(db, 'reports').push({
    org_id: org,
    id: IDS.report,
    session_id: IDS.session,
    quality_card_id: null,
    integrity_card_id: null,
  });
  const meets = opts.meetsCutoff === undefined ? true : opts.meetsCutoff;
  if (meets !== null) addQualityCard(db, meets);

  const lines = opts.lines ?? [heartbeat(1, 10_000), paste(2, 20_000), heartbeat(3, 30_000)];
  const body = ndjson(lines);
  const evidence = new MemoryEvidence();
  const eventsKey = `sessions/${org}/${IDS.session}/events.ndjson`;
  evidence.put(eventsKey, body);
  const photoKey = `media/${org}/${IDS.session}/start_photo.jpg`;
  const photo = opts.photo ?? 'ok';
  if (photo === 'ok')
    evidence.put(photoKey, new Uint8Array(PHOTO_BYTES), { sha256: PHOTO_SHA, blurred: '1' });
  if (photo === 'other_sha') {
    evidence.put(photoKey, new Uint8Array(PHOTO_BYTES), { sha256: 'a'.repeat(64), blurred: '1' });
  }
  const maxSeq = lines.reduce((m, l) => Math.max(m, l.gseq), 0);
  const message: SessionMirrorMessage = {
    v: 1,
    jobKind: 'session_mirror',
    mirrorSeq: 1,
    jobKey: `${IDS.session}:session_mirror:${IDS.ruleset}`,
    sessionId: IDS.session,
    orgId: org,
    invitationId: IDS.invitation,
    testVersionId: IDS.testVersion,
    rulesetVersionId: IDS.ruleset,
    consentId: IDS.consent,
    state: 'submitted',
    receiptRef: 'ABCD2345',
    startedAt: STARTED_AT,
    deadlineAt: '2026-10-15T10:00:00.000Z',
    submittedAt: '2026-10-15T09:30:00.000Z',
    lastEventSeq: opts.lastEventSeq ?? maxSeq,
    streamCount: 1,
    resumeCount: 0,
    served: [],
    evidence: {
      finalKey: `sessions/${org}/${IDS.session}/final.json`,
      finalSha256: 'e'.repeat(64),
      eventsKey,
      eventsSha256: await sha256HexBytes(enc.encode(body).buffer as ArrayBuffer),
    },
    replay: 'ok',
    signalCatalogVersion: 'd1-signals-v1',
    coverage: opts.coverage ?? { activeMs: 1_800_000, coveredMs: 1_800_000 },
    gaps: opts.gaps ?? [],
    photo:
      photo === 'none'
        ? null
        : {
            key: photoKey,
            sha256: PHOTO_SHA,
            bytes: PHOTO_BYTES,
            mime: 'image/jpeg',
            blurredOnDevice: true,
          },
    photoSkippedReason: photo === 'none' ? 'declined' : null,
  };
  return { db, evidence, message };
};

/** The quality card as the integrity side can see it: org, session and meets_cutoff (column grant). */
export const addQualityCard = (db: FakeDb, meetsCutoff: boolean): void => {
  table(db, 'quality_cards').push({
    org_id: IDS.org,
    session_id: IDS.session,
    meets_cutoff: meetsCutoff,
  });
};
