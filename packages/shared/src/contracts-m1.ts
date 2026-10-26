// M1 authoring contracts (specs/m1-test-authoring.md §5; value lists from §3.2, §4.3-§4.5, §6.6 and migration M1-a).
// Every object schema is strict: an unknown key fails. Nothing here carries a score, band, grade or outcome (rule 1,
// R5-29), and nothing sent to a library browser carries an answer key (I-M1-5). Recruiter-side only: the candidate
// shapes (package v2, session view v2) live in contracts-candidate.ts.
import { z } from 'zod';
import { canonicalJson } from './canonical-json.js';
import { TestDetailResponse, UpdateTestDraftRequest } from './contracts-d1.js';
import { AiDraftErrorCode, ImportJobErrorCode, OrgRole } from './contracts-tenancy.js';

export { AiDraftErrorCode, ImportJobErrorCode } from './contracts-tenancy.js';

// Small factories, so each schema gets its own node.
const uuid = () => z.uuid();
const time = () => z.iso.datetime({ offset: true });
const sha256 = () => z.string().regex(/^[0-9a-f]{64}$/);
const posInt = () => z.int().min(1);
const count = () => z.int().min(0);
/** Option ids are short author-chosen strings (item_versions.options, 1..64 chars, as D1). */
const optionId = () => z.string().min(1).max(64);
const uniqueBy = <T>(rows: readonly T[], key: (row: T) => unknown) =>
  new Set(rows.map(key)).size === rows.length;

/** Text Postgres and the queue can carry: no U+0000 and no lone UTF-16 surrogate. */
const storable = (s: string) =>
  !s.includes('\u0000') &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
/** Free text a client writes: bounded and storable (security review: every request text field). */
const text = (min: number, max: number) =>
  z.string().min(min).max(max).refine(storable, { message: 'unstorable_text' });
/** Every string inside a value is storable (for D1's item shape, which this file reuses as is). */
const deepStorable = (value: unknown): boolean => {
  if (typeof value === 'string') return storable(value);
  if (Array.isArray(value)) return value.every(deepStorable);
  if (typeof value === 'object' && value !== null) return Object.values(value).every(deepStorable);
  return true;
};

// ---- Page cursors (security review: a keyset only, never a carrier of scope or filters) ---------------------------

/** The keyset of a list page: the last row's `createdAt` and `id`. Org, workspace and filters come from the request. */
export const PageCursor = z.strictObject({ createdAt: time(), id: uuid() });
export type PageCursor = z.infer<typeof PageCursor>;
const CURSOR_MAX = 200;

const toBase64url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** base64url (no padding) of the keyset's canonical JSON. Throws on anything that is not a PageCursor. */
export function encodePageCursor(value: PageCursor): string {
  return toBase64url(new TextEncoder().encode(canonicalJson(PageCursor.parse(value))));
}

/**
 * The keyset of a cursor, or null: refuses over-length or non-base64url text, invalid UTF-8, non-JSON, extra keys,
 * bad types and any non-canonical encoding (the cursor must equal the re-encoding of what it decodes to).
 */
