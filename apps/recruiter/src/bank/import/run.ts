// One import run against the api (spec §6.9, §4.3, E12, E13, R5-51 g). Order: create the job, upload the distinct
// images (six at a time; content-addressed, so a re-upload is a no-op), send the rows in batches of at most 100 (three
// at a time; the api is idempotent on (job, row), so a re-sent batch changes nothing), then the user finishes or cancels.
// Cancel keeps the rows already imported (R5-51 g, FOUNDER-QUEUE default). Every failure ends in one constant code the
// screen turns into fixed text; nothing here keeps a cell value, a server message or a URL.
import type {
  ImportImagePutResponse,
  ImportJobCreateRequest,
  ImportJobView,
  ImportRow,
  ImportRowsResponse,
} from '@trace/shared/contracts/m1';
import type { ApiClient, ApiResult, ImportImageType } from '../../api/client';
import {
  cancelImportJob,
  completeImportJob,
  createImportJob,
  postImportRows,
  putImportImage,
} from '../../api/endpoints';
import { IMAGE_CONCURRENCY, ROW_BATCH_SIZE, ROW_CONCURRENCY } from './limits';
import type { ParsedImport } from './parse';
import type { RowIssue } from './rows';
import { TEMPLATE_VERSION } from './template';

/** The six calls a run makes; tests pass a fake. */
export interface ImportApi {
  createJob(body: ImportJobCreateRequest): Promise<ApiResult<ImportJobView>>;
  putImage(
    jobId: string,
    sha256: string,
    type: ImportImageType,
    bytes: Uint8Array<ArrayBuffer>,
  ): Promise<ApiResult<ImportImagePutResponse>>;
  postRows(jobId: string, rows: ImportRow[]): Promise<ApiResult<ImportRowsResponse>>;
  completeJob(jobId: string): Promise<ApiResult<ImportJobView>>;
  cancelJob(jobId: string): Promise<ApiResult<ImportJobView>>;
}

export const importApiFor = (client: ApiClient): ImportApi => ({
  createJob: (body) => createImportJob(client, body),
  putImage: (jobId, sha256, type, bytes) => putImportImage(client, jobId, sha256, type, bytes),
  postRows: (jobId, rows) => postImportRows(client, jobId, { rows }),
  completeJob: (jobId) => completeImportJob(client, jobId),
  cancelJob: (jobId) => cancelImportJob(client, jobId),
});

export type RunPhase =
  | 'idle'
  | 'running'
  | 'ready'
  | 'stopped'
  | 'completing'
  | 'completed'
  | 'cancelling'
  | 'cancelled'
  | 'failed';
export type RunStage = 'job' | 'images' | 'rows';

export interface RunState {
  phase: RunPhase;
  stage: RunStage | null;
  jobId: string | null;
  imagesDone: number;
  imagesTotal: number;
  /** Rows in batches the api has answered. */
  rowsSent: number;
  /** Rows to send (rows with no page error and no refused image). */
  rowsTotal: number;
  /** Rows the api accepted. */
  accepted: number;
  /** Every row error so far: the page's, the refused images', and the api's, ordered by row. */
  issues: RowIssue[];
  /** The code of the failure that stopped or ended the run, or null. */
  failure: string | null;
  job: ImportJobView | null;
}

export interface SessionOptions {
  sleep?: (ms: number) => Promise<void>;
  /** Calls per api request at most (first try included). */
  retries?: number;
  onChange?: (state: RunState) => void;
}

/** Failures worth another try; every other code stops the run at once. */
const TRANSIENT = new Set(['network', 'unavailable', 'rate_limited']);
/**
 * Codes that are about the session or the job, not about one image: they stop the run at once. Any other refusal of one
 * image (the api names its own reasons: too large, bad type, too wide, ...) fails only the rows that use that image.
 */
