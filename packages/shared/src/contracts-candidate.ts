// D1 candidate wire contracts (specs/d1-demo-slice.md §4.2-§4.6). Every object schema is strict: an unknown key fails.
// Nothing here can carry a score, band, outcome, answer key or another person's data (CLAUDE.md rules 1, 5, 7).
import { z } from 'zod';
import { SIGNAL_CATALOG } from './signal-catalog.js';

const Uuid = z.uuid();
/** skill_taxonomy.skill_key, as contracts-m1's SkillKey (kept local: the candidate path imports no org contract). */
const SkillKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
const Time = z.iso.datetime();
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const Position = z.int().min(1);
/** Option ids are short author-chosen strings (item_versions.options, 1..64 chars). */
const OptionId = z.string().min(1).max(64);
/** A compact JWS (three base64url parts). Format only: signature and claims are verified elsewhere. */
const Jws = z
  .string()
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
/** 32 random bytes, base64url (§4.3). The raw link token travels only in a request body. */
export const LinkToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const OtpCode = z.string().regex(/^[0-9]{6}$/);
const Nonce = z.string().min(16).max(128);

/** Ids the candidate routes discard before validation: ids come from verified claims only (§4.2, AT-D11(b)). */
export const IDENTITY_KEYS = ['invitationId', 'sessionId', 'orgId', 'candidateId'] as const;

/** Drops the identity keys from a request body's top level. Schemas then stay strict and have no identity key. */
export function discardIdentityKeys(input: unknown): unknown {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return input;
  const copy: Record<string, unknown> = { ...(input as Record<string, unknown>) };
  for (const key of IDENTITY_KEYS) delete copy[key];
  return copy;
}

// public.invitation_status (migration 2), as the link-holder may see it.
export const InvitationState = z.enum([
  'created',
  'sent',
  'otp_verified',
  'started',
  'submitted',
  'expired',
  'revoked',
  'blocked_age',
]);
export const SessionState = z.enum(['in_progress', 'submitted', 'auto_submitted']);
export const PhotoSkippedReason = z.enum(['camera_denied', 'no_camera', 'declined']);
export const LobbyNext = z.enum(['age', 'consent', 'photo', 'start']);
const ItemKind = z.enum(['mcq', 'written']);

/** Always exactly this; the receipt never carries a score or band (D1-11, rule 5). */
export const Receipt = z.strictObject({
  receiptRef: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/),
  submittedAt: Time,
});
export type Receipt = z.infer<typeof Receipt>;

export const OkRes = z.strictObject({ ok: z.literal(true) });

// ---- Link, OTP, lobby ------------------------------------------------------------------------------------------

export const InviteResolveReq = z.strictObject({ token: LinkToken });
export const InviteResolveRes = z.strictObject({
  state: InvitationState,
  title: z.string().min(1).max(200).optional(),
  durationMinutes: z.int().min(1).max(120).optional(),
});
export type InviteResolveRes = z.infer<typeof InviteResolveRes>;

export const OtpRequestReq = z.strictObject({ token: LinkToken });
export const OtpRequestRes = z.strictObject({
  resendAfterSeconds: z.int().min(0).max(3600),
  expiresInSeconds: z.int().min(1).max(3600),
  channel: z.literal('email'),
});

export const OtpVerifyReq = z.strictObject({ token: LinkToken, code: OtpCode });
export const OtpVerifyRes = z.strictObject({ lobbyToken: Jws, expiresAt: Time, next: LobbyNext });

export const AgeDeclareReq = z.strictObject({ adult: z.boolean() });

export const NoticeRes = z.strictObject({
  noticeVersionId: Uuid,
  language: z.literal('en'),
  bodyText: z.string().min(1).max(20000),
  renderedSha256: Sha256Hex,
});
export const ConsentReq = z.strictObject({
  noticeVersionId: Uuid,
  renderedSha256: Sha256Hex,
  accepted: z.literal(true),
});

/** The edge also enforces the 512 000-byte cap before parsing (§4.5). */
export const PhotoRes = z.strictObject({ sha256: Sha256Hex, bytes: z.int().min(1).max(512000) });

// ---- Session start, view, items ---------------------------------------------------------------------------------

const PhotoChoice = z.union([
  z.strictObject({ sha256: Sha256Hex }),
  z.strictObject({ skippedReason: PhotoSkippedReason }),
]);
export const SessionStartReq = z.strictObject({
  rulesAcknowledged: z.literal(true),
  photo: PhotoChoice,
});

const McqOptions = z
  .array(z.strictObject({ id: OptionId, label: z.string().min(1).max(500) }))
  .min(2)
  .max(6);

/**
 * Text Postgres can store in jsonb: no U+0000 and no lone UTF-16 surrogate (R2 security review #2). Such text
 * would make the mirror fail on every attempt, so a candidate could keep their own session out of every result.
 */
export const isStorableText = (s: string): boolean =>
  !s.includes('\u0000') &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

/** A bounded candidate text that is storable; the refusal message never echoes the text. */
const StorableText = (max: number) =>
  z.string().max(max).refine(isStorableText, { message: 'unstorable_text' });

/** One served item. `options` iff mcq; `maxChars` only on written items. No answer key exists in this schema. */
export const ServedItem = z
  .strictObject({
    position: Position,
    kind: ItemKind,
    sectionId: Uuid,
    prompt: z.string().min(1).max(4000),
    options: McqOptions.optional(),
    maxChars: z.int().min(1).max(10000).optional(),
    servedAt: Time,
  })
  .refine(
    (item) =>
      item.kind === 'mcq'
        ? item.options !== undefined && item.maxChars === undefined
        : item.options === undefined,
    {
      message: 'options belong to mcq items only',
    },
  );