export function decodePageCursor(cursorText: string): PageCursor | null {
  if (cursorText.length > CURSOR_MAX || !/^[A-Za-z0-9_-]+$/.test(cursorText)) return null;
  try {
    const binary = atob(cursorText.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const json: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    const parsed = PageCursor.safeParse(json);
    if (!parsed.success || encodePageCursor(parsed.data) !== cursorText) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** A list cursor (query string and response): only what decodePageCursor accepts. */
const cursor = () =>
  z
    .string()
    .max(CURSOR_MAX)
    .refine((s) => decodePageCursor(s) !== null, { message: 'bad_cursor' });
/** One cursor page of a list. */
const PAGE_SIZE = 50;
/** A query-string difficulty: decimal text (so '' or ' ' is never read as 0), then a number in 0..1. */
const queryDifficulty = () =>
  z
    .string()
    .regex(/^[01](\.[0-9]{1,6})?$/)
    .transform(Number)
    .pipe(z.number().min(0).max(1));
/** 1-500 distinct ids: the library_copy_requests bound (M1-a), used for every id batch. */
const idBatch = () =>
  z
    .array(uuid())
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'ids must be distinct' });

// ---- Database value lists ------------------------------------------------------------------------------------------

/** public.item_status (M1-a). No `rejected`: a version sent back is `not_approved`, terminal (R5-22). */
export const ITEM_STATUSES = ['draft', 'in_review', 'approved', 'not_approved', 'retired'] as const;
export const ItemStatus = z.enum(ITEM_STATUSES);
export type ItemStatus = z.infer<typeof ItemStatus>;

/** item_versions.origin CHECK (text, R5-28). Set by the write path, never chosen by a client. */
export const ITEM_ORIGINS = ['human', 'import', 'ai_draft', 'library'] as const;
export const ItemOrigin = z.enum(ITEM_ORIGINS);
export type ItemOrigin = z.infer<typeof ItemOrigin>;

/** public.section_format (D1 migration 1). */
export const ItemFormat = z.enum(['mcq', 'written']);
export type ItemFormat = z.infer<typeof ItemFormat>;

/** skill_taxonomy.skill_key. */
export const SkillKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
/** numeric(3,2) 0..1. */
export const Difficulty = z.number().min(0).max(1).multipleOf(0.01);
/** A difficulty stratum of a draw (0-4); not an integrity band. */
const difficultyBand = () => z.int().min(0).max(4);

/** import_jobs.status (§3.2, §4.3). */
export const ImportJobStatus = z.enum(['open', 'validating', 'completed', 'cancelled', 'failed']);
export type ImportJobStatus = z.infer<typeof ImportJobStatus>;
/** Per-row import error codes (§4.3), stored in import_row_errors.error_code. */
export const IMPORT_ERROR_CODES = [
  'missing_field',
  'bad_format',
  'bad_skill',
  'bad_difficulty',
  'bad_options',
  'bad_key',
  'too_long',
  'bad_image_ref',
  'image_missing',
  'image_too_large',
  'image_bad_type',
  'duplicate_in_file',
  'duplicate_in_bank',
  'bad_param_spec',
  'variant_generation_failed',
  'row_limit',
] as const;
export const ImportErrorCode = z.enum(IMPORT_ERROR_CODES);
export type ImportErrorCode = z.infer<typeof ImportErrorCode>;

/** ai_draft_jobs.status (§3.2, §4.4). */
export const AiDraftJobStatus = z.enum(['queued', 'running', 'completed', 'failed']);
export type AiDraftJobStatus = z.infer<typeof AiDraftJobStatus>;

/** member_invites.status (§3.2, §4.5). */
export const MemberInviteStatus = z.enum(['pending', 'provisioned', 'failed', 'cancelled']);
export type MemberInviteStatus = z.infer<typeof MemberInviteStatus>;

// ---- Integrity settings catalog m1-settings-v1 (§6.6; integrity_setting_defs seed) -----------------------------

export const INTEGRITY_CATALOG_VERSION = 'm1-settings-v1';

/** Allowed values per setting, in the catalog's order. The database seed is the source; rls_m1_settings pins it. */
export const INTEGRITY_SETTING_VALUES = {
  calibration_warmup: ['on', 'off'],
  typing_provenance: ['on', 'off'],
  burst_after_tab: ['on', 'off'],
  fullscreen_tab_focus: ['off', 'warn_first', 'on'],
  single_screen: ['on', 'off'],
  camera_face_presence: ['on', 'off'],
  mic_speech_presence: ['on', 'off'],
  explain_probe: ['on', 'off'],
  question_copy: ['on', 'off'],
  paste_written: ['blocked', 'allowed_logged'],
  integrity_review_scope: ['shortlist_only'],
  accommodations: ['on'],
  id_verification: ['off'],
} as const;
type SettingKeyName = keyof typeof INTEGRITY_SETTING_VALUES;
const SETTING_KEYS = Object.keys(INTEGRITY_SETTING_VALUES) as [SettingKeyName, ...SettingKeyName[]];
export const SettingKey = z.enum(SETTING_KEYS);
export type SettingKey = z.infer<typeof SettingKey>;

/** Settings locked by definition (rule 6, M3b accommodations, Phase 2 identity); an admin lock row is refused. */
export const ALWAYS_LOCKED_SETTINGS: readonly SettingKey[] = [
  'integrity_review_scope',
  'accommodations',
  'id_verification',
];

export const PresetKey = z.enum(['strict', 'standard', 'open_book']);
export type PresetKey = z.infer<typeof PresetKey>;

/** One value per setting of the catalog, each from its own list. Always-locked settings have one value. */
const settingValues = () =>
  z.strictObject(
    Object.fromEntries(
      SETTING_KEYS.map((key) => [
        key,
        z.enum(INTEGRITY_SETTING_VALUES[key] as unknown as [string, ...string[]]),
      ]),
    ) as {
      [K in SettingKeyName]: z.ZodEnum<{ [V in (typeof INTEGRITY_SETTING_VALUES)[K][number]]: V }>;
    },
  );

// ---- Media and parameterised variants (§3.3, §6.3) --------------------------------------------------------------

/** One import image is at most 1 MiB (§6.9, R2-19, R5-48 "1 MB"; R5-55 d): the client, the import worker and the
 * api all use this constant. */
export const IMPORT_IMAGE_MAX_BYTES = 1_048_576;

/** A content-addressed item image (`item-media/{org}/{sha256}.{ext}`) and its required alt text. */
export const ItemMedia = z.strictObject({
  key: z.string().regex(/^item-media\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(png|jpg|webp)$/),
  alt: text(1, 300),
});
export type ItemMedia = z.infer<typeof ItemMedia>;
const mediaList = () => z.array(ItemMedia).min(1).max(4);

/** Names a parameter may not take: they reach the prototype chain of a plain object (security review). */
const RESERVED_NAMES: readonly string[] = ['constructor', 'prototype', '__proto__'];
const ParamName = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,15}$/)
  .refine((name) => !RESERVED_NAMES.includes(name), { message: 'reserved name' });
/** A record keyed by ParamName. zod drops an own `__proto__` key silently, so the raw keys are checked first. */
const nameRecord = <V extends z.ZodType>(value: V) =>
  z
    .custom<Record<string, unknown>>(
      (input) =>
        typeof input !== 'object' ||
        input === null ||
        Object.keys(input).every((key) => !RESERVED_NAMES.includes(key)),
      { message: 'reserved name' },
    )
    .pipe(z.record(ParamName, value));
/** An expression of the §6.3 grammar; `packages/item-variants` parses it. */
const Expr = text(1, 200);
const ParamDef = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('int'), min: z.int(), max: z.int(), step: posInt() })
    .refine((p) => p.min <= p.max, { message: 'min must not exceed max' }),
  z.strictObject({
    kind: z.literal('choice'),
    values: z
      .array(z.union([z.int(), text(1, 100)]))
      .min(1)
      .max(20),
  }),
]);

export const ParamSpec = z
  .strictObject({
    params: nameRecord(ParamDef),
    derived: nameRecord(Expr),
    constraints: z.array(Expr).max(8),
    stem: text(1, 4000),
    options: z
      .array(z.strictObject({ id: optionId(), text: text(1, 500) }))
      .min(2)
      .max(6),
    correctOptionId: optionId(),
    count: z.int().min(5).max(200),
  })
  .superRefine((spec, ctx) => {
    const params = Object.keys(spec.params);
    const derived = Object.keys(spec.derived);
    if (params.length < 1 || params.length > 8) {
      ctx.addIssue({ code: 'custom', path: ['params'], message: '1 to 8 params' });
    }
    if (derived.length > 8) {
      ctx.addIssue({ code: 'custom', path: ['derived'], message: 'at most 8 derived values' });
    }
    if (derived.some((name) => params.includes(name))) {
      ctx.addIssue({
        code: 'custom',
        path: ['derived'],
        message: 'a derived name repeats a param',
      });
    }
    if (!uniqueBy(spec.options, (o) => o.id)) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'option ids must be unique' });
    }
    if (!spec.options.some((o) => o.id === spec.correctOptionId)) {
      ctx.addIssue({ code: 'custom', path: ['correctOptionId'], message: 'unknown option' });
    }
  });
export type ParamSpec = z.infer<typeof ParamSpec>;

// ---- Bank items (§6.2) ----------------------------------------------------------------------------------------------

const mcqOptions = () =>
  z
    .array(z.strictObject({ id: optionId(), text: text(1, 500) }))
    .min(2)
    .max(6);
