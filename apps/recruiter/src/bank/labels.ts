// Fixed user-facing words for the bank and library screens (specs/m1-test-authoring.md §4.1, §6.2, §6.4). The api's
// own text is never shown: failures map to fixed sentences here, then to the shared table.
import type {
  AiDraftErrorCode,
  AiDraftJobStatus,
  ItemFormat,
  ItemOrigin,
  ItemStatus,
} from '@trace/shared/contracts/m1';
import { errorText } from '../common/messages';

export const STATUS_LABEL: Readonly<Record<ItemStatus, string>> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  not_approved: 'Sent back',
  retired: 'Retired',
};

export const ORIGIN_LABEL: Readonly<Record<ItemOrigin, string>> = {
  human: 'Written by hand',
  import: 'Import',
  ai_draft: 'AI draft',
  library: 'Trace library',
};

export const FORMAT_LABEL: Readonly<Record<ItemFormat, string>> = {
  mcq: 'Multiple choice',
  written: 'Written',
};

/** The badge an approver sees on an AI-drafted item (§6.4). Nothing about the model is ever shown. */
export const AI_DRAFT_BADGE = 'AI draft — needs approval';

/** Every stored AI draft passed the duplicate, readability and placeholder checks (§6.4); failed drafts are discarded. */
export const AI_DRAFT_CHECKS =
  'This draft passed the duplicate, readability and placeholder checks.';

/** The approvals screen refuses a fetched version that is not the one that was queued. */
export const APPROVAL_STALE =
  'This item changed after it was queued. Refresh this page and open it again.';

/** Shown when polling of an AI draft job stopped before the job finished. */
export const JOB_STILL_RUNNING = 'The job is still running. Refresh this page later to check it.';

export const JOB_STATUS_LABEL: Readonly<Record<AiDraftJobStatus, string>> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

export const AI_ERROR_TEXT: Readonly<Record<AiDraftErrorCode, string>> = {
  drafter_error: 'The drafting service could not write drafts. Try again.',
  bad_output: 'The drafting service returned something unusable. Try again.',
  no_draft_passed: 'No draft passed the checks. Try a different topic.',
  timeout: 'Drafting took too long. Try again with fewer items.',
  internal: 'Something went wrong while drafting. Try again.',
};

/** Wedge skills of the library taxonomy (§3.2): suggestions only; any key of the right shape is accepted. */
export const SKILL_SUGGESTIONS: readonly string[] = [
  'quant',
  'logical',
  'verbal',
  'reading',
  'written_communication',
  'customer_service_sjt',
  'computer_basics',
  'spoken_english',
  'typing',
];

const EXTRA: Readonly<Record<string, string>> = {
  library_cap: 'The daily limit for copying library items was reached. Try again tomorrow.',
  variant_generation_failed:
    'The parameter spec could not produce enough different variants. Widen its ranges.',
  frozen: 'That version can no longer be changed. Make a new version instead.',
  pool_too_small: 'The pool has too few approved items for that draw.',
  forbidden: 'You do not have access to do that.',
};

/** The sentence for an api failure code on a bank or library screen. */
export function bankErrorText(code: string): string {
  return EXTRA[code] ?? errorText(code);
}

/** `0.4` as "0.40"; a missing difficulty as an en dash. */
export const difficultyText = (value: number | null): string =>
  value === null ? '–' : value.toFixed(2);

/** A share (0 to 1) as a percentage with one decimal, e.g. 0.4 -> "40%", 0.155 -> "15.5%". */
export const percentText = (share: number): string => `${String(Math.round(share * 1000) / 10)}%`;