export type ServedItem = z.infer<typeof ServedItem>;

export const SessionView = z.strictObject({
  sessionId: Uuid,
  state: SessionState,
  serverNow: Time,
  startedAt: Time,
  deadlineAt: Time,
  streamId: Uuid,
  heartbeatSeconds: z.literal(10),
  pasteBlocked: z.boolean(),
  title: z.string().min(1).max(200),
  sections: z
    .array(z.strictObject({ id: Uuid, title: z.string().min(1).max(120), position: Position }))
    .min(1)
    .max(10),
  items: z
    .array(
      z.strictObject({
        position: Position,
        sectionId: Uuid,
        kind: ItemKind,
        servedAt: Time.nullable(),
      }),
    )
    .min(1)
    .max(100),
  // An unanswered item has no entry; clearing an MCQ choice removes it.
  answers: z
    .array(
      z.union([
        z.strictObject({ position: Position, text: StorableText(100000) }),
        z.strictObject({ position: Position, choice: OptionId }),
      ]),
    )
    .max(100),
  receipt: Receipt.optional(),
});
export type SessionView = z.infer<typeof SessionView>;

export const SessionStartRes = z.union([
  z.strictObject({ sessionToken: Jws, expiresAt: Time, view: SessionView }),
  z.strictObject({ state: z.literal('submitted'), receipt: Receipt }),
]);
export const SessionAttachRes = z.strictObject({ view: SessionView });

// ---- Events ----------------------------------------------------------------------------------------------------

// Client-reported browser facts (§4.6): metadata only. No pasted, dropped or typed text, no clipboard content, no
// file names. `item` is the item position shown, or null. The client sends neither tier nor validated.
const SignalItem = Position.nullable();
const Count = z.int().min(0).max(10_000_000);

/** The five §4.6 signal shapes around an envelope. One definition feeds both the wire event and the R2 file line. */
const signalVariants = <Envelope extends z.ZodRawShape>(envelope: Envelope) =>
  [
    z.strictObject({
      ...envelope,
      kind: z.literal('signal'),
      sig: z.literal('paste'),
      item: SignalItem,
      len: Count,
    }),
    z.strictObject({
      ...envelope,
      kind: z.literal('signal'),
      sig: z.literal('drop'),
      item: SignalItem,
      len: Count,
      dt: z.enum(['text', 'files', 'other']),
    }),
    z.strictObject({
      ...envelope,
      kind: z.literal('signal'),
      sig: z.literal('untrusted_input'),
      item: SignalItem,
      via: z.enum(['keydown', 'beforeinput', 'input']),
      count: Position,
    }),
    z.strictObject({
      ...envelope,
      kind: z.literal('signal'),
      sig: z.literal('tab_hidden'),
      item: SignalItem,
      ms: Count,
    }),
    z.strictObject({
      ...envelope,
      kind: z.literal('signal'),
      sig: z.literal('fullscreen_exit'),
      item: SignalItem,
    }),
  ] as const;

export const ClientSignal = z.discriminatedUnion(
  'sig',
  signalVariants({ seq: Position, t: z.int().min(0) }),
);
export type ClientSignal = z.infer<typeof ClientSignal>;