const stem = () => text(1, 4000);
const mcqKeyOk = (item: {
  options: readonly { id: string }[];
  key?: { optionId: string } | undefined;
}) =>
  uniqueBy(item.options, (o) => o.id) &&
  (item.key === undefined || item.options.some((o) => o.id === item.key?.optionId));
const MCQ_KEY_MESSAGE = 'option ids must be unique and the key must be one of them';

/**
 * Bank item content as the editor writes it. `workspaceId` (create only; absent = the org's default workspace,
 * RLS decides) follows D1's CreateTestRequest. Origin, status and approval are set by the write path, never here.
 */
export const BankItemDraft = z.discriminatedUnion('format', [
  z
    .strictObject({
      format: z.literal('mcq'),
      stem: stem(),
      options: mcqOptions(),
      key: z.strictObject({ optionId: optionId() }),
      skillKey: SkillKey,
      difficulty: Difficulty,
      media: mediaList().optional(),
      paramSpec: ParamSpec.optional(),
      workspaceId: uuid().optional(),
    })
    .refine(mcqKeyOk, { message: MCQ_KEY_MESSAGE }),
  z.strictObject({
    format: z.literal('written'),
    stem: stem(),
    rubricVersionId: uuid(),
    skillKey: SkillKey,
    difficulty: Difficulty,
    media: mediaList().optional(),
    workspaceId: uuid().optional(),
  }),
]);
export type BankItemDraft = z.infer<typeof BankItemDraft>;

/** One row of the bank list. No key, no rubric, no options. */
export const BankItemSummary = z.strictObject({
  itemId: uuid(),
  itemVersionId: uuid(),
  versionNo: posInt(),
  workspaceId: uuid(),
  format: ItemFormat,
  skillKey: SkillKey,
  difficulty: Difficulty.nullable(),
  status: ItemStatus,
  origin: ItemOrigin,
  stemPreview: z.string().min(1).max(300),
  isParameterised: z.boolean(),
  exposureCount: count(),
  createdAt: time(),
});
export type BankItemSummary = z.infer<typeof BankItemSummary>;

/** Item content in the detail view: the key is present only when the caller may read it (RLS) and it is not
 * library-sourced; the param spec (it holds the key) follows the same rule. */
const DetailContent = z.discriminatedUnion('format', [
  z
    .strictObject({
      format: z.literal('mcq'),
      stem: stem(),
      options: mcqOptions(),
      key: z.strictObject({ optionId: optionId() }).optional(),
      skillKey: SkillKey,
      difficulty: Difficulty,
      media: mediaList().optional(),
      paramSpec: ParamSpec.optional(),
    })
    .refine(mcqKeyOk, { message: MCQ_KEY_MESSAGE }),
  z.strictObject({
    format: z.literal('written'),
    stem: stem(),
    rubricVersionId: uuid(),
    skillKey: SkillKey,
    difficulty: Difficulty,
    media: mediaList().optional(),
  }),
]);

export const BankItemDetail = z
  .strictObject({
    itemId: uuid(),
    itemVersionId: uuid(),
    versionNo: posInt(),
    workspaceId: uuid(),
    status: ItemStatus,
    origin: ItemOrigin,
    isParameterised: z.boolean(),
    librarySourced: z.boolean(),
    createdBy: uuid(),
    approvedBy: uuid().nullable(),
    approvedAt: time().nullable(),
    exposureCount: count(),
    content: DetailContent,
  })
  .superRefine((item, ctx) => {
    // A library copy (origin library) is library-sourced: its key is never shown (I-M1-5, security review).
    if (item.origin === 'library' && !item.librarySourced) {
      ctx.addIssue({
        code: 'custom',
        path: ['librarySourced'],
        message: 'a library copy is library-sourced',
      });
    }
    if (item.librarySourced && item.content.format === 'mcq') {
      if (item.content.key !== undefined || item.content.paramSpec !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['content'],
          message: 'a library-sourced key is never shown (I-M1-5)',
        });
      }
    }
    const approved = item.status === 'approved' || item.status === 'retired';
    if (
      (item.approvedBy === null) !== (item.approvedAt === null) ||
      approved !== (item.approvedBy !== null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['approvedBy'],
        message:
          'approvedBy and approvedAt are set exactly when the version is approved or retired',
      });
    }
  });
export type BankItemDetail = z.infer<typeof BankItemDetail>;

/** Library expert review (ABH-6, SEC-M1-4, R5-64 h): `POST …/bank/item-versions/:versionId/key-review` records the
 * caller as the answer-key reviewer of an in-review version of the `trace_library` org, in an update of its own,
 * before the approval. The reviewer is always the caller; the body id equals the path id (R5-54 a). */
export const KeyReviewItemRequest = z.strictObject({
  itemVersionId: uuid(),
});
export type KeyReviewItemRequest = z.infer<typeof KeyReviewItemRequest>;

/** Approve, or send back (`not_approved`, R5-22). */
export const ApproveItemRequest = z.strictObject({
  itemVersionId: uuid(),
  decision: z.enum(['approve', 'not_approved']),
});
export type ApproveItemRequest = z.infer<typeof ApproveItemRequest>;

/** `GET …/bank/items` filters (§6.2: format, skill, difficulty range, status, origin, pool). Query-string values
 * arrive as text; difficulties are coerced. The approval queue is `status=in_review`. */
export const BankItemListQuery = z
  .strictObject({
    format: ItemFormat.optional(),
    skillKey: SkillKey.optional(),
    difficultyMin: queryDifficulty().optional(),
    difficultyMax: queryDifficulty().optional(),
    status: ItemStatus.optional(),
    origin: ItemOrigin.optional(),
    poolId: uuid().optional(),
    cursor: cursor().optional(),
  })
  .refine(
    (q) =>
      q.difficultyMin === undefined ||
      q.difficultyMax === undefined ||
      q.difficultyMin <= q.difficultyMax,
    { message: 'difficultyMin cannot exceed difficultyMax' },
  );
export type BankItemListQuery = z.infer<typeof BankItemListQuery>;

/** One page of the bank list; `nextCursor` is null on the last page. */
export const BankItemListResponse = z.strictObject({
  items: z.array(BankItemSummary).max(PAGE_SIZE),
  nextCursor: cursor().nullable(),
});
export type BankItemListResponse = z.infer<typeof BankItemListResponse>;

