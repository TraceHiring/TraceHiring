// M1 authoring contracts (specs/m1-test-authoring.md §5; value lists from §3.2, §4.3-§4.5, §6.6 and migration M1-a).
// Every object schema is strict: an unknown key fails. Nothing here carries a score, band, grade or outcome (rule 1,
// R5-29), and nothing sent to a library browser carries an answer key (I-M1-5). Recruiter-side only: the candidate
// shapes (package v2, session view v2) live in contracts-candidate.ts.
import { z } from 'zod';
import { UpdateTestDraftRequest } from './contracts-d1.js';
import { OrgRole } from './contracts-tenancy.js';

// Small factories, so each schema gets its own node.
const uuid = () => z.uuid();
const time = () => z.iso.datetime({ offset: true });
const sha256 = () => z.string().regex(/^[0-9a-f]{64}$/);
const posInt = () => z.int().min(1);
const count = () => z.int().min(0);
/** Option ids are short author-chosen strings (item_versions.options, 1..64 chars, as D1). */
const optionId = () => z.string().min(1).max(64);
/** A constant lower-snake code (never free text), as D1's ApiError. */
const code = () => z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const uniqueBy = <T>(rows: readonly T[], key: (row: T) => unknown) =>
  new Set(rows.map(key)).size === rows.length;

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

/** A content-addressed item image (`item-media/{org}/{sha256}.{ext}`) and its required alt text. */
export const ItemMedia = z.strictObject({
  key: z.string().regex(/^item-media\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(png|jpg|webp)$/),
  alt: z.string().min(1).max(300),
});
export type ItemMedia = z.infer<typeof ItemMedia>;
const mediaList = () => z.array(ItemMedia).min(1).max(4);

const ParamName = z.string().regex(/^[a-z][a-z0-9_]{0,15}$/);
/** An expression of the §6.3 grammar; `packages/item-variants` parses it. */
const Expr = z.string().min(1).max(200);
const ParamDef = z.discriminatedUnion('kind', [
  z
    .strictObject({ kind: z.literal('int'), min: z.int(), max: z.int(), step: posInt() })
    .refine((p) => p.min <= p.max, { message: 'min must not exceed max' }),
  z.strictObject({
    kind: z.literal('choice'),
    values: z
      .array(z.union([z.int(), z.string().min(1).max(100)]))
      .min(1)
      .max(20),
  }),
]);

export const ParamSpec = z
  .strictObject({
    params: z.record(ParamName, ParamDef),
    derived: z.record(ParamName, Expr),
    constraints: z.array(Expr).max(8),
    stem: z.string().min(1).max(4000),
    options: z
      .array(z.strictObject({ id: optionId(), text: z.string().min(1).max(500) }))
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
    .array(z.strictObject({ id: optionId(), text: z.string().min(1).max(500) }))
    .min(2)
    .max(6);
const stem = () => z.string().min(1).max(4000);
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

/** Approve, or send back (`not_approved`, R5-22). */
export const ApproveItemRequest = z.strictObject({
  itemVersionId: uuid(),
  decision: z.enum(['approve', 'not_approved']),
});
export type ApproveItemRequest = z.infer<typeof ApproveItemRequest>;

// ---- Pools and sections (§6.5) --------------------------------------------------------------------------------------

export const PoolRequest = z.strictObject({
  name: z.string().min(1).max(120),
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
    usedByDraws: z.array(z.strictObject({ testId: uuid(), drawCount: posInt() })),
  })
  .refine((pool) => pool.approvedCount <= pool.itemCount, {
    message: 'approvedCount cannot exceed itemCount',
  });
export type PoolDetail = z.infer<typeof PoolDetail>;

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
    name: z.string().min(1).max(120),
    weight: z.int().min(1).max(100),
    items: z.array(D1DraftItem).max(200),
    poolId: uuid().optional(),
    drawCount: z.int().min(1).max(100).optional(),
    shuffleItems: z.boolean(),
    shuffleOptions: z.boolean(),
    navigation: z.enum(['free', 'forward_only']),
    pasteRule: z.enum(['blocked', 'allowed_logged']).optional(),
    timeLimitSeconds: z.int().min(60).max(7200).optional(),
    blueprint: z.strictObject({ strata: z.array(Stratum).min(1).max(20) }).optional(),
  })
  .superRefine((section, ctx) => {
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
    if (section.format === 'written' && section.navigation !== 'forward_only') {
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
      if (total !== section.drawCount)
        issue('blueprint', 'the strata must add up to the draw count');
    }
    if (section.blueprint !== undefined) {
      const pairs = section.blueprint.strata.map((s) => `${s.skillKey}:${s.difficultyBand}`);
      if (new Set(pairs).size !== pairs.length) {
        issue('blueprint', 'one stratum per skill and difficulty band');
      }
    }
  });