/** Envelope: `seq` is the stream's own counter (from 1), `t` the client's monotonic offset in ms (T3 context). */
export const ClientEvent = z.discriminatedUnion('kind', [
  z.strictObject({
    seq: Position,
    t: z.int().min(0),
    kind: z.literal('answer.text'),
    item: Position,
    p: z.int().min(0),
    d: z.int().min(0),
    i: StorableText(10000),
    len: z.int().min(0).optional(),
  }),
  z.strictObject({
    seq: Position,
    t: z.int().min(0),
    kind: z.literal('answer.choice'),
    item: Position,
    option: OptionId.nullable(),
  }),
  ClientSignal,
  z.strictObject({ seq: Position, t: z.int().min(0), kind: z.literal('heartbeat') }),
  // M1 (R5-9, R5-20): the candidate leaves a section for good. v2 sessions only; there is no `item.view` event.
  z.strictObject({
    seq: Position,
    t: z.int().min(0),
    kind: z.literal('section.finish'),
    sectionId: Uuid,
  }),
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

// ---- R2 evidence files (written by the SessionDO at submit; read by the jobs; §4.4, L-14, L-21) -------------------

/**
 * One line of `events.ndjson`: signal and heartbeat events only, never an `answer.*` kind and no text field (L-21).
 * `gseq` is the session-global number (from 1; the values taken by answer events are skipped), `t` the client offset
 * in ms and `tServer` the time the DO accepted the event. A signal carries its §4.6 payload exactly.
 */
export const EvidenceEventLine = z.discriminatedUnion('kind', [
  z.discriminatedUnion(
    'sig',
    signalVariants({ gseq: Position, streamId: Uuid, t: z.int().min(0), tServer: Time }),
  ),
  z.strictObject({
    gseq: Position,
    streamId: Uuid,
    t: z.int().min(0),
    tServer: Time,
    kind: z.literal('heartbeat'),
  }),
]);
export type EvidenceEventLine = z.infer<typeof EvidenceEventLine>;

/** `final.json`: the final answers rebuilt from the edit events; `sha256` is of the answer text or option id. */
export const FinalAnswers = z
  .strictObject({
    v: z.literal(1),
    sessionId: Uuid,
    answers: z
      .array(
        z.discriminatedUnion('kind', [
          z.strictObject({
            position: Position,
            kind: z.literal('text'),
            text: StorableText(10000),
            sha256: Sha256Hex,
            finalSeq: z.int().min(0),
          }),
          z.strictObject({
            position: Position,
            kind: z.literal('choice'),
            choice: OptionId.nullable(),
            sha256: Sha256Hex,
            finalSeq: z.int().min(0),
          }),
        ]),
      )
      .max(100),
  })
  .refine((file) => new Set(file.answers.map((a) => a.position)).size === file.answers.length, {
    message: 'one answer per position',
  });
export type FinalAnswers = z.infer<typeof FinalAnswers>;

export const EventBatchReq = z.strictObject({
  streamId: Uuid,
  events: z.array(ClientEvent).min(1).max(100),
});
/**
 * `refusedSeqs` (M1, R5-20): events of this stream acknowledged but recorded as refused (an answer for a closed
 * section or a passed forward-only position). They advance `ackSeq` like accepted ones and never change an answer.
 */
export const EventBatchAck = z
  .strictObject({
    ackSeq: z.int().min(0),
    serverNow: Time,
    deadlineAt: Time,
    state: SessionState,
    refusedSeqs: z.array(Position).max(100).optional(),
  })
  .refine(
    (ack) =>
      ack.refusedSeqs === undefined ||
      (new Set(ack.refusedSeqs).size === ack.refusedSeqs.length &&
        ack.refusedSeqs.every((seq) => seq <= ack.ackSeq)),
    { message: 'refusedSeqs are distinct and acknowledged' },
  );
export const SubmitReq = z.strictObject({ streamId: Uuid, finalSeq: z.int().min(0) });

// ---- Errors ----------------------------------------------------------------------------------------------------

/** The edge answers `{ "error": "<code>" }` with a constant code and these statuses (§4.2). */
export const CANDIDATE_ERROR_STATUS = {
  bad_request: 400,
  token_invalid: 401,
  token_expired: 401,
  superseded: 401,
  otp_wrong: 401,
  not_eligible: 403,
  step_required: 403,
  invalid_link: 404,
  link_expired: 410,
  link_revoked: 410,
  closed: 410,
  // M1 (R5-20): an item GET for a position of a closed section, or below the highest served one in a forward-only
  // section. An item GET is not an outbox event, so it never blocks the queue.
  section_closed: 410,
  out_of_order: 409,
  too_large: 413,
  bad_media: 415,
  otp_locked: 429,
  resend_too_soon: 429,
  rate_limited: 429,
  unavailable: 503,
} as const;
export type CandidateErrorCode = keyof typeof CANDIDATE_ERROR_STATUS;
export const CANDIDATE_ERROR_CODES = Object.keys(CANDIDATE_ERROR_STATUS) as CandidateErrorCode[];
export const CandidateErrorCode = z.enum(
  CANDIDATE_ERROR_CODES as [CandidateErrorCode, ...CandidateErrorCode[]],
);
/** Every code except `out_of_order` answers exactly `{ error }`. */
export const CandidateErrorBody = z.strictObject({ error: CandidateErrorCode });
/** 409 `out_of_order` also carries the stream's high-water mark so the client resends from `ackSeq + 1` (§4.4). */
export const OutOfOrderBody = z.strictObject({
  error: z.literal('out_of_order'),
  ackSeq: z.int().min(0),
});

// ---- Tokens (ADR-030 §7, spec §4.3) ----------------------------------------------------------------------------

export const CandidateTokenClaims = z
  .strictObject({
    sub: Uuid,
    candidate_id: Uuid,
    invitation_id: Uuid,
    org_id: Uuid,
    typ: z.enum(['lobby', 'session', 'portal']),
    nonce: Nonce,
    iat: z.int().min(0),
    exp: z.int().min(0),
  })
  .refine((claims) => claims.sub === claims.candidate_id, {
    message: 'sub must equal candidate_id',
  })
  .refine((claims) => claims.exp > claims.iat, { message: 'exp must be after iat' });
export type CandidateTokenClaims = z.infer<typeof CandidateTokenClaims>;

// ---- Test package (R2, read by the SessionDO; §4.4). No answer key, rubric, weight, cutoff or score field. -------

export const TestPackage = z
  .strictObject({
    v: z.literal(1),
    testVersionId: Uuid,
    rulesetVersionId: Uuid,
    title: z.string().min(1).max(200),
    language: z.literal('en'),
    durationSeconds: z.int().min(60).max(7200),
    pasteBlocked: z.literal(true),
    heartbeatSeconds: z.literal(10),
    signalCatalogVersion: z.string().min(1).max(64),
    sections: z
      .array(z.strictObject({ id: Uuid, title: z.string().min(1).max(120), position: Position }))
      .min(1)
      .max(10),
    items: z
      .array(
        z.strictObject({
          position: Position,
          sectionId: Uuid,
          itemVersionId: Uuid,
          kind: ItemKind,
          prompt: z.string().min(1).max(4000),
          options: McqOptions.optional(),
          maxChars: z.int().min(1).max(10000).optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((pkg, ctx) => {
    const sectionIds = new Set(pkg.sections.map((section) => section.id));
    pkg.items.forEach((item, index) => {
      if (!sectionIds.has(item.sectionId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'sectionId'],
          message: 'unknown section',
        });
      }
      const optionsOk =
        item.kind === 'mcq'
          ? item.options !== undefined && item.maxChars === undefined
          : item.options === undefined;
      if (!optionsOk) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index],
          message: 'options belong to mcq items only',
        });
      }
    });
  });
export type TestPackage = z.infer<typeof TestPackage>;

// ---- M1 package v2 and session v2 (specs/m1-test-authoring.md §4.6, §5; R5-9, R5-20) ------------------------------
// The v1 shapes above are unchanged and still accepted. No answer key, rubric, weight, cutoff or score field here.

const Navigation = z.enum(['free', 'forward_only']);
const PasteRule = z.enum(['blocked', 'allowed_logged']);
const DifficultyBand = z.int().min(0).max(4);
type CatalogSignalName = keyof typeof SIGNAL_CATALOG.signals;
const CatalogSignalName = z.enum(
  Object.keys(SIGNAL_CATALOG.signals) as [CatalogSignalName, ...CatalogSignalName[]],
);
/** R5-24 (sections CHECKs, §3.3): a written section is forward-only and has a paste rule; no other section has one. */
const sectionRulesOk = (section: {
  format: 'mcq' | 'written';
  navigation: 'free' | 'forward_only';
  pasteRule?: 'blocked' | 'allowed_logged' | undefined;
}) =>
  section.format === 'written'
    ? section.navigation === 'forward_only' && section.pasteRule !== undefined
    : section.pasteRule === undefined;
const SECTION_RULES_MESSAGE =
  'a written section is forward-only with a paste rule; no other has one';
const STRATIFIED_ITEM_MESSAGE = 'an item of a stratified draw names its skill and difficulty band';
const uniqueStrata = (strata: readonly { skillKey: string; difficultyBand: number }[]) =>
  new Set(strata.map((st) => `${st.skillKey}:${st.difficultyBand}`)).size === strata.length;
const PackageStratum = z.strictObject({
  skillKey: SkillKey,
  difficultyBand: DifficultyBand,
  count: Position,
});

/**
 * The package v2 the SessionDO draws from (R2 object ≤ 5 MB). A section with `draw` serves `draw.count` of its
 * eligible items (strata, if any, add up to the count; none = one stratum of all items); a section without serves all
 * its items. A candidate is served at most 100 items in total (R5-9); the package holds at most 5,000. An image is
 * named by its content hash and extension, never by a storage key.
 */
export const TestPackageV2 = z
  .strictObject({
    v: z.literal(2),
    testVersionId: Uuid,
    rulesetVersionId: Uuid,
    title: z.string().min(1).max(200),
    language: z.literal('en'),
    durationSeconds: z.int().min(60).max(7200),
    heartbeatSeconds: z.literal(10),
    signalCatalogVersion: z.string().min(1).max(64),
    captureSignals: z.array(CatalogSignalName).max(5),
    sections: z
      .array(
        z.strictObject({
          id: Uuid,
          title: z.string().min(1).max(120),
          position: Position,
          format: ItemKind,
          timeLimitSeconds: z.int().min(60).max(7200).optional(),
          navigation: Navigation,
          shuffleItems: z.boolean(),
          shuffleOptions: z.boolean(),
          pasteRule: PasteRule.optional(),
          draw: z
            .strictObject({ count: Position.max(100), strata: z.array(PackageStratum).max(20) })
            .nullable(),
        }),
      )
      .min(1)
      .max(10),
    items: z
      .array(
        z.strictObject({
          sectionId: Uuid,
          itemVersionId: Uuid,
          itemId: Uuid,
          kind: ItemKind,
          prompt: z.string().min(1).max(4000),
          options: McqOptions.optional(),
          maxChars: z.int().min(1).max(10000).optional(),
          media: z
            .array(
              z
                .strictObject({
                  hash: Sha256Hex,
                  ext: z.enum(['png', 'jpg', 'webp']),
                  alt: z.string().min(1).max(300),
                  // Wave 2 lead decision (R5-10, SEC-M1-5): the stored R2 object path, item-media/<org uuid>/<hash>.<ext>. A
                  // library copy keeps the library org's prefix, so the edge reads exactly this path (never rebuilds it
                  // from the session's org). Never passed to the candidate.
                  objectPath: z
                    .string()
                    .regex(
                      /^item-media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}\.(png|jpg|webp)$/,
                    ),
                })
                .refine((m) => m.objectPath.endsWith(`/${m.hash}.${m.ext}`), {
                  message: 'the object path names this image',
                }),
            )
            .min(1)
            .max(4)
            .optional(),
          // R5-57 e (lead decision): optional, both or neither. An item served by an inline section or a draw
          // without strata may omit both (D1 editor items); every item of a stratified draw names both.
          skillKey: SkillKey.optional(),
          difficultyBand: DifficultyBand.optional(),
          // Served count frozen at publish (section_pool_snapshot.exposure_at_publish, R3-2): the draw weight is
          // 1 / (1 + exposureAtPublish) (§6.5). The DO never passes it to the candidate.
          exposureAtPublish: z.int().min(0),
          variants: z
            .array(
              z.strictObject({
                variantId: Uuid,
                prompt: z.string().min(1).max(4000),
                options: McqOptions,
              }),
            )
            .min(1)
            .max(200)
            .optional(),
        }),
      )
      .min(1)
      .max(5000),
  })
  .superRefine((pkg, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (new Set(pkg.captureSignals).size !== pkg.captureSignals.length) {
      issue(['captureSignals'], 'duplicate signal');
    }
    if (new Set(pkg.sections.map((s) => s.id)).size !== pkg.sections.length) {
      issue(['sections'], 'duplicate section id');
    }
    if (new Set(pkg.sections.map((s) => s.position)).size !== pkg.sections.length) {
      issue(['sections'], 'duplicate section position');
    }
    const timed = pkg.sections.filter((s) => s.timeLimitSeconds !== undefined).length;
    if (timed !== 0 && timed !== pkg.sections.length) {
      issue(['sections'], 'section timers are all or none');
    }
    if (new Set(pkg.items.map((i) => i.itemVersionId)).size !== pkg.items.length) {
      issue(['items'], 'an item version appears once');
    }
    const bySection = new Map(pkg.sections.map((s) => [s.id, [] as typeof pkg.items]));
    const formatOf = new Map(pkg.sections.map((s) => [s.id, s.format]));
    pkg.items.forEach((item, index) => {
      const list = bySection.get(item.sectionId);
      if (list === undefined) issue(['items', index, 'sectionId'], 'unknown section');
      else list.push(item);
      const format = formatOf.get(item.sectionId);
      if (format !== undefined && format !== item.kind) {
        issue(['items', index, 'kind'], 'item kind differs from its section format');
      }
      const shapeOk =
        item.kind === 'mcq'
          ? item.options !== undefined && item.maxChars === undefined
          : item.options === undefined && item.variants === undefined;
      if (!shapeOk) issue(['items', index], 'options and variants belong to mcq items only');
      if ((item.skillKey === undefined) !== (item.difficultyBand === undefined)) {
        issue(['items', index], 'an item names its skill and difficulty band together');
      }
    });
    let served = 0;
    pkg.sections.forEach((section, s) => {
      if (!sectionRulesOk(section)) issue(['sections', s], SECTION_RULES_MESSAGE);
      const eligible = bySection.get(section.id) ?? [];
      if (eligible.length === 0) issue(['sections', s], 'a section has items');
      if (section.draw === null) {
        served += eligible.length;
        return;
      }
      served += section.draw.count;
      if (section.draw.count > eligible.length) {
        issue(['sections', s, 'draw', 'count'], 'the draw exceeds the eligible items');
      }
      const strata = section.draw.strata;
      if (strata.length > 0 && eligible.some((i) => i.skillKey === undefined)) {
        issue(['sections', s, 'draw', 'strata'], STRATIFIED_ITEM_MESSAGE);
      }
      if (!uniqueStrata(strata)) {
        issue(['sections', s, 'draw', 'strata'], 'one stratum per skill and difficulty band');
      }
      if (strata.length > 0 && strata.reduce((n, st) => n + st.count, 0) !== section.draw.count) {
        issue(['sections', s, 'draw', 'strata'], 'the strata must add up to the draw count');
      }
      strata.forEach((st, k) => {
        const matching = eligible.filter(
          (i) => i.skillKey === st.skillKey && i.difficultyBand === st.difficultyBand,
        ).length;
        if (st.count > matching) {
          issue(['sections', s, 'draw', 'strata', k], 'the stratum exceeds its eligible items');
        }
      });
    });
    if (served > 100) issue(['sections'], 'a candidate is served at most 100 items');
  });