/** 201 of `POST …/bank/items` and `POST …/bank/items/:itemId/versions`: the new version, always a draft (M1-2). */
export const BankItemCreateResponse = BankItemDetail.refine((item) => item.status === 'draft', {
  message: 'a created version is a draft',
  path: ['status'],
});
export type BankItemCreateResponse = z.infer<typeof BankItemCreateResponse>;

/** The ABH-7 share metric (§6.3) over approved `quant` items: `share = parameterised / approved`, null when none is
 * approved (no division by zero). Counts only; no item content. */
const shareMetric = () =>
  z
    .strictObject({
      quantItemsApproved: count(),
      quantItemsParameterised: count(),
      share: z.number().min(0).max(1).nullable(),
    })
    .superRefine((row, ctx) => {
      if (row.quantItemsParameterised > row.quantItemsApproved) {
        ctx.addIssue({
          code: 'custom',
          path: ['quantItemsParameterised'],
          message: 'parameterised items are a subset of the approved ones',
        });
      }
      const expected =
        row.quantItemsApproved === 0 ? null : row.quantItemsParameterised / row.quantItemsApproved;
      const same =
        expected === null || row.share === null
          ? expected === row.share
          : Math.abs(expected - row.share) < 1e-9;
      if (!same) {
        ctx.addIssue({
          code: 'custom',
          path: ['share'],
          message: 'share is parameterised / approved',
        });
      }
    });

/** `GET …/bank/stats` (§6.3): the caller's org and the Trace library; `library` is null when no library is served. */
export const BankStatsResponse = z.strictObject({
  org: shareMetric(),
  library: shareMetric().nullable(),
});
export type BankStatsResponse = z.infer<typeof BankStatsResponse>;

// ---- Pools and sections (§6.5) --------------------------------------------------------------------------------------

export const PoolRequest = z.strictObject({
  name: text(1, 120),
  format: ItemFormat,
  skillKey: SkillKey.optional(),
  workspaceId: uuid().optional(),
});
export type PoolRequest = z.infer<typeof PoolRequest>;

export const PoolDetail = z
  .strictObject({
    id: uuid(),
    name: z.string().min(1).max(120),
    format: ItemFormat,
    skillKey: SkillKey.nullable(),
    status: z.enum(['active', 'archived']),
    itemCount: count(),
    approvedCount: count(),
    usedByDraws: z.array(z.strictObject({ testId: uuid(), drawCount: posInt() })).max(50),
    usedByDrawsTotal: count(),
  })
  .refine((pool) => pool.approvedCount <= pool.itemCount, {
    message: 'approvedCount cannot exceed itemCount',
  })
  .refine((pool) => pool.usedByDraws.length <= pool.usedByDrawsTotal, {
    message: 'usedByDraws lists at most usedByDrawsTotal draws',
    path: ['usedByDrawsTotal'],
  });
export type PoolDetail = z.infer<typeof PoolDetail>;

/** `GET …/pools` query: a page cursor only. */
export const PoolListQuery = z.strictObject({ cursor: cursor().optional() });
export type PoolListQuery = z.infer<typeof PoolListQuery>;

/** One page of the org's pools; `nextCursor` is null on the last page. */
export const PoolListResponse = z
  .strictObject({ pools: z.array(PoolDetail).max(PAGE_SIZE), nextCursor: cursor().nullable() })
  .refine((res) => uniqueBy(res.pools, (p) => p.id), {
    message: 'pool ids must be distinct',
    path: ['pools'],
  });
export type PoolListResponse = z.infer<typeof PoolListResponse>;

/** `POST/DELETE …/pools/:id/items`: the item versions to add or remove (the guard requires approved, same format). */
export const PoolItemsRequest = z.strictObject({ itemVersionIds: idBatch() });
export type PoolItemsRequest = z.infer<typeof PoolItemsRequest>;

const Stratum = z.strictObject({
  skillKey: SkillKey,
  difficultyBand: difficultyBand(),
  count: posInt(),
});

// D1's inline item (UpdateTestDraftRequest), reused as is: an inline section is D1 mode.
const D1DraftItem = UpdateTestDraftRequest.shape.sections.element.shape.items.element;

/**
 * D1's section (format, name, weight, inline items) plus the M1 fields. `inline` serves its own items; `pool` draws
 * `drawCount` from a pool and has no inline items. Written sections are forward-only and alone take a paste rule
 * (sections CHECKs, §3.3). A half-written section is valid; publish validates the content.
 */
export const SectionDraft = z
  .strictObject({
    mode: z.enum(['inline', 'pool']),
    format: ItemFormat,
    name: text(1, 120),
    weight: z.int().min(1).max(100),
    items: z.array(D1DraftItem.refine(deepStorable, { message: 'unstorable_text' })).max(200),
    poolId: uuid().optional(),
    drawCount: z.int().min(1).max(100).optional(),
    shuffleItems: z.boolean(),
    shuffleOptions: z.boolean(),
    navigation: z.enum(['free', 'forward_only']).nullable(),
    pasteRule: z.enum(['blocked', 'allowed_logged']).optional(),
    timeLimitSeconds: z.int().min(60).max(7200).optional(),
    blueprint: z.strictObject({ strata: z.array(Stratum).min(1).max(20) }).optional(),
  })
  .superRefine((section, ctx) => sectionChecks(section, ctx));
export type SectionDraft = z.infer<typeof SectionDraft>;

/** The section rules of SectionDraft, shared with the draft read-model (TestDraftView). `navigation` null is a D1
 * section (package v1, R2-1): both the view and the request carry it only for an inline, unshuffled section with no
 * paste rule, so a D1 draft round-trips unchanged (the v2 publish guard refuses null). */
