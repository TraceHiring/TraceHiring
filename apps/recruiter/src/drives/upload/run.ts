// One invite upload against the api (specs/m2-scheduling-invites.md §6.2, M2-7, R2-12, R5-59). Order: open the upload
// with the file's SHA-256, send the rows in batches of at most 200 (two at a time), then finish it. Rows the api holds
// as `phone_shared` stay here, in memory only, until the recruiter marks one as a different person; that one row is then
// re-sent once with `confirmPhoneDuplicate: true`. Cancel keeps whoever was already invited. Every failure ends in one constant
// code the screen turns into fixed text; nothing here logs, stores or keeps a value beyond the rows still to send.
import type {
  InviteBatchRequest,
  InviteBatchResponse,
  InviteRow,
  InviteUploadCreateRequest,
  InviteUploadView,
} from '@trace/shared/contracts/m2';
import type { ApiClient, ApiResult } from '../../api/client';
import {
  cancelInviteUpload,
  completeInviteUpload,
  createInviteUpload,
  postInviteRows,
} from '../../api/endpoints';
import { BATCH_SIZE, CONCURRENCY } from './limits';
import type { RowIssue } from './types';

/** The four calls an upload makes; tests pass a fake. */
export interface UploadApi {
  create(body: InviteUploadCreateRequest): Promise<ApiResult<InviteUploadView>>;
  postRows(body: InviteBatchRequest): Promise<ApiResult<InviteBatchResponse>>;
  complete(uploadId: string): Promise<ApiResult<InviteUploadView>>;
  cancel(uploadId: string): Promise<ApiResult<InviteUploadView>>;
}