export type TestPackageV2 = z.infer<typeof TestPackageV2>;

/** One served item of a v2 session: options already in served order, images by hash (fetched as bytes, R5-10). */
export const ServedItemV2 = z
  .strictObject({
    position: Position,
    kind: ItemKind,
    sectionId: Uuid,
    prompt: z.string().min(1).max(4000),
    options: McqOptions.optional(),
    maxChars: z.int().min(1).max(10000).optional(),
    media: z
      .array(z.strictObject({ hash: Sha256Hex, alt: z.string().min(1).max(300) }))
      .min(1)
      .max(4)
      .optional(),
    variantId: Uuid.optional(),
    servedAt: Time,
  })
  .refine(
    (item) =>
      item.kind === 'mcq'
        ? item.options !== undefined && item.maxChars === undefined
        : item.options === undefined && item.variantId === undefined,
    { message: 'options and variants belong to mcq items only' },
  );
export type ServedItemV2 = z.infer<typeof ServedItemV2>;

/**
 * The v2 session view. Section state and deadline are read from the DO, never the client clock (§4.6); `pasteRule`
 * drives the rules text (R5-24). `v: 2` tells it apart from the v1 view, which keeps its single `pasteBlocked` flag.
 */
export const SessionViewV2 = z
  .strictObject({
    v: z.literal(2),
    sessionId: Uuid,
    state: SessionState,
    serverNow: Time,
    startedAt: Time,
    deadlineAt: Time,
    streamId: Uuid,
    heartbeatSeconds: z.literal(10),
    title: z.string().min(1).max(200),
    sections: z
      .array(
        z.strictObject({
          id: Uuid,
          title: z.string().min(1).max(120),
          position: Position,
          format: ItemKind,
          navigation: Navigation,
          pasteRule: PasteRule.optional(),
          state: z.enum(['not_entered', 'open', 'closed']),
          deadlineAt: Time.optional(),
        }),
      )
      .min(1)
      .max(10),
    items: z
      .array(
        z.strictObject({
          position: Position,
          sectionId: Uuid,
          kind: ItemKind,
          servedAt: Time.nullable(),
        }),
      )
      .min(1)
      .max(100),
    answers: z
      .array(
        z.union([
          z.strictObject({ position: Position, text: StorableText(100000) }),
          z.strictObject({ position: Position, choice: OptionId }),
        ]),
      )
      .max(100),
    receipt: Receipt.optional(),
  })
  .superRefine((view, ctx) => {
    view.sections.forEach((section, s) => {
      if (!sectionRulesOk(section)) {
        ctx.addIssue({ code: 'custom', path: ['sections', s], message: SECTION_RULES_MESSAGE });
      }
    });
    view.items.forEach((item, i) => {
      if (!view.sections.some((s) => s.id === item.sectionId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'sectionId'],
          message: 'unknown section',
        });
      }
    });
  });