function sectionChecks(
  section: {
    mode: 'inline' | 'pool';
    format: ItemFormat;
    items: readonly { format: ItemFormat }[];
    poolId?: string | undefined;
    drawCount?: number | undefined;
    navigation: 'free' | 'forward_only' | null;
    shuffleItems: boolean;
    shuffleOptions: boolean;
    pasteRule?: string | undefined;
    blueprint?:
      | { strata: readonly { skillKey: string; difficultyBand: number; count: number }[] }
      | undefined;
  },
  ctx: z.core.$RefinementCtx,
): void {
  const issue = (path: string, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  if (section.mode === 'inline') {
    if (
      section.poolId !== undefined ||
      section.drawCount !== undefined ||
      section.blueprint !== undefined
    ) {
      issue('mode', 'an inline section has no pool, draw count or blueprint');
    }
  } else {
    if (section.poolId === undefined || section.drawCount === undefined) {
      issue('mode', 'a pool section needs a pool and a draw count');
    }
    if (section.items.length > 0) issue('items', 'a pool section has no inline items');
  }
  // navigation null (the sections column allows it, R2-1) is a D1 section, package v1: it uses no M1 feature, so a D1
  // draft read and saved back keeps its D1 behaviour (publish guard v2 refuses null navigation in a version 2 test).
  if (
    section.navigation === null &&
    (section.mode !== 'inline' ||
      section.shuffleItems ||
      section.shuffleOptions ||
      section.pasteRule !== undefined)
  ) {
    issue('navigation', 'navigation null is a D1 section: inline, unshuffled, no paste rule');
  }
  if (section.format === 'written' && section.navigation === 'free') {
    issue('navigation', 'a written section is forward-only');
  }
  if (section.pasteRule !== undefined && section.format !== 'written') {
    issue('pasteRule', 'only a written section takes a paste rule');
  }
  section.items.forEach((item, i) => {
    if (item.format !== section.format) {
      ctx.addIssue({
        code: 'custom',
        path: ['items', i, 'format'],
        message: 'item format differs from its section',
      });
    }
  });
  if (section.blueprint !== undefined && section.drawCount !== undefined) {
    const total = section.blueprint.strata.reduce((n, s) => n + s.count, 0);
    if (total !== section.drawCount) issue('blueprint', 'the strata must add up to the draw count');
  }
  if (section.blueprint !== undefined) {
    const pairs = section.blueprint.strata.map((s) => `${s.skillKey}:${s.difficultyBand}`);
    if (new Set(pairs).size !== pairs.length) {
      issue('blueprint', 'one stratum per skill and difficulty band');
    }
  }
}

/**
 * Replaces a draft's sections, inline items, keys and settings (`public.save_test_draft`). Supersedes D1's
 * UpdateTestDraftRequest for M1 tests (D1's request stays valid and maps to inline mode). `qualityCutoff` is required
 * as in D1 (L-15); M1 does not change the cutoff (§6.8).
 */
export const SaveTestDraftRequest = z
  .strictObject({
    name: text(1, 200),
    durationMinutes: z.int().min(5).max(120),
    qualityCutoff: z.int().min(0).max(100),
    sections: z.array(SectionDraft).max(10),
  })
  .refine((draft) => draft.sections.reduce((n, s) => n + s.items.length, 0) <= 200, {
    message: 'at most 200 inline items',
    path: ['sections'],
  });
export type SaveTestDraftRequest = z.infer<typeof SaveTestDraftRequest>;

// D1's editor item (TestDetailResponse: id, position, content, key) and version status, reused as is.
const D1DetailVersion = TestDetailResponse.shape.version;
const D1DetailItem = D1DetailVersion.shape.sections.element.shape.items.element;

/** A stored section as the editor reads it: SectionDraft plus its id and position, items with theirs. */
const SectionView = z
  .strictObject({
    ...SectionDraft.shape,
    id: uuid(),
    position: posInt(),
    items: z.array(D1DetailItem).max(200),
  })
  .superRefine((section, ctx) => sectionChecks(section, ctx));

/**
 * The draft read-model (`GET …/tests/:testId`; also the 201 of `POST …/tests/:testId/versions`): the GET counterpart
 * of SaveTestDraftRequest, which it round-trips (drop `id` and `position` from sections and items). Org-side only: it
 * carries inline answer keys, as D1's TestDetailResponse. Integrity settings are not here: they have their own route
 * (`GET …/tests/:testId/integrity`, IntegritySettingsView). `workspaceId` scopes the pool picker (R2-9 fences).
 */
export const TestDraftView = z.strictObject({
  test: z.strictObject({
    id: uuid(),
    workspaceId: uuid(),
    name: z.string().min(1).max(200),
    createdAt: time(),
  }),
  version: z
    .strictObject({
      id: uuid(),
      versionNo: posInt(),
      status: D1DetailVersion.shape.status,
      durationMinutes: z.int().min(1).max(120),
      qualityCutoff: z.int().min(0).max(100),
      publishedAt: time().nullable(),
      sections: z.array(SectionView).max(10),
    })
    .superRefine((version, ctx) => {
      const issue = (message: string) =>
        ctx.addIssue({ code: 'custom', path: ['sections'], message });
      if ((version.status === 'draft') !== (version.publishedAt === null)) {
        ctx.addIssue({
          code: 'custom',
          path: ['publishedAt'],
          message: 'publishedAt is set exactly when the version is not a draft',
        });
      }
      if (!uniqueBy(version.sections, (s) => s.id)) issue('section ids must be distinct');
      if (!uniqueBy(version.sections, (s) => s.position))
        issue('section positions must be distinct');
      if (version.sections.reduce((n, s) => n + s.items.length, 0) > 200) {
        issue('at most 200 inline items');
      }
    }),
});
export type TestDraftView = z.infer<typeof TestDraftView>;

// ---- Integrity settings (§6.6, screen 04) --------------------------------------------------------------------------

/**
 * The full settings map of the catalog: every setting, each from its own value list. `presetKey` is null for custom
 * settings (ruleset_versions.preset_key null; audited as test.integrity_settings {preset_key: null}).
 */
export const IntegritySettingsRequest = z.strictObject({
  presetKey: PresetKey.nullable(),
  values: settingValues(),
});
export type IntegritySettingsRequest = z.infer<typeof IntegritySettingsRequest>;

export const IntegritySettingsView = z
  .strictObject({
    presetKey: PresetKey.nullable(),
    values: settingValues(),
    locked: z.strictObject(
      Object.fromEntries(
        SETTING_KEYS.map((key) => [key, z.enum(['admin', 'always']).optional()]),
      ) as {
        [K in SettingKeyName]: z.ZodOptional<z.ZodEnum<{ admin: 'admin'; always: 'always' }>>;
      },
    ),
    candidateSummary: z.array(z.string().min(1).max(300)).max(20),
    /** True iff the version has stored settings (else `values` are D1's equivalents); R5-70 d. */
    stored: z.boolean(),
  })
  .superRefine((view, ctx) => {
    for (const key of SETTING_KEYS) {
      const always = ALWAYS_LOCKED_SETTINGS.includes(key);
      const lock = view.locked[key];
      if (always ? lock !== 'always' : lock === 'always') {
        ctx.addIssue({
          code: 'custom',
          path: ['locked', key],
          message: 'always-locked settings, and only they, are locked as always',
        });
      }
    }
  });
export type IntegritySettingsView = z.infer<typeof IntegritySettingsView>;

// ---- Admin locks (§6.6, screen 04; org_integrity_locks) --------------------------------------------------------

/** A lock names a lockable setting (never an always-locked one, M1-14) and one of that setting's own values. */
const lockOk = (
  lock: { settingKey: SettingKey; lockedValue: string },
  ctx: z.core.$RefinementCtx,
): void => {
  if (ALWAYS_LOCKED_SETTINGS.includes(lock.settingKey)) {
    ctx.addIssue({
      code: 'custom',
      path: ['settingKey'],
      message: 'an always-locked setting takes no lock row',
    });
  } else if (
    !(INTEGRITY_SETTING_VALUES[lock.settingKey] as readonly string[]).includes(lock.lockedValue)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['lockedValue'],
      message: 'not a value of this setting',
    });
  }
};
const lockedValue = () => z.string().min(1).max(40);
const LOCKABLE_SETTING_COUNT = SETTING_KEYS.length - ALWAYS_LOCKED_SETTINGS.length;