export type SectionDraft = z.infer<typeof SectionDraft>;

/**
 * Replaces a draft's sections, inline items, keys and settings (`public.save_test_draft`). Supersedes D1's
 * UpdateTestDraftRequest for M1 tests (D1's request stays valid and maps to inline mode). `qualityCutoff` is required
 * as in D1 (L-15); M1 does not change the cutoff (§6.8).
 */
export const SaveTestDraftRequest = z
  .strictObject({
    name: z.string().min(1).max(200),
    durationMinutes: z.int().min(5).max(120),
    qualityCutoff: z.int().min(0).max(100),
    sections: z.array(SectionDraft).max(10),
  })
  .refine((draft) => draft.sections.reduce((n, s) => n + s.items.length, 0) <= 200, {
    message: 'at most 200 inline items',
    path: ['sections'],
  });
export type SaveTestDraftRequest = z.infer<typeof SaveTestDraftRequest>;

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
export const BlueprintProposeRequest = z.strictObject({ jdText: z.string().min(1).max(50000) });
export type BlueprintProposeRequest = z.infer<typeof BlueprintProposeRequest>;
/** `null` when no template reaches the threshold ("Pick a template"). */
export const BlueprintProposeResponse = z.strictObject({ proposal: BlueprintProposal.nullable() });
export type BlueprintProposeResponse = z.infer<typeof BlueprintProposeResponse>;

export const CreateTestFromTemplateRequest = z.strictObject({
  jobTitle: z.string().min(1).max(200),
  templateKey: TemplateKey,
  templateVersion: posInt(),
  jdText: z.string().max(50000).optional(),
  workspaceId: uuid().optional(),
});
export type CreateTestFromTemplateRequest = z.infer<typeof CreateTestFromTemplateRequest>;

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
      options: z.array(z.string().min(1).max(500)).min(2).max(6),
      correct: z.enum(OPTION_LETTERS),
      imageSha256: sha256().optional(),
      imageAlt: z.string().min(1).max(300).optional(),
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
      imageAlt: z.string().min(1).max(300).optional(),
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

export const ImportRowsRequest = z
  .strictObject({ rows: z.array(ImportRow).min(1).max(100) })
  .refine((req) => uniqueBy(req.rows, (row) => row.rowNo), {
    message: 'row numbers must be distinct',
    path: ['rows'],
  });
export type ImportRowsRequest = z.infer<typeof ImportRowsRequest>;

/** The template column a row error points at (trace-items-v1 header), or `row` for the whole row. */
const ImportField = z.enum([
  'row',
  'format',
  'skill',
  'difficulty',
  'stem',
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

/** Text Postgres and the queue can carry: no U+0000 and no lone UTF-16 surrogate. */
const storable = (s: string) =>
  !s.includes('\u0000') &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

/** The topic is scrubbed and travels in the queue message only (never stored, §3.2). */
export const AiDraftRequest = z.strictObject({
  format: ItemFormat,
  skillKey: SkillKey,
  difficulty: Difficulty,
  count: z.int().min(1).max(10),
  topic: z.string().min(1).max(500).refine(storable, { message: 'unstorable_text' }),
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
    errorCode: code().optional(),
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
    difficultyMin: z.coerce.number().min(0).max(1).optional(),
    difficultyMax: z.coerce.number().min(0).max(1).optional(),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,200}$/)
      .optional(),
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
  displayName: z.string().min(1).max(120),
});
export type MemberInviteRequest = z.infer<typeof MemberInviteRequest>;