export type SessionViewV2 = z.infer<typeof SessionViewV2>;

export const SessionStartResV2 = z.union([
  z.strictObject({ sessionToken: Jws, expiresAt: Time, view: SessionViewV2 }),
  z.strictObject({ state: z.literal('submitted'), receipt: Receipt }),
]);
export type SessionStartResV2 = z.infer<typeof SessionStartResV2>;
export const SessionAttachResV2 = z.strictObject({ view: SessionViewV2 });
export type SessionAttachResV2 = z.infer<typeof SessionAttachResV2>;

/**
 * `GET /v1/session/items/:pos?afterSeq=n` (R5-45): in a forward-only section the DO serves the next position only
 * once its accepted high-water mark reaches `afterSeq`, else 409 `out_of_order` with `ackSeq`. Query text, digits only.
 */
export const ItemGetQuery = z.strictObject({
  afterSeq: z
    .string()
    .regex(/^[0-9]{1,15}$/)
    .transform(Number)
    .optional(),
});
export type ItemGetQuery = z.infer<typeof ItemGetQuery>;

// ---- The one mirror message (SessionDO -> trace-session-mirror queue and R2 mirror.json; §4.4) ----------------------

/** The D1 mirror message, unchanged (v1 sessions and the sweep's re-enqueued v1 mirror.json files). */
export const SessionMirrorMessageV1 = z.strictObject({
  v: z.literal(1),
  jobKind: z.literal('session_mirror'),
  mirrorSeq: z.literal(1), // single mirror at submit in D1; forward-only column stays for M3a
  jobKey: z.string(), // `${sessionId}:session_mirror:${rulesetVersionId}`; later stages derive their own keys (L-6, L-20)
  sessionId: z.uuid(),
  orgId: z.uuid(),
  invitationId: z.uuid(),
  testVersionId: z.uuid(),
  rulesetVersionId: z.uuid(),
  consentId: z.uuid(),
  state: z.enum(['submitted', 'auto_submitted']),
  receiptRef: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/),
  startedAt: z.iso.datetime(),
  deadlineAt: z.iso.datetime(),
  submittedAt: z.iso.datetime(),
  lastEventSeq: z.number().int().min(0), // the last session-global gseq (L-14)
  streamCount: z.number().int().min(1),
  resumeCount: z.number().int().min(0),
  served: z.array(
    z.strictObject({
      position: z.number().int(),
      itemVersionId: z.uuid(),
      servedAt: z.iso.datetime(),
    }),
  ),
  evidence: z.strictObject({
    finalKey: z.string(),
    finalSha256: z.string(),
    eventsKey: z.string(),
    eventsSha256: z.string(),
  }),
  replay: z.enum(['ok', 'mismatch']),
  signalCatalogVersion: z.string(),
  coverage: z.strictObject({
    activeMs: z.number().int().min(0),
    coveredMs: z.number().int().min(0),
  }),
  gaps: z
    .array(
      z.strictObject({
        from: z.iso.datetime(),
        to: z.iso.datetime(),
        label: z.literal('connectivity'),
      }),
    )
    .max(50),
  photo: z
    .strictObject({
      key: z.string(),
      sha256: z.string(),
      bytes: z.number().int(),
      mime: z.literal('image/jpeg'),
      blurredOnDevice: z.literal(true),
    })
    .nullable(),
  photoSkippedReason: z.enum(['camera_denied', 'no_camera', 'declined']).nullable(),
});
export type SessionMirrorMessageV1 = z.infer<typeof SessionMirrorMessageV1>;