export const uploadApiFor = (client: ApiClient, driveId: string): UploadApi => ({
  create: (body) => createInviteUpload(client, driveId, body),
  postRows: (body) => postInviteRows(client, driveId, body),
  complete: (uploadId) => completeInviteUpload(client, driveId, uploadId),
  cancel: (uploadId) => cancelInviteUpload(client, driveId, uploadId),
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

export interface RunState {
  phase: RunPhase;
  uploadId: string | null;
  /** Data rows in the file, including the ones the browser could not use. */
  rowsInFile: number;
  /** Rows in batches the api has answered. */
  rowsSent: number;
  /** Rows to send (the file's rows without a browser-side issue). */
  rowsToSend: number;
  invited: number;
  /** Every row that was not invited and is not held, by row number: the browser's issues and the api's reasons. */
  refused: RowIssue[];
  /** Row numbers held as phone_shared, waiting for the recruiter. */
  held: number[];
  /** True when an earlier upload of this drive had the same file. */
  reuploadWarning: boolean;
  /** The code of the failure that stopped the run, or null. */
  failure: string | null;
  upload: InviteUploadView | null;
  /** True while held rows are being re-sent. */
  busy: boolean;
}

export interface RunInput {
  fileSha256: string;
  rowsInFile: number;
  rows: InviteRow[];
  issues: RowIssue[];
}

export interface RunOptions {
  sleep?: (ms: number) => Promise<void>;
}

const TRANSIENT = new Set(['network', 'unavailable', 'rate_limited']);
const ATTEMPTS = 3;
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface Batch {
  rows: InviteRow[];
  done: boolean;
  claimed: boolean;
}

const byRow = (a: RowIssue, b: RowIssue): number => a.rowNo - b.rowNo;

export class InviteUploadRun {
  private state: RunState;
  private readonly listeners = new Set<() => void>();
  private readonly sleep: (ms: number) => Promise<void>;
  private batches: Batch[];
  /** Held rows, in memory only, until they are re-sent or the upload ends. */
  private heldRows = new Map<number, InviteRow>();
  private cancelRequested = false;
  private stopCode: string | null = null;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly api: UploadApi,
    private readonly input: RunInput,
    options: RunOptions = {},
  ) {
    this.sleep = options.sleep ?? defaultSleep;
    this.batches = [];
    for (let at = 0; at < input.rows.length; at += BATCH_SIZE) {
      this.batches.push({
        rows: input.rows.slice(at, at + BATCH_SIZE),
        done: false,
        claimed: false,
      });
    }
    this.state = {
      phase: 'idle',
      uploadId: null,
      rowsInFile: input.rowsInFile,
      rowsSent: 0,
      rowsToSend: input.rows.length,
      invited: 0,
      refused: [...input.issues].sort(byRow),
      held: [],
      reuploadWarning: false,
      failure: null,
      upload: null,
      busy: false,
    };
  }

  getState(): RunState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(patch: Partial<RunState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener();
  }

  /** Opens the upload (or tries again after it could not be opened) and sends every batch. */
  async start(): Promise<void> {
    if (this.state.phase !== 'idle' && this.state.phase !== 'failed') return;
    this.set({ phase: 'running', failure: null });
    if (this.state.uploadId === null) {
      const created = await this.api.create({
        fileSha256: this.input.fileSha256,
        rowsInFile: this.input.rowsInFile,
      });
      if (!created.ok) {
        this.set({ phase: 'failed', failure: created.code });
        return;
      }
      this.set({
        uploadId: created.data.uploadId,
        reuploadWarning: created.data.reuploadWarning,
        upload: created.data,
      });
      if (this.cancelRequested) {
        await this.endByCancel();
        return;
      }
    }
    await this.runLoop();
  }

  /**
   * "Try again" after a stop. When the stop was a cancel the api did not take, the cancel is what is tried again and no
   * batch is sent; otherwise the batches that have no answer yet are sent.
   */
  async retry(): Promise<void> {
    if (this.state.phase !== 'stopped') return;
    if (this.cancelRequested) {
      await this.endByCancel();
      return;
    }
    this.stopCode = null;
    this.set({ phase: 'running', failure: null });
    await this.runLoop();
  }

  private runLoop(): Promise<void> {
    const loop = this.sendBatches().finally(() => {
      if (this.loop === loop) this.loop = null;
    });
    this.loop = loop;
    return loop;
  }

  private claim(): Batch | undefined {
    const next = this.batches.find((batch) => !batch.done && !batch.claimed);
    if (next !== undefined) next.claimed = true;
    return next;
  }

  private async sendBatches(): Promise<void> {
    const worker = async (): Promise<void> => {
      while (!this.cancelRequested && this.stopCode === null) {
        const batch = this.claim();
        if (batch === undefined) return;
        await this.sendBatch(batch);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    if (this.cancelRequested) {
      await this.endByCancel();
      return;
    }
    if (this.stopCode !== null) {
      this.set({ phase: 'stopped', failure: this.stopCode });
      return;
    }
    if (this.heldRows.size === 0) {
      await this.finish();
      return;
    }
    this.set({ phase: 'ready' });
  }

  /** One request with up to three attempts for a transient failure; a batch without an answer is left unclaimed. */
  private async post(
    uploadId: string,
    rows: InviteRow[],
    confirm: boolean,
  ): Promise<ApiResult<InviteBatchResponse>> {
    const request: InviteBatchRequest = confirm
      ? { uploadId, rows, confirmPhoneDuplicate: true }
      : { uploadId, rows };
    let last: ApiResult<InviteBatchResponse> = { ok: false, code: 'unavailable' };
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      last = await this.api.postRows(request);
      if (last.ok || !TRANSIENT.has(last.code) || attempt === ATTEMPTS - 1) return last;
      await this.sleep(1000 * (attempt + 1));
    }
    return last;
  }

  private async sendBatch(batch: Batch): Promise<void> {
    const uploadId = this.state.uploadId;
    if (uploadId === null) return;
    const answer = await this.post(uploadId, batch.rows, false);
    if (!answer.ok) {
      batch.claimed = false;
      this.stopCode ??= answer.code;
      return;
    }
    if (!this.absorb(batch.rows, answer.data)) {
      batch.claimed = false;
      this.stopCode ??= 'invalid_response';
      return;
    }
    batch.done = true;
    batch.rows = [];
  }

  /**
   * Counts an answer: an invitation, a refused row, or a held one. The answer must name exactly the rows that were
   * sent; anything else is not trusted and nothing from it is counted.
   */
  private absorb(sent: readonly InviteRow[], response: InviteBatchResponse): boolean {
    const wanted = new Set(sent.map((row) => row.rowNo));
    const seen = new Set<number>();
    for (const result of response.results) {
      if (!wanted.has(result.rowNo) || seen.has(result.rowNo)) return false;
      seen.add(result.rowNo);
    }
    if (seen.size !== wanted.size) return false;

    const refused = [...this.state.refused];
    let invited = this.state.invited;
    const byNo = new Map(sent.map((row) => [row.rowNo, row]));
    for (const result of response.results) {
      this.heldRows.delete(result.rowNo);
      if ('invitationId' in result) {
        invited += 1;
      } else if (result.held) {
        const row = byNo.get(result.rowNo);
        if (row !== undefined) this.heldRows.set(result.rowNo, row);
      } else {
        refused.push({ rowNo: result.rowNo, reason: result.reason });
      }
    }
    this.set({
      invited,
      refused: refused.sort(byRow),
      held: [...this.heldRows.keys()].sort((a, b) => a - b),
      rowsSent: this.state.rowsSent + sent.length,
    });
    return true;
  }

  /**
   * Re-sends exactly one held row, once, with the flag (R2-12; M2-5: the recruiter decides each person, so there is
   * one action per held row, never a selection). The other held rows stay held. Once no row is held, the upload ends.
   */
  async markDifferentPerson(rowNo: number): Promise<void> {
    const uploadId = this.state.uploadId;
    const row = this.heldRows.get(rowNo);
    if (this.state.phase !== 'ready' || this.state.busy || uploadId === null || row === undefined)
      return;
    this.set({ busy: true, failure: null });
    const chunk = [row];
    const answer = await this.post(uploadId, chunk, true);
    if (!answer.ok) {
      this.set({ busy: false, failure: answer.code });
      return;
    }
    if (!this.absorbResent(chunk, answer.data)) {
      this.set({ busy: false, failure: 'invalid_response' });
      return;
    }
    this.set({ busy: false });
    if (this.heldRows.size === 0) await this.finish();
  }

  /** The answer to a re-sent chunk: a row that is still held (it should not be) is refused as phone_shared. */
  private absorbResent(sent: readonly InviteRow[], response: InviteBatchResponse): boolean {
    const wanted = new Set(sent.map((row) => row.rowNo));
    const seen = new Set<number>();
    for (const result of response.results) {
      if (!wanted.has(result.rowNo) || seen.has(result.rowNo)) return false;
      seen.add(result.rowNo);
    }
    if (seen.size !== wanted.size) return false;
    const refused = [...this.state.refused];
    let invited = this.state.invited;
    for (const result of response.results) {
      this.heldRows.delete(result.rowNo);
      if ('invitationId' in result) invited += 1;
      else refused.push({ rowNo: result.rowNo, reason: result.reason });
    }
    this.set({
      invited,
      refused: refused.sort(byRow),
      held: [...this.heldRows.keys()].sort((a, b) => a - b),
    });
    return true;
  }

  /** Ends the upload; rows still held stay uninvited. */
  async finish(): Promise<void> {
    const uploadId = this.state.uploadId;
    if ((this.state.phase !== 'ready' && this.state.phase !== 'running') || uploadId === null)
      return;
    this.set({ phase: 'completing', failure: null });
    const done = await this.api.complete(uploadId);
    if (!done.ok) {
      this.set({ phase: 'ready', failure: done.code });
      return;
    }
    this.set({ phase: 'completed', upload: done.data, ...this.settleHeld() });
  }

  /** Rows still held when the upload ends stay uninvited: they join the refused rows with their reason. */
  private settleHeld(): Pick<RunState, 'refused' | 'held'> {
    const refused = [
      ...this.state.refused,
      ...this.state.held.map((rowNo): RowIssue => ({ rowNo, reason: 'phone_shared' })),
    ].sort(byRow);
    this.heldRows.clear();
    return { refused, held: [] };
  }

  /** Stops sending, lets the requests in flight finish, tells the api once. Whoever was invited stays invited. */
  async cancel(): Promise<void> {
    if (this.state.phase === 'completed' || this.state.phase === 'cancelled') return;
    this.cancelRequested = true;
    if (this.state.phase === 'running' && this.state.uploadId === null) {
      // The upload is still being opened; `start` ends it as soon as it has an id.
      this.set({ phase: 'cancelling' });
      return;
    }
    const loop = this.loop;
    if (loop !== null) {
      this.set({ phase: 'cancelling' });
      await loop;
      return;
    }
    await this.endByCancel();
  }

  private async endByCancel(): Promise<void> {
    const uploadId = this.state.uploadId;
    if (uploadId === null) {
      this.set({ phase: 'cancelled', ...this.settleHeld() });
      return;
    }
    this.set({ phase: 'cancelling', failure: null });
    const answer = await this.api.cancel(uploadId);
    if (!answer.ok) {
      // The cancel intent stays: "Try again" retries the cancel, never the batches.
      this.set({ phase: 'stopped', failure: answer.code });
      return;
    }
    this.batches = [];
    this.set({ phase: 'cancelled', upload: answer.data, ...this.settleHeld() });
  }
}