const RUN_LEVEL = new Set([
  'unauthorized',
  'forbidden',
  'aal2_required',
  'not_found',
  'conflict',
  'invalid_response',
  'internal',
]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The image codes the page already has words for; every other refusal of an image is `image_refused`. */
const IMAGE_ROW_CODE: Readonly<Record<string, 'image_too_large' | 'image_bad_type' | undefined>> = {
  image_too_large: 'image_too_large',
  image_bad_type: 'image_bad_type',
};

const issueKey = (i: RowIssue): string => `${i.rowNo}:${i.field}:${i.code}`;

export class ImportSession {
  private readonly parsed: ParsedImport;
  private readonly api: ImportApi;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly attempts: number;
  private readonly onChange: ((state: RunState) => void) | undefined;

  private phase: RunPhase = 'idle';
  private stage: RunStage | null = null;
  private jobId: string | null = null;
  private job: ImportJobView | null = null;
  private failure: string | null = null;
  private halted = false;
  private cancelRequested = false;
  private running: Promise<void> | null = null;
  private cancelling: Promise<void> | null = null;
  private readonly uploaded = new Set<string>();
  private readonly refused = new Map<string, string>();
  private readonly answered = new Map<number, { rows: number; accepted: number }>();
  private readonly pageIssues = new Map<string, RowIssue>();
  private readonly apiIssues = new Map<string, RowIssue>();
  private batches: ImportRow[][] = [];

  constructor(parsed: ParsedImport, api: ImportApi, options: SessionOptions = {}) {
    this.parsed = parsed;
    this.api = api;
    this.sleep = options.sleep ?? defaultSleep;
    this.attempts = Math.max(1, options.retries ?? 3);
    this.onChange = options.onChange;
    for (const issue of parsed.issues) this.pageIssues.set(issueKey(issue), issue);
  }

  state(): RunState {
    const issues = [...this.pageIssues.values(), ...this.apiIssues.values()];
    issues.sort((a, b) => a.rowNo - b.rowNo);
    let rowsSent = 0;
    let accepted = 0;
    for (const answer of this.answered.values()) {
      rowsSent += answer.rows;
      accepted += answer.accepted;
    }
    return {
      phase: this.phase,
      stage: this.stage,
      jobId: this.jobId,
      imagesDone: this.uploaded.size + this.refused.size,
      imagesTotal: this.parsed.images.length,
      rowsSent,
      rowsTotal: this.sendableRows().length,
      accepted,
      issues,
      failure: this.failure,
      job: this.job,
    };
  }

  private emit(): void {
    this.onChange?.(this.state());
  }

  private set(phase: RunPhase, stage: RunStage | null = this.stage): void {
    this.phase = phase;
    this.stage = stage;
    this.emit();
  }

  /** Rows that can be sent: no page error and no image the api refused. */
  private sendableRows(): ImportRow[] {
    return this.parsed.rows.filter(
      (row) => row.imageSha256 === undefined || !this.refused.has(row.imageSha256),
    );
  }

  private stopping(): boolean {
    return this.halted || this.cancelRequested;
  }

  private halt(code: string): void {
    this.halted = true;
    this.failure ??= code;
  }

  /** One api call with up to `attempts` tries; only transient codes are tried again. */
  private async attempt<T>(call: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    let result = await call();
    for (let n = 1; !result.ok && TRANSIENT.has(result.code) && n < this.attempts; n++) {
      if (this.cancelRequested) break;
      await this.sleep(250 * n);
      result = await call();
    }
    return result;
  }

  private async pool<T>(items: readonly T[], size: number, work: (item: T) => Promise<void>) {
    let next = 0;
    const lane = async (): Promise<void> => {
      while (!this.stopping()) {
        const index = next++;
        const item = items[index];
        if (index >= items.length || item === undefined) return;
        await work(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  }

  /** Create the job and send everything. Starting again after a stop is `resume`. */
  start(): Promise<void> {
    if (this.running !== null) return this.running;
    if (this.phase !== 'idle' && this.phase !== 'stopped') return Promise.resolve();
    if (this.parsed.rows.length === 0) return Promise.resolve();
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** Try again after a stop: only what is not done is done again. */
  resume(): Promise<void> {
    return this.start();
  }

  private async run(): Promise<void> {
    this.halted = false;
    this.failure = null;
    this.set('running', 'job');

    if (this.jobId === null) {
      const created = await this.attempt(() =>
        this.api.createJob({
          sourceKind: this.parsed.sourceKind,
          templateVersion: TEMPLATE_VERSION,
        }),
      );
      if (!created.ok) {
        this.halt(created.code);
      } else {
        this.jobId = created.data.id;
        this.job = created.data;
      }
    }
    const jobId = this.jobId;
    if (jobId !== null && !this.stopping()) {
      this.set('running', 'images');
      const pending = this.parsed.images.filter(
        (image) => !this.uploaded.has(image.sha256) && !this.refused.has(image.sha256),
      );
      await this.pool(pending, IMAGE_CONCURRENCY, async (image) => {
        const result = await this.attempt(() =>
          this.api.putImage(jobId, image.sha256, image.type, image.bytes),
        );
        if (result.ok) this.uploaded.add(image.sha256);
        else if (TRANSIENT.has(result.code) || RUN_LEVEL.has(result.code)) this.halt(result.code);
        else this.refuse(image.sha256, result.code);
        this.emit();
      });
    }
    if (jobId !== null && !this.stopping()) {
      this.set('running', 'rows');
      const rows = this.sendableRows();
      this.batches = [];
      for (let at = 0; at < rows.length; at += ROW_BATCH_SIZE) {
        this.batches.push(rows.slice(at, at + ROW_BATCH_SIZE));
      }
      const todo = this.batches
        .map((batch, index) => ({ batch, index }))
        .filter(({ index }) => !this.answered.has(index));
      await this.pool(todo, ROW_CONCURRENCY, async ({ batch, index }) => {
        const result = await this.attempt(() => this.api.postRows(jobId, batch));
        if (!result.ok) {
          this.halt(result.code);
          return;
        }
        this.answered.set(index, { rows: batch.length, accepted: result.data.accepted });
        for (const error of result.data.errors) {
          this.apiIssues.set(issueKey(error), {
            rowNo: error.rowNo,
            field: error.field,
            code: error.code,
          });
        }
        this.emit();
      });
    }
    if (this.cancelRequested) return;
    this.set(this.halted ? 'stopped' : 'ready', null);
  }

  /** Rows that use a refused image get that code on their image column, and are not sent. */
  private refuse(sha256: string, code: string): void {
    this.refused.set(sha256, code);
    for (const row of this.parsed.rows) {
      if (row.imageSha256 !== sha256) continue;
      const issue: RowIssue = {
        rowNo: row.rowNo,
        field: 'image_file',
        code: IMAGE_ROW_CODE[code] ?? 'image_refused',
      };
      this.pageIssues.set(issueKey(issue), issue);
    }
  }

  /** Finish the import: the api moves the job to completed (or reports why it failed). */
  async complete(): Promise<void> {
    if (this.jobId === null || this.phase !== 'ready') return;
    const jobId = this.jobId;
    this.failure = null;
    this.set('completing', null);
    const result = await this.api.completeJob(jobId);
    if (!result.ok) {
      this.failure = result.code;
      this.set('ready', null);
      return;
    }
    this.job = result.data;
    if (result.data.status === 'completed') this.set('completed', null);
    else if (result.data.status === 'failed') {
      this.failure = result.data.errorCode ?? 'internal';
      this.set('failed', null);
    } else {
      this.failure = 'conflict';
      this.set('ready', null);
    }
  }

  /**
   * Stop and cancel the job; the rows already imported stay (R5-51 g). One cancel at a time: a second click while the
   * first is still waiting for the run to end gets the first one's promise, so the api is asked once.
   */
  cancel(): Promise<void> {
    this.cancelling ??= this.doCancel().finally(() => {
      this.cancelling = null;
    });
    return this.cancelling;
  }

  private async doCancel(): Promise<void> {
    if (this.phase === 'cancelled' || this.phase === 'cancelling') return;
    this.cancelRequested = true;
    if (this.running !== null) await this.running;
    if (this.jobId === null) {
      this.failure = null;
      this.set('cancelled', null);
      return;
    }
    const jobId = this.jobId;
    this.failure = null;
    this.set('cancelling', null);
    const result = await this.api.cancelJob(jobId);
    this.cancelRequested = false;
    if (!result.ok) {
      this.failure = result.code;
      this.set(
        this.batches.length === this.answered.size && this.batches.length > 0 ? 'ready' : 'stopped',
        null,
      );
      return;
    }
    this.job = result.data;
    this.set('cancelled', null);
  }
}
