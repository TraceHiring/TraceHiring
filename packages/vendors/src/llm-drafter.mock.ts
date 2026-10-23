// MockLlmDrafter (specs/m1-test-authoring.md §1.8 R5-3, R5-4, §6.4, AT-M1-09): the only LlmDrafter in M1. No network,
// no AWS, no credential. The output is a pure function of (format, skill, difficulty, count, seed): a small seeded
// PRNG written here (no Math.random, no clock), so the same input is deep-equal and a different seed, skill or
// difficulty gives different items. The skill key, topic and any other request text are never echoed: the topic is
// DATA and the mock does not read it at all, so no text in it can reach the output.
// Every stem starts with `[synthetic] ` (R5-4) and uses short plain words, so each item passes the §6.4 checks the
// drafting consumer runs (stem 20–1,200 chars, options 1–200, no option equal to the stem, no `{{`, Flesch ≥ 30).
// Production guard, fail closed, like messaging.ts: the constructor refuses every environment but 'dev' and 'staging'.
import type {
  DraftFormat,
  DraftRequest,
  DraftResult,
  DraftedItem,
  DraftedMcqOption,
  LlmDrafter,
} from './llm-drafter.js';

/** Recorded as `ai_draft_jobs.provider` (database fixtures pin the value). */
export const MOCK_DRAFTER_PROVIDER = 'mock';
/** Recorded as `ai_draft_jobs.model_id` and `DraftResult.modelId`. */
export const MOCK_DRAFTER_MODEL_ID = 'mock-drafter-v1';
export const MOCK_DRAFTER_ADAPTER_VERSION = 'mock-1';
/** Recorded as `ai_draft_jobs.prompt_version` and `DraftResult.promptVersion`. */
export const DRAFT_PROMPT_VERSION = 'draft-v1';

const ALLOWED_ENVS: readonly string[] = ['dev', 'staging'];
const SKILL_KEY = /^[a-z][a-z0-9_]{1,40}$/;
const SYNTHETIC_PREFIX = '[synthetic] ';
const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;

export class DrafterMockInProductionError extends Error {
  constructor() {
    super('llm drafter: the mock drafter runs only in dev and staging');
    this.name = 'DrafterMockInProductionError';
  }
}

export type DraftRequestErrorCode =
  | 'not_object'
  | 'bad_format'
  | 'bad_skill'
  | 'bad_difficulty'
  | 'bad_count'
  | 'bad_topic'
  | 'bad_seed';

/** Names the failed check only; never a value. */
export class DraftRequestError extends Error {
  readonly code: DraftRequestErrorCode;
  constructor(code: DraftRequestErrorCode) {
    super(`llm drafter: ${code}`);
    this.name = 'DraftRequestError';
    this.code = code;
  }
}

/** Throws unless `env` is exactly 'dev' or 'staging' ('production', undefined, '' and every other value refused). */
export function assertMockDrafterEnv(env: unknown): asserts env is 'dev' | 'staging' {
  if (typeof env !== 'string' || !ALLOWED_ENVS.includes(env)) {
    throw new DrafterMockInProductionError();
  }
}

// ---------- seeded PRNG (FNV-1a string hash into mulberry32) ----------

