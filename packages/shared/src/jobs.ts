// Interfaces the jobs Worker injects into its three stages (spec d1 §5.1). Lead-written so that
// quality/** and integrity/** can share them without importing a neutral local file (rule-1 wall).
// queue/consumer.ts opens one SQL session per stage as that stage's worker role and injects it as
// `tx`; the stages never open a connection. SQL text is constant; values are bound parameters only.

export type SqlParam = string | number | boolean | null;

/** One open transaction as the stage's worker role (COMMIT happens after the stage returns). */
export interface SqlTx {
  query<R extends object = Record<string, unknown>>(
    text: string,
    params?: readonly SqlParam[],
  ): Promise<R[]>;
}

/** One stored evidence object (R2). */
export interface EvidenceObject {
  readonly size: number;
  readonly customMetadata: Readonly<Record<string, string>>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Metadata of one stored evidence object, without its body. */
export interface EvidenceHead {
  readonly size: number;
  readonly customMetadata: Readonly<Record<string, string>>;
}

/** Read-only view of the evidence bucket; a missing object is null. */
export interface EvidenceReader {
  get(key: string): Promise<EvidenceObject | null>;
  head(key: string): Promise<EvidenceHead | null>;
}

/** The three idempotent jobs (public.idempotency_keys.scope, L-20). */
export const JOB_NAMES = ['session_mirror', 'quality_score', 'integrity_band'] as const;
export type JobName = (typeof JOB_NAMES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The idempotency key `${sessionId}:${job}:${rulesetVersionId}` (session + job + ruleset, L-6). */
export const jobKey = (sessionId: string, job: JobName, rulesetVersionId: string): string => {
  if (!UUID.test(sessionId) || !UUID.test(rulesetVersionId) || !JOB_NAMES.includes(job)) {
    throw new Error('bad_job_key');
  }
  return `${sessionId}:${job}:${rulesetVersionId}`;
};