/** `POST …/settings/integrity-locks` (admin, aal2). The api answers the stored IntegrityLockView (201). */
export const IntegrityLockCreateRequest = z
  .strictObject({ settingKey: SettingKey, lockedValue: lockedValue() })
  .superRefine(lockOk);
export type IntegrityLockCreateRequest = z.infer<typeof IntegrityLockCreateRequest>;

export const IntegrityLockView = z
  .strictObject({
    id: uuid(),
    settingKey: SettingKey,
    lockedValue: lockedValue(),
    lockedBy: uuid().nullable(),
    lockedAt: time(),
  })
  .superRefine(lockOk);
export type IntegrityLockView = z.infer<typeof IntegrityLockView>;

/** `GET …/settings/integrity-locks`: at most one lock per lockable setting (unique (org_id, setting_key)). */
export const IntegrityLockListResponse = z
  .strictObject({ locks: z.array(IntegrityLockView).max(LOCKABLE_SETTING_COUNT) })
  .refine((res) => uniqueBy(res.locks, (l) => l.settingKey), {
    message: 'one lock per setting',
    path: ['locks'],
  });
export type IntegrityLockListResponse = z.infer<typeof IntegrityLockListResponse>;

// ---- Role templates and JD -> blueprint (§6.1) ---------------------------------------------------------------------

const TemplateKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);

/** A blueprint section (private.blueprint_valid). Only formats servable in M1 may be available (M1-16). */
const BlueprintSection = z
  .strictObject({
    title: z.string().min(1).max(120),
    format: z.enum(['mcq', 'written', 'typing', 'voice']),
    skillKey: SkillKey,
    drawCount: z.int().min(1).max(100),
    available: z.boolean(),
  })
  .refine((s) => !s.available || s.format === 'mcq' || s.format === 'written', {
    message: 'only mcq and written sections are available in M1',
  });

export const RoleTemplateSummary = z.strictObject({
  templateKey: TemplateKey,
  version: posInt(),
  name: z.string().min(1).max(120),
  presetKey: PresetKey,
});
export type RoleTemplateSummary = z.infer<typeof RoleTemplateSummary>;

/** `matchPermille` = |JD tokens ∩ keywords| / |keywords| in permille (R5-29: no score field). Carries no JD text. */
export const BlueprintProposal = z.strictObject({
  templateKey: TemplateKey,
  version: posInt(),
  matchPermille: z.int().min(0).max(1000),
  sections: z.array(BlueprintSection).min(1).max(10),
});
export type BlueprintProposal = z.infer<typeof BlueprintProposal>;

/** The JD is matched deterministically and never stored, logged or sent to a model (E19). */
export const BlueprintProposeRequest = z.strictObject({ jdText: text(1, 50000) });
export type BlueprintProposeRequest = z.infer<typeof BlueprintProposeRequest>;
/** `null` when no template reaches the threshold ("Pick a template"). */
export const BlueprintProposeResponse = z.strictObject({ proposal: BlueprintProposal.nullable() });
export type BlueprintProposeResponse = z.infer<typeof BlueprintProposeResponse>;

export const CreateTestFromTemplateRequest = z.strictObject({
  jobTitle: text(1, 200),
  templateKey: TemplateKey,
  templateVersion: posInt(),
  jdText: text(0, 50000).optional(),
  workspaceId: uuid().optional(),
});
export type CreateTestFromTemplateRequest = z.infer<typeof CreateTestFromTemplateRequest>;

/**
 * 201 of `POST …/tests/from-template`: the new draft and the blueprint sections skipped because their format is not
 * servable yet (M1-16, E18: "skipped when the draft is created, with a visible note").
 */
export const CreateTestFromTemplateResponse = z.strictObject({
  draft: TestDraftView.refine((view) => view.version.status === 'draft', {
    message: 'a template creates a draft',
  }),
  skippedSections: z
    .array(
      z.strictObject({
        title: z.string().min(1).max(120),
        // R5-71 i: typing and voice (not servable in M1), and an own template's mcq or written section marked
        // `available: false` (M1-16, E18).
        format: z.enum(['mcq', 'written', 'typing', 'voice']),
      }),
    )
    .max(10),
});
export type CreateTestFromTemplateResponse = z.infer<typeof CreateTestFromTemplateResponse>;

/** `GET …/templates`: the published templates the caller may use. */
/** `GET …/templates` query: a page cursor only. */
export const RoleTemplateListQuery = z.strictObject({ cursor: cursor().optional() });
export type RoleTemplateListQuery = z.infer<typeof RoleTemplateListQuery>;

/** One page of templates; `nextCursor` is null on the last page. */
export const RoleTemplateListResponse = z
  .strictObject({
    templates: z.array(RoleTemplateSummary).max(PAGE_SIZE),
    nextCursor: cursor().nullable(),
  })
  .refine((res) => uniqueBy(res.templates, (t) => `${t.templateKey}:${t.version}`), {
    message: 'one row per template key and version',
    path: ['templates'],
  });
export type RoleTemplateListResponse = z.infer<typeof RoleTemplateListResponse>;

// ---- Import (§4.3, §6.9) --------------------------------------------------------------------------------------------