function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const int = (r: Rng, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;

function shuffled<T>(r: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// ---------- synthetic content (short plain words; no names, places, brands, emails, numbers over 3 digits) ----------

const SCENES: readonly ((r: Rng) => string)[] = [
  (r) => `A small team has ${int(r, 3, 9)} tasks and ${int(r, 2, 6)} days left.`,
  (r) => `A shop has ${int(r, 20, 90)} boxes to sort before the end of the day.`,
  (r) => `A class must hand in ${int(r, 2, 5)} short reports by the end of the week.`,
  (r) => `A desk has ${int(r, 12, 60)} forms to check and only ${int(r, 2, 5)} hours to do it.`,
  (r) => `A group plans a trip for ${int(r, 6, 40)} people with a small budget.`,
  (r) => `A clerk gets ${int(r, 10, 50)} requests in one morning.`,
];

const HARD_EXTRAS: readonly ((r: Rng) => string)[] = [
  (r) => `One task may change on day ${int(r, 1, 3)}.`,
  () => `Two of the steps depend on each other.`,
  (r) => `The budget may drop by ${int(r, 10, 40)} percent.`,
  () => `A new request can come in at any time.`,
];

const MEDIUM_EXTRAS: readonly ((r: Rng) => string)[] = [
  () => `Some of the work is more urgent than the rest.`,
  (r) => `One helper can join for ${int(r, 1, 3)} hours.`,
];

const QUESTIONS: readonly string[] = [
  'Which plan is the best choice?',
  'What should be done first?',
  'Which step gives the best result?',
  'What is the best next step?',
];

const WRITTEN_ASKS: readonly string[] = [
  'In a few short sentences, explain what you would do first and why.',
  'Write a short plan and say why it is a good plan.',
  'Describe the steps you would take and say why you chose them.',
];

const WRITTEN_HARD_ASKS: readonly string[] = [
  'Name one risk and say how you would handle it.',
  'Say what could go wrong and how you would check for it.',
];

const CORRECT_OPTIONS: readonly string[] = [
  'Do the most urgent task first',
  'Ask the team for a short check in',
  'Write down the steps before you start',
  'Split the work into small parts',
  'Check the result before you share it',
  'Keep a short list of what is done',
];

const WRONG_OPTIONS: readonly string[] = [
  'Skip the plan and hope for the best',
  'Wait until the last day to start',
  'Do every task at the same time',
  'Hide the problem from the team',
  'Change the goal without asking',
  'Ignore the deadline',
  'Stop work and wait for news',
  'Copy the result without a check',
  'Pick a task at random each hour',
  'Leave the hard parts for later',
  'Work alone and tell no one',
  'Put off all checks to the end',
];

type Tier = 'easy' | 'medium' | 'hard';
const tierOf = (difficulty: number): Tier =>
  difficulty < 0.34 ? 'easy' : difficulty < 0.67 ? 'medium' : 'hard';

function stemBody(r: Rng, tier: Tier): string {
  const parts = [pick(r, SCENES)(r)];
  if (tier === 'medium') parts.push(pick(r, MEDIUM_EXTRAS)(r));
  if (tier === 'hard') {
    parts.push(pick(r, MEDIUM_EXTRAS)(r), pick(r, HARD_EXTRAS)(r));
  }
  return parts.join(' ');
}

function draftOne(r: Rng, format: DraftFormat, tier: Tier, used: Set<string>): DraftedItem {
  // A case number makes every stem in one call distinct (the consumer's duplicate check discards equal text).
  let stem: string;
  let guard = 0;
  do {
    const label = `Case ${int(r, 100, 999)}.`;
    const body = stemBody(r, tier);
    if (format === 'written') {
      const asks = [pick(r, WRITTEN_ASKS)];
      if (tier === 'hard') asks.push(pick(r, WRITTEN_HARD_ASKS));
      stem = `${SYNTHETIC_PREFIX}${label} ${body} ${asks.join(' ')}`;
    } else {
      stem = `${SYNTHETIC_PREFIX}${label} ${body} ${pick(r, QUESTIONS)}`;
    }
    guard++;
  } while (used.has(stem) && guard < 1000);
  used.add(stem);
  if (format === 'written') return { format: 'written', stem };

  const correct = pick(r, CORRECT_OPTIONS);
  const wrong = shuffled(r, WRONG_OPTIONS).slice(0, 3);
  const ordered = shuffled(r, [correct, ...wrong]);
  const options: DraftedMcqOption[] = ordered.map((text, i) => ({
    id: OPTION_IDS[i] as string,
    text,
  }));
  const correctOptionId = options.find((o) => o.text === correct)?.id as string;
  return { format: 'mcq', stem, options, correctOptionId };
}

// ---------- request validation (names the failed field only) ----------

function parseRequest(raw: unknown): DraftRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new DraftRequestError('not_object');
  }
  const q = raw as Record<string, unknown>;
  if (q.format !== 'mcq' && q.format !== 'written') throw new DraftRequestError('bad_format');
  if (typeof q.skill !== 'string' || !SKILL_KEY.test(q.skill)) {
    throw new DraftRequestError('bad_skill');
  }
  if (
    typeof q.difficulty !== 'number' ||
    !Number.isFinite(q.difficulty) ||
    q.difficulty < 0 ||
    q.difficulty > 1
  ) {
    throw new DraftRequestError('bad_difficulty');
  }
  if (typeof q.count !== 'number' || !Number.isInteger(q.count) || q.count < 1 || q.count > 10) {
    throw new DraftRequestError('bad_count');
  }
  if (typeof q.topic !== 'string') throw new DraftRequestError('bad_topic');
  return {
    format: q.format,
    skill: q.skill,
    difficulty: q.difficulty,
    count: q.count,
    topic: q.topic,
  };
}

export class MockLlmDrafter implements LlmDrafter {
  private readonly seed: number;

  /** `env` must be 'dev' or 'staging'. `seed` (default 1) is part of the pure function; it is not a secret. */
  constructor(env: unknown, opts?: { seed?: number }) {
    assertMockDrafterEnv(env);
    const seed = opts?.seed ?? 1;
    if (!Number.isSafeInteger(seed)) throw new DraftRequestError('bad_seed');
    this.seed = seed;
  }

  draft(req: DraftRequest, opts?: { signal?: AbortSignal }): Promise<DraftResult> {
    try {
      opts?.signal?.throwIfAborted();
      const { format, skill, difficulty, count } = parseRequest(req);
      // The topic is validated as a string and then dropped: it is data and never reaches the output.
      const r = mulberry32(hash32(`${this.seed}|${format}|${skill}|${difficulty}`));
      const tier = tierOf(difficulty);
      const used = new Set<string>();
      const items: DraftedItem[] = [];
      for (let i = 0; i < count; i++) items.push(draftOne(r, format, tier, used));
      return Promise.resolve({
        items,
        modelId: MOCK_DRAFTER_MODEL_ID,
        adapterVersion: MOCK_DRAFTER_ADAPTER_VERSION,
        promptVersion: DRAFT_PROMPT_VERSION,
      });
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error('llm drafter: failed'));
    }
  }
}
