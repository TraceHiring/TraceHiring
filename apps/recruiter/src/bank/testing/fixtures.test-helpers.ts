// Synthetic bank, pool, library and AI-draft data for the M1 screens' tests. Every text is labelled synthetic; no
// personal data (CLAUDE.md: synthetic data only).
import {
  encodePageCursor,
  type AiDraftJobView,
  type BankItemDetail,
  type BankItemSummary,
  type BankStatsResponse,
  type LibraryItemCard,
  type PoolDetail,
} from '@trace/shared/contracts/m1';

export const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const TIME = '2026-10-20T09:30:00.000Z';

/** A valid page cursor for the n-th row. */
export const cursorFor = (n: number): string => encodePageCursor({ createdAt: TIME, id: uid(n) });

export function summary(n: number, patch: Partial<BankItemSummary> = {}): BankItemSummary {
  return {
    itemId: uid(1000 + n),
    itemVersionId: uid(2000 + n),
    versionNo: 1,
    workspaceId: uid(3),
    format: 'mcq',
    skillKey: 'quant',
    difficulty: 0.4,
    status: 'approved',
    origin: 'human',
    stemPreview: `[synthetic] Stem preview ${n}`,
    isParameterised: false,
    exposureCount: n,
    createdAt: TIME,
    ...patch,
  };
}

export const MEDIA_KEY = `item-media/${uid(1)}/${'a'.repeat(64)}.png`;

/** An MCQ detail; `patch` overrides top-level fields, `content` the content. */
export function mcqDetail(
  n: number,
  patch: Partial<BankItemDetail> = {},
  content: Record<string, unknown> = {},
): BankItemDetail {
  const status = patch.status ?? 'draft';
  const approved = status === 'approved' || status === 'retired';
  return {
    itemId: uid(1000 + n),
    itemVersionId: uid(2000 + n),
    versionNo: 1,
    workspaceId: uid(3),
    status,
    origin: 'human',
    isParameterised: false,
    librarySourced: false,
    createdBy: uid(77),
    approvedBy: approved ? uid(78) : null,
    approvedAt: approved ? TIME : null,
    exposureCount: 0,
    content: {
      format: 'mcq',
      stem: `[synthetic] What is ${n} plus ${n}?`,
      options: [
        { id: 'o1', text: `${n}` },
        { id: 'o2', text: `${2 * n}` },
        { id: 'o3', text: `${3 * n}` },
      ],
      key: { optionId: 'o2' },
      skillKey: 'quant',
      difficulty: 0.4,
      ...content,
    },
    ...patch,
  } as BankItemDetail;
}

export function writtenDetail(n: number, patch: Partial<BankItemDetail> = {}): BankItemDetail {
  return {
    ...mcqDetail(n, patch),
    content: {
      format: 'written',
      stem: `[synthetic] Write two sentences about topic ${n}.`,
      rubricVersionId: uid(9000 + n),
      skillKey: 'written_communication',
      difficulty: 0.5,
    },
  } as BankItemDetail;
}

export const PARAM_SPEC = {
  params: {
    a: { kind: 'int', min: 2, max: 9, step: 1 },
    b: { kind: 'int', min: 3, max: 9, step: 1 },
  },
  derived: { answer_sum: 'a + b' },
  constraints: ['a < b'],
  stem: '[synthetic] What is {{a}} plus {{b}}?',
  options: [
    { id: 'o1', text: '{{answer_sum}}' },
    { id: 'o2', text: '{{answer_sum}} plus one' },
  ],
  correctOptionId: 'o1',
  count: 20,
} as const;

export function pool(n: number, patch: Partial<PoolDetail> = {}): PoolDetail {
  return {
    id: uid(4000 + n),
    name: `[synthetic] Pool ${n}`,
    format: 'mcq',
    skillKey: 'quant',
    status: 'active',
    itemCount: 6,
    approvedCount: 5,
    usedByDraws: [],
    usedByDrawsTotal: 0,
    ...patch,
  };
}

export function libraryCard(n: number, patch: Partial<LibraryItemCard> = {}): LibraryItemCard {
  return {
    libraryItemVersionId: uid(5000 + n),
    format: 'mcq',
    skillKey: 'verbal',
    difficulty: 0.3,
    stem: `[synthetic] Library stem ${n}`,
    options: ['Option one', 'Option two', 'Option three'],
    isParameterised: false,
    ...patch,
  };
}

export function aiJob(patch: Partial<AiDraftJobView> = {}): AiDraftJobView {
  return {
    id: uid(6000),
    status: 'queued',
    format: 'mcq',
    skillKey: 'quant',
    difficulty: 0.4,
    count: 3,
    draftsCreated: 0,
    ...patch,
  };
}

export const STATS: BankStatsResponse = {
  org: { quantItemsApproved: 10, quantItemsParameterised: 4, share: 0.4 },
  library: { quantItemsApproved: 20, quantItemsParameterised: 3, share: 0.15 },
};