/**
 * The v2 mirror (package v2 sessions; R5-19, R5-42). Served rows gain their section, variant, option order and draw
 * seed hash; `draws` lists, per entered pool section, the drawn item versions in draw order with a parallel list of
 * variant ids (null for an item that is not parameterised). `poolSectionIds` names every pool section of the test
 * version. The schema is structural only (strict shapes, bounds): D1's consumer acks a schema failure with no retry,
 * so the cross-field invariants live in `checkMirrorV2`, which the mirror stage runs so that a violation retries and
 * reaches the DLQ with an error report (R5-8, R5-42). Positions are checked by the jobs code.
 */
export const SessionMirrorMessageV2 = SessionMirrorMessageV1.extend({
  v: z.literal(2),
  served: z
    .array(
      z.strictObject({
        position: z.number().int(),
        itemVersionId: z.uuid(),
        servedAt: z.iso.datetime(),
        sectionId: z.uuid(),
        itemVariantId: z.uuid().optional(),
        optionOrder: z.array(OptionId).min(2).max(6).optional(),
        drawSeedSha256: Sha256Hex.optional(),
      }),
    )
    .max(100),
  poolSectionIds: z.array(z.uuid()).max(10),
  draws: z
    .array(
      z.strictObject({
        sectionId: z.uuid(),
        itemVersionIds: z.array(z.uuid()).min(1).max(100),
        itemVariantIds: z.array(z.uuid().nullable()).min(1).max(100),
      }),
    )
    .max(10),
});
export type SessionMirrorMessageV2 = z.infer<typeof SessionMirrorMessageV2>;

