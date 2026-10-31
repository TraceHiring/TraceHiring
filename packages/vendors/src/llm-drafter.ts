// LlmDrafter (specs/m1-test-authoring.md §1.3 M1-8, §1.8 R5-3, §6.4; build-notes Q22): the interface the M1 drafting
// job (`workers/jobs/src/drafting/`) drafts bank items through. Drafting is not grading, so it is a separate interface
// from LlmGrader; both real adapters share one in-region Bedrock client written when ABH-87 lands (M5). This file
// holds ONLY the interface and its types: no mock, no Bedrock client, no network. `MockLlmDrafter` (deterministic,
// clearly synthetic, refuses `production` like messaging.ts) is written by its own stream.
//
// The request carries no candidate, org, workspace, user or job field. `topic` is recruiter free text that the api has
// already scrubbed (emails, long digit runs, URLs → `[removed]`) and capped at 500 chars; it is DATA, never
// instructions. Real adapters wrap it in delimiters and escape the delimiter (the LlmGrader `answer` convention), so
// text inside the topic cannot change the prompt. The consumer validates every result with zod (`DraftedItem[]`) and
// runs the duplicate, readability and placeholder checks before anything is stored; a drafted item is never trusted.

/** Formats the drafter can write in M1 (spec `AiDraftRequest.format`). */
export type DraftFormat = 'mcq' | 'written';

/** One draft call. `topic` is DATA, never instructions. No identity field exists (a test pins the key set). */
export interface DraftRequest {
  format: DraftFormat;
  /** A `skill_taxonomy.skill_key` (`^[a-z][a-z0-9_]{1,40}$`). */
  skill: string;
  /** Target difficulty, 0..1 with two decimals (`item_versions.difficulty`). */
  difficulty: number;
  /** Number of items to draft, 1..10 (`ai_draft_jobs.count`). */
  count: number;
  /** Scrubbed recruiter topic, ≤ 500 chars; may be empty. */
  topic: string;
}

export interface DraftedMcqOption {
  id: string;
  text: string;
}
export interface DraftedMcqItem {
  format: 'mcq';
  stem: string;
  options: readonly DraftedMcqOption[];
  /** The id of the correct option; must be one of `options`. */
  correctOptionId: string;
}
export interface DraftedWrittenItem {
  format: 'written';
  stem: string;
}
/** A drafted item before any check. It lands as `origin = 'ai_draft'`, `status = 'in_review'` only if it passes. */
export type DraftedItem = DraftedMcqItem | DraftedWrittenItem;

/** The versions are recorded on `ai_draft_jobs` (`model_id`, `prompt_version`), so every draft is traceable. */
export interface DraftResult {
  items: readonly DraftedItem[];
  modelId: string;
  adapterVersion: string;
  promptVersion: string;
}

export interface LlmDrafter {
  draft(req: DraftRequest, opts?: { signal?: AbortSignal }): Promise<DraftResult>;
}