const OPTION_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const importImageOk = (row: { imageSha256?: string | undefined; imageAlt?: string | undefined }) =>
  (row.imageSha256 === undefined) === (row.imageAlt === undefined);
const IMAGE_MESSAGE = 'an image and its alt text come together';
/** Row 1 is the header; a job holds at most 2,000 rows. */
const rowNo = () => z.int().min(2).max(2001);
const RubricKey = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const ImportRow = z.discriminatedUnion('format', [
  z
    .strictObject({
      rowNo: rowNo(),
      format: z.literal('mcq'),
      skillKey: SkillKey,
      difficulty: Difficulty,
      stem: stem(),
      options: z.array(text(1, 500)).min(2).max(6),
      correct: z.enum(OPTION_LETTERS),
      imageSha256: sha256().optional(),
      imageAlt: text(1, 300).optional(),
      paramSpec: ParamSpec.optional(),
    })
    .refine((row) => OPTION_LETTERS.indexOf(row.correct) < row.options.length, {
      message: 'the correct letter names no option',
      path: ['correct'],
    })
    .refine(importImageOk, { message: IMAGE_MESSAGE }),
  z
    .strictObject({
      rowNo: rowNo(),
      format: z.literal('written'),
      skillKey: SkillKey,
      difficulty: Difficulty,
      stem: stem(),
      rubricKey: RubricKey,
      imageSha256: sha256().optional(),
      imageAlt: text(1, 300).optional(),
    })
    .refine(importImageOk, { message: IMAGE_MESSAGE }),
]);
export type ImportRow = z.infer<typeof ImportRow>;

export const ImportJobCreateRequest = z.strictObject({
  sourceKind: z.enum(['xlsx', 'docx']),
  templateVersion: z.enum(['trace-items-v1']),
  workspaceId: uuid().optional(),
});
export type ImportJobCreateRequest = z.infer<typeof ImportJobCreateRequest>;

/** An import job holds at most 2,000 rows and 2,000 images (import_jobs CHECKs, §4.3, R2-19). */
const importCount = () => z.int().min(0).max(2000);

/**
 * An import job (`GET …/imports/:id`; `POST …/imports/:id/complete` and `…/cancel` answer it too). Counts are written
 * by the database when the job ends (0 while open or validating). Ids, enums and counts only: no file name, cell
 * value or message (§3.2). Per-row errors are returned by each rows batch (ImportRowsResponse).
 */
export const ImportJobView = z
  .strictObject({
    id: uuid(),
    workspaceId: uuid(),
    sourceKind: ImportJobCreateRequest.shape.sourceKind,
    templateVersion: ImportJobCreateRequest.shape.templateVersion,
    status: ImportJobStatus,
    rowsTotal: importCount(),
    rowsOk: count(),
    rowsError: count(),
    imagesOk: importCount(),
    errorCode: ImportJobErrorCode.optional(),
    createdAt: time(),
    completedAt: time().nullable(),
  })
  .superRefine((job, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (job.rowsOk + job.rowsError !== job.rowsTotal) {
      issue('rowsTotal', 'rowsOk + rowsError equals rowsTotal');
    }
    if ((job.status === 'failed') !== (job.errorCode !== undefined)) {
      issue('errorCode', 'a job has an error code exactly when it failed');
    }
    const ended =
      job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed';
    if (ended !== (job.completedAt !== null)) {
      issue('completedAt', 'completedAt is set exactly when the job has ended');
    }
  });
export type ImportJobView = z.infer<typeof ImportJobView>;

/** 201 of `POST …/imports`: the new job, open. */
export const ImportJobCreateResponse = ImportJobView.refine((job) => job.status === 'open', {
  message: 'a new import job is open',
  path: ['status'],
});
export type ImportJobCreateResponse = z.infer<typeof ImportJobCreateResponse>;

export const ImportRowsRequest = z
  .strictObject({ rows: z.array(ImportRow).min(1).max(100) })
  .refine((req) => uniqueBy(req.rows, (row) => row.rowNo), {
    message: 'row numbers must be distinct',
    path: ['rows'],
  });
export type ImportRowsRequest = z.infer<typeof ImportRowsRequest>;

/** The template column a row error points at (trace-items-v1 header), `options` for the option set as a whole, or
 * `row` for the whole row (import_row_errors.field, M1-c). */
export const ImportField = z.enum([
  'row',
  'format',
  'skill',
  'difficulty',
  'stem',
  'options',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'option_e',
  'option_f',
  'correct',
  'rubric_key',
  'image_file',
  'image_alt',
  'param_spec_json',
]);

/** Errors name the row, the column and a §4.3 code; never a cell value (import_row_errors has no free text). */
export const ImportRowsResponse = z.strictObject({
  accepted: z.int().min(0).max(100),
  errors: z
    .array(z.strictObject({ rowNo: rowNo(), field: ImportField, code: ImportErrorCode }))
    .max(1600),
});
export type ImportRowsResponse = z.infer<typeof ImportRowsResponse>;

export const ImportImagePutResponse = z.strictObject({ key: ItemMedia.shape.key });
export type ImportImagePutResponse = z.infer<typeof ImportImagePutResponse>;

// ---- AI drafting (§6.4) ---------------------------------------------------------------------------------------------

/** The topic is scrubbed and travels in the queue message only (never stored, §3.2). */
export const AiDraftRequest = z.strictObject({
  format: ItemFormat,
  skillKey: SkillKey,
  difficulty: Difficulty,
  count: z.int().min(1).max(10),
  topic: text(1, 500),
  workspaceId: uuid().optional(),
});
export type AiDraftRequest = z.infer<typeof AiDraftRequest>;

export const AiDraftJobView = z
  .strictObject({
    id: uuid(),
    status: AiDraftJobStatus,
    format: ItemFormat,
    skillKey: SkillKey,
    difficulty: Difficulty,
    count: z.int().min(1).max(10),
    draftsCreated: count(),
    errorCode: AiDraftErrorCode.optional(),
  })
  .refine((job) => job.draftsCreated <= job.count, {
    message: 'draftsCreated cannot exceed count',
  });
export type AiDraftJobView = z.infer<typeof AiDraftJobView>;

// ---- Library (§6.2; AT-M1-22) ---------------------------------------------------------------------------------------