export const MIRROR_INVARIANT_CODES = [
  'duplicate_pool_section',
  'draw_not_pool_section',
  'duplicate_draw',
  'variant_ids_not_parallel',
  'item_drawn_twice',
  'too_many_drawn',
  'option_order_not_permutation',
  'served_missing_from_draw',
  'served_variant_mismatch',
] as const;
export type MirrorInvariantCode = (typeof MIRROR_INVARIANT_CODES)[number];

/** A v2 mirror message that parses but breaks a cross-field invariant. The message names the code only. */
export class MirrorInvariantError extends Error {
  readonly code: MirrorInvariantCode;
  constructor(code: MirrorInvariantCode) {
    super(`mirror v2 invariant: ${code}`);
    this.name = 'MirrorInvariantError';
    this.code = code;
  }
}

/**
 * The cross-field invariants of a parsed v2 mirror message; throws MirrorInvariantError on the first one broken.
 * Every served item of a pool section is in that section's draw with the drawn variant (R5-42); draws belong to pool
 * sections, one per section, with a variant entry per item and no repeat; at most 100 items are drawn in total (R5-9).
 */
export function checkMirrorV2(msg: SessionMirrorMessageV2): void {
  const fail = (code: MirrorInvariantCode): never => {
    throw new MirrorInvariantError(code);
  };
  const pool = new Set(msg.poolSectionIds);
  if (pool.size !== msg.poolSectionIds.length) fail('duplicate_pool_section');
  const drawOf = new Map<string, SessionMirrorMessageV2['draws'][number]>();
  let drawn = 0;
  for (const draw of msg.draws) {
    if (!pool.has(draw.sectionId)) fail('draw_not_pool_section');
    if (drawOf.has(draw.sectionId)) fail('duplicate_draw');
    if (draw.itemVariantIds.length !== draw.itemVersionIds.length) fail('variant_ids_not_parallel');
    if (new Set(draw.itemVersionIds).size !== draw.itemVersionIds.length) fail('item_drawn_twice');
    drawOf.set(draw.sectionId, draw);
    drawn += draw.itemVersionIds.length;
  }
  if (drawn > 100) fail('too_many_drawn');
  for (const row of msg.served) {
    if (row.optionOrder !== undefined && new Set(row.optionOrder).size !== row.optionOrder.length) {
      fail('option_order_not_permutation');
    }
    if (!pool.has(row.sectionId)) continue;
    const draw = drawOf.get(row.sectionId);
    const at = draw === undefined ? -1 : draw.itemVersionIds.indexOf(row.itemVersionId);
    if (draw === undefined || at < 0) return fail('served_missing_from_draw');
    if ((row.itemVariantId ?? null) !== draw.itemVariantIds[at]) fail('served_variant_mismatch');
  }
}

/** What `workers/jobs` parses (R5-8): v1 and v2, accepted before the edge emits v2 (deploy api -> jobs -> edge). */
export const SessionMirrorMessage = z.discriminatedUnion('v', [
  SessionMirrorMessageV1,
  SessionMirrorMessageV2,
]);
export type SessionMirrorMessage = z.infer<typeof SessionMirrorMessage>;

// ---- CandidateRpc (service binding edge -> services/api; §4.2) --------------------------------------------------
// Internal, validated inside api. Methods after lobbyMint receive the raw lobby token and re-verify it there.

export const InviteResolveRpcIn = z.strictObject({ token: LinkToken });
export const InviteResolveRpcOut = z.strictObject({
  invitationId: Uuid,
  orgId: Uuid,
  candidateId: Uuid,
  state: InvitationState,
  title: z.string().min(1).max(200).optional(),
  durationMinutes: z.int().min(1).max(120).optional(),
});

/** The edge hands api the OTP; api resolves the address itself, so no address crosses this boundary. */
export const MessagingSendRpcIn = z.strictObject({
  invitationId: Uuid,
  orgId: Uuid,
  code: OtpCode,
  idempotencyKey: z.string().min(1).max(200),
});
export const MessagingSendRpcOut = z.strictObject({ ok: z.literal(true) });

/** The edge generates the lobby nonce at each OTP verify and keeps its hash; api puts the nonce in the token. */
export const LobbyMintRpcIn = z.strictObject({ invitationId: Uuid, orgId: Uuid, nonce: Nonce });
export const LobbyMintRpcOut = z.strictObject({
  lobbyToken: Jws,
  expiresAt: Time,
  next: LobbyNext,
});

export const AgeDeclareRpcIn = z.strictObject({ lobbyToken: Jws, adult: z.boolean() });
/** `blocked: true` -> the edge answers 403 `not_eligible` (the invitation is now `blocked_age`). */
export const AgeDeclareRpcOut = z.strictObject({ blocked: z.boolean() });

export const NoticeGetRpcIn = z.strictObject({ lobbyToken: Jws });
export const NoticeGetRpcOut = NoticeRes;

export const ConsentRecordRpcIn = z.strictObject({
  lobbyToken: Jws,
  noticeVersionId: Uuid,
  renderedSha256: Sha256Hex,
  accepted: z.literal(true),
});
export const ConsentRecordRpcOut = z.strictObject({ ok: z.literal(true) });

export const PhotoPermitRpcIn = z.strictObject({ lobbyToken: Jws });
export const PhotoPermitRpcOut = z.strictObject({
  orgId: Uuid,
  sessionId: Uuid,
  locked: z.boolean(),
});