/** Query-string values arrive as text; difficulties are coerced. */
export const LibraryBrowseQuery = z
  .strictObject({
    skillKey: SkillKey.optional(),
    format: ItemFormat.optional(),
    difficultyMin: queryDifficulty().optional(),
    difficultyMax: queryDifficulty().optional(),
    cursor: cursor().optional(),
  })
  .refine(
    (q) =>
      q.difficultyMin === undefined ||
      q.difficultyMax === undefined ||
      q.difficultyMin <= q.difficultyMax,
    { message: 'difficultyMin cannot exceed difficultyMax' },
  );
export type LibraryBrowseQuery = z.infer<typeof LibraryBrowseQuery>;

/** An approved library item as a customer browses it. No key field exists in this type (I-M1-5). */
export const LibraryItemCard = z
  .strictObject({
    libraryItemVersionId: uuid(),
    format: ItemFormat,
    skillKey: SkillKey,
    difficulty: Difficulty,
    stem: stem(),
    options: z.array(z.string().min(1).max(500)).min(2).max(6).optional(),
    isParameterised: z.boolean(),
  })
  .refine((card) => (card.format === 'mcq') === (card.options !== undefined), {
    message: 'options belong to mcq cards only',
  });
export type LibraryItemCard = z.infer<typeof LibraryItemCard>;

/** One page of `GET …/library/items`; `nextCursor` is null on the last page. No key field (I-M1-5). */
export const LibraryBrowseResponse = z.strictObject({
  items: z.array(LibraryItemCard).max(PAGE_SIZE),
  nextCursor: cursor().nullable(),
});
export type LibraryBrowseResponse = z.infer<typeof LibraryBrowseResponse>;

/** `POST …/library/copy` (a `library_copy_requests` insert, R2-5): approved library versions to copy into the
 * caller's workspace (absent = the org's default workspace, RLS decides). Over the daily cap: 429 `library_cap` (E8). */
export const LibraryCopyRequest = z.strictObject({
  libraryItemVersionIds: idBatch(),
  workspaceId: uuid().optional(),
});
export type LibraryCopyRequest = z.infer<typeof LibraryCopyRequest>;

/** The local item version ids (`result_item_version_ids`), in request order; reused copies included (R3-8). */
export const LibraryCopyResponse = z.strictObject({ itemVersionIds: idBatch() });
export type LibraryCopyResponse = z.infer<typeof LibraryCopyResponse>;

// ---- Members (§4.5) -------------------------------------------------------------------------------------------------

/** The address travels in the queue message only; member_invites stores its HMAC (R2-14). */
export const MemberInviteRequest = z.strictObject({
  email: z.email().max(254),
  roles: z
    .array(OrgRole)
    .min(1)
    .max(5)
    .refine((roles) => new Set(roles).size === roles.length, { message: 'duplicate role' }),
  workspaceId: uuid().optional(),
  displayName: text(1, 120),
});
export type MemberInviteRequest = z.infer<typeof MemberInviteRequest>;

/**
 * The trace-authoring queue message (§6.4, R5-13; Wave 2 lead scaffolding): services/api enqueues it after inserting
 * the ai_draft_jobs row, with the topic already scrubbed (`scrubDraftTopic`, `@trace/shared/item-hash`);
 * workers/jobs (role trace_authoring_worker) consumes it. It carries no person's data.
 */
export const AuthoringQueueMessage = z.strictObject({
  v: z.literal(1),
  kind: z.literal('ai_draft'),
  jobId: uuid(),
  orgId: uuid(),
  workspaceId: uuid(),
  format: ItemFormat,
  skillKey: SkillKey,
  difficulty: Difficulty,
  count: z.int().min(1).max(10),
  topic: text(1, 500),
});
export type AuthoringQueueMessage = z.infer<typeof AuthoringQueueMessage>;

/**
 * The trace-admin queue message (M1-20, R5-12, R5-13; Wave 2 lead scaffolding). member_invites stores only the email's
 * HMAC, so the message carries the address once for the Auth admin API; the job checks HMAC(email, pepper) against
 * the invite row before it creates the user, and never logs the address. Roles and workspace live on the invite row.
 */
export const AdminQueueMessage = z.strictObject({
  v: z.literal(1),
  kind: z.literal('member_invite'),
  inviteId: uuid(),
  orgId: uuid(),
  email: z.email().max(254),
  displayName: text(1, 120),
});
export type AdminQueueMessage = z.infer<typeof AdminQueueMessage>;

const inviteRoles = () =>
  z
    .array(OrgRole)
    .min(1)
    .max(5)
    .refine((roles) => new Set(roles).size === roles.length, { message: 'duplicate role' });

/**
 * A stored invite (`member_invites`) as an admin lists it. No address, HMAC or name exists in the type (R2-14: the
 * address travels in the queue message only; the display name is stored on the membership once provisioned).
 */
export const MemberInviteView = z
  .strictObject({
    id: uuid(),
    roles: inviteRoles(),
    workspaceId: uuid().nullable(),
    status: MemberInviteStatus,
    membershipId: uuid().nullable(),
    invitedBy: uuid().nullable(),
    createdAt: time(),
  })
  .superRefine((invite, ctx) => {
    if ((invite.status === 'provisioned') !== (invite.membershipId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['membershipId'],
        message: 'an invite names its membership exactly when it is provisioned',
      });
    }
    if (
      invite.workspaceId !== null &&
      invite.roles.some((role) => role === 'org_owner' || role === 'admin')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['workspaceId'],
        message: 'owners and admins are org-wide (D16b)',
      });
    }
  });
export type MemberInviteView = z.infer<typeof MemberInviteView>;

/** 201 of `POST …/members/invites`: the new invite, pending. */
export const MemberInviteCreateResponse = MemberInviteView.refine(
  (invite) => invite.status === 'pending',
  { message: 'a new invite is pending', path: ['status'] },
);
export type MemberInviteCreateResponse = z.infer<typeof MemberInviteCreateResponse>;

/** `GET …/members/invites` query: a page cursor only (no address lookup exists). */
export const MemberInviteListQuery = z.strictObject({ cursor: cursor().optional() });
export type MemberInviteListQuery = z.infer<typeof MemberInviteListQuery>;

/** One page of invites, newest first; `nextCursor` is null on the last page. */
export const MemberInviteListResponse = z.strictObject({
  invites: z.array(MemberInviteView).max(PAGE_SIZE),
  nextCursor: cursor().nullable(),
});
export type MemberInviteListResponse = z.infer<typeof MemberInviteListResponse>;