export const SessionGrantRpcIn = z.strictObject({
  lobbyToken: Jws,
  rulesAcknowledged: z.literal(true),
  photo: PhotoChoice,
});
export const SessionGrantRpcOut = z
  .strictObject({
    resume: z.boolean(),
    startedAt: Time.nullable(),
    durationSeconds: z.int().min(60).max(7200),
    sessionToken: Jws,
    nonce: Nonce,
    packageKey: z.string().min(1).max(256),
    packageSha256: Sha256Hex,
    testVersionId: Uuid,
    rulesetVersionId: Uuid,
    consentId: Uuid,
    adultConfirmed: z.literal(true),
    sessionId: Uuid,
  })
  // `startedAt` is the stored, set-once start of a session that already began: only a resume has one.
  .refine((out) => out.startedAt === null || out.resume, {
    message: 'startedAt belongs to a resume only',
  });

export const SessionStartedRpcIn = z.strictObject({
  invitationId: Uuid,
  orgId: Uuid,
  sessionId: Uuid,
  startedAt: Time,
});
export const SessionStartedRpcOut = z.strictObject({ startedAt: Time });

export const CandidateRpcSchemas = {
  inviteResolve: { in: InviteResolveRpcIn, out: InviteResolveRpcOut },
  messagingSend: { in: MessagingSendRpcIn, out: MessagingSendRpcOut },
  lobbyMint: { in: LobbyMintRpcIn, out: LobbyMintRpcOut },
  ageDeclare: { in: AgeDeclareRpcIn, out: AgeDeclareRpcOut },
  noticeGet: { in: NoticeGetRpcIn, out: NoticeGetRpcOut },
  consentRecord: { in: ConsentRecordRpcIn, out: ConsentRecordRpcOut },
  photoPermit: { in: PhotoPermitRpcIn, out: PhotoPermitRpcOut },
  sessionGrant: { in: SessionGrantRpcIn, out: SessionGrantRpcOut },
  sessionStarted: { in: SessionStartedRpcIn, out: SessionStartedRpcOut },
} as const;

// ---- Inferred types for every exported wire schema (the edge, the api and the candidate app import types only) -------

export type LinkToken = z.infer<typeof LinkToken>;
export type InvitationState = z.infer<typeof InvitationState>;
export type SessionState = z.infer<typeof SessionState>;
export type PhotoSkippedReason = z.infer<typeof PhotoSkippedReason>;
export type LobbyNext = z.infer<typeof LobbyNext>;
export type OkRes = z.infer<typeof OkRes>;

export type InviteResolveReq = z.infer<typeof InviteResolveReq>;
export type OtpRequestReq = z.infer<typeof OtpRequestReq>;
export type OtpRequestRes = z.infer<typeof OtpRequestRes>;
export type OtpVerifyReq = z.infer<typeof OtpVerifyReq>;
export type OtpVerifyRes = z.infer<typeof OtpVerifyRes>;
export type AgeDeclareReq = z.infer<typeof AgeDeclareReq>;
export type NoticeRes = z.infer<typeof NoticeRes>;
export type ConsentReq = z.infer<typeof ConsentReq>;
export type PhotoRes = z.infer<typeof PhotoRes>;
export type SessionStartReq = z.infer<typeof SessionStartReq>;
export type SessionStartRes = z.infer<typeof SessionStartRes>;
export type SessionAttachRes = z.infer<typeof SessionAttachRes>;
export type EventBatchReq = z.infer<typeof EventBatchReq>;
export type EventBatchAck = z.infer<typeof EventBatchAck>;
export type SubmitReq = z.infer<typeof SubmitReq>;
export type CandidateErrorBody = z.infer<typeof CandidateErrorBody>;
export type OutOfOrderBody = z.infer<typeof OutOfOrderBody>;

export type InviteResolveRpcIn = z.infer<typeof InviteResolveRpcIn>;
export type InviteResolveRpcOut = z.infer<typeof InviteResolveRpcOut>;
export type MessagingSendRpcIn = z.infer<typeof MessagingSendRpcIn>;
export type MessagingSendRpcOut = z.infer<typeof MessagingSendRpcOut>;
export type LobbyMintRpcIn = z.infer<typeof LobbyMintRpcIn>;
export type LobbyMintRpcOut = z.infer<typeof LobbyMintRpcOut>;
export type AgeDeclareRpcIn = z.infer<typeof AgeDeclareRpcIn>;
export type AgeDeclareRpcOut = z.infer<typeof AgeDeclareRpcOut>;
export type NoticeGetRpcIn = z.infer<typeof NoticeGetRpcIn>;
export type NoticeGetRpcOut = z.infer<typeof NoticeGetRpcOut>;
export type ConsentRecordRpcIn = z.infer<typeof ConsentRecordRpcIn>;
export type ConsentRecordRpcOut = z.infer<typeof ConsentRecordRpcOut>;
export type PhotoPermitRpcIn = z.infer<typeof PhotoPermitRpcIn>;
export type PhotoPermitRpcOut = z.infer<typeof PhotoPermitRpcOut>;
export type SessionGrantRpcIn = z.infer<typeof SessionGrantRpcIn>;
export type SessionGrantRpcOut = z.infer<typeof SessionGrantRpcOut>;
export type SessionStartedRpcIn = z.infer<typeof SessionStartedRpcIn>;
export type SessionStartedRpcOut = z.infer<typeof SessionStartedRpcOut>;
