// One invite upload against the api (M2-7, R2-12, R5-59): create, batches of at most 200 with two at a time, held
// phone-shared rows re-sent exactly once with the flag, finish or cancel. A fake UploadApi stands in for the network.
import type {
  InviteBatchRequest,
  InviteBatchResponse,
  InviteRow,
  InviteUploadView,
} from '@trace/shared/contracts/m2';
import { describe, expect, it } from 'vitest';
import { uid, uploadView } from '../testing/fixtures.test-helpers';
import { BATCH_SIZE, CONCURRENCY } from './limits';
import { InviteUploadRun, type UploadApi } from './run';

type Result = { ok: true; data: InviteBatchResponse } | { ok: false; code: string };

const rowOf = (n: number): InviteRow => ({
  rowNo: n,
  fullName: 'Asha Rao',
  email: `a${String(n)}@example.test`,
  adult18: null,
});
const rows = (n: number, from = 1): InviteRow[] =>
  Array.from({ length: n }, (_, i) => rowOf(from + i));
const SHA = 'a'.repeat(64);
const noSleep = () => Promise.resolve();

interface Fake {
  api: UploadApi;
  batches: InviteBatchRequest[];
  calls: string[];
  peak: () => number;
  /** Lets the answers of a gated fake through. */
  release: () => void;
}
/** Answers every row `invited` unless `decide` says otherwise; `batch` may fail a whole call. */
function fake(
  decide: (row: { rowNo: number }, batch: InviteBatchRequest) => 'invited' | string = () =>
    'invited',
  batch: (call: number, request: InviteBatchRequest) => Result | undefined = () => undefined,
  create: () => { ok: true; data: InviteUploadView } | { ok: false; code: string } = () => ({
    ok: true,
    data: uploadView(),
  }),
  gated = false,
  cancelAnswer: () => { ok: true; data: InviteUploadView } | { ok: false; code: string } = () => ({
    ok: true,
    data: uploadView({ status: 'cancelled' }),
  }),
): Fake {
  let release: () => void = () => undefined;
  const gate = gated
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  const batches: InviteBatchRequest[] = [];
  const calls: string[] = [];
  let inFlight = 0;
  let peak = 0;
  const api: UploadApi = {
    create: (body) => {
      calls.push(`create:${String(body.rowsInFile)}`);
      return Promise.resolve(create());
    },
    postRows: async (request) => {
      calls.push('rows');
      const callNo = batches.push(request);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gate;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1);
      });
      inFlight -= 1;
      const forced = batch(callNo, request);
      if (forced !== undefined) return forced;
      return {
        ok: true,
        data: {
          results: request.rows.map((row) => {
            const verdict = decide(row, request);
            if (verdict === 'invited')
              return { rowNo: row.rowNo, invitationId: uid(9000 + row.rowNo) };
            return { rowNo: row.rowNo, reason: verdict, held: verdict === 'phone_shared' } as never;
          }),
        },
      };
    },
    complete: (uploadId) => {
      calls.push(`complete:${uploadId}`);
      return Promise.resolve({ ok: true, data: uploadView({ status: 'completed' }) });
    },
    cancel: (uploadId) => {
      calls.push(`cancel:${uploadId}`);
      return Promise.resolve(cancelAnswer());
    },
  };
  return { api, batches, calls, peak: () => peak, release };
}

const run = (f: Fake, n: number, issues: { rowNo: number; reason: 'bad_slot' }[] = []) =>
  new InviteUploadRun(
    f.api,
    { fileSha256: SHA, rowsInFile: n + issues.length, rows: rows(n), issues },
    { sleep: noSleep },
  );

describe('sending the rows', () => {
  it('uses batches of at most 200 rows, two at a time', async () => {
    expect(BATCH_SIZE).toBe(200);
    expect(CONCURRENCY).toBe(2);
    const f = fake();
    const r = run(f, 1000);
    await r.start();
    expect(f.batches.map((b) => b.rows.length)).toEqual([200, 200, 200, 200, 200]);
    expect(f.peak()).toBe(2);
    const sent = f.batches.flatMap((b) => b.rows.map((row) => row.rowNo)).sort((a, b) => a - b);
    expect(sent).toEqual(rows(1000).map((row) => row.rowNo));
    for (const b of f.batches) expect(b.uploadId).toBe(uploadView().uploadId);
    for (const b of f.batches) expect(b.confirmPhoneDuplicate).toBeUndefined();
  });

  it('opens the upload with the file hash and the rows in the file, then completes it', async () => {
    const f = fake();
    const r = run(f, 3, [{ rowNo: 9, reason: 'bad_slot' }]);
    await r.start();
    expect(f.calls[0]).toBe('create:4');
    expect(f.calls.at(-1)).toBe(`complete:${uploadView().uploadId}`);
    const s = r.getState();
    expect(s.phase).toBe('completed');
    expect(s.invited).toBe(3);
    expect(s.refused).toEqual([{ rowNo: 9, reason: 'bad_slot' }]);
    expect(s.held).toEqual([]);
    expect(s.rowsSent).toBe(3);
  });

  it('collects refused rows from the api, ordered by row, and counts the invited', async () => {
    const f = fake((row) =>
      row.rowNo === 3 ? 'already_invited' : row.rowNo === 2 ? 'minor' : 'invited',
    );
    const r = run(f, 5);
    await r.start();
    const s = r.getState();
    expect(s.invited).toBe(3);
    expect(s.refused).toEqual([
      { rowNo: 2, reason: 'minor' },
      { rowNo: 3, reason: 'already_invited' },
    ]);
  });

  it('sends nothing when every row has an issue, and still finishes', async () => {
    const f = fake();
    const r = new InviteUploadRun(
      f.api,
      {
        fileSha256: SHA,
        rowsInFile: 1,
        rows: [],
        issues: [{ rowNo: 1, reason: 'bad_slot' }],
      },
      { sleep: noSleep },
    );
    await r.start();
    expect(f.batches).toEqual([]);
    expect(r.getState().phase).toBe('completed');
  });

  it('keeps notifying subscribers of progress, and stops when they leave', async () => {
    const f = fake();
    const r = run(f, 450);
    const seen: number[] = [];
    const off = r.subscribe(() => seen.push(r.getState().rowsSent));
    await r.start();
    off();
    const count = seen.length;
    expect(seen.at(-1)).toBe(450);
    r.subscribe(() => undefined)();
    expect(seen).toHaveLength(count);
  });
});

describe('held rows (R2-12)', () => {
  const sharing = (row: { rowNo: number }, batch: InviteBatchRequest) =>
    batch.confirmPhoneDuplicate === true || ![3, 7].includes(row.rowNo)
      ? 'invited'
      : 'phone_shared';

  it('waits for the recruiter instead of finishing when rows are held', async () => {
    const f = fake(sharing);
    const r = run(f, 10);
    await r.start();
    const s = r.getState();
    expect(s.phase).toBe('ready');
    expect(s.held).toEqual([3, 7]);
    expect(s.invited).toBe(8);
    expect(s.refused).toEqual([]);
    expect(f.calls.some((c) => c.startsWith('complete'))).toBe(false);
  });

  // Lead decision (M2-5, R5-59): one "Mark as different people" per held row. Replaces the test that re-sent every
  // held row at once.
  it('re-sends exactly the one held row asked for, once, with the flag; the others stay held', async () => {
    const f = fake(sharing);
    const r = run(f, 10);
    await r.start();
    const before = f.batches.length;
    await r.markDifferentPerson(3);
    const resent = f.batches.slice(before);
    expect(resent).toHaveLength(1);
    expect(resent[0]?.rows.map((row) => row.rowNo)).toEqual([3]);
    expect(resent[0]?.rows[0]?.email).toBe('a3@example.test');
    expect(resent[0]?.confirmPhoneDuplicate).toBe(true);
    const s = r.getState();
    expect(s.invited).toBe(9);
    expect(s.held).toEqual([7]);
    expect(s.phase).toBe('ready');
    expect(f.calls.some((c) => c.startsWith('complete'))).toBe(false);
  });

  it('finishes by itself once the last held row has been marked', async () => {
    const f = fake(sharing);
    const r = run(f, 10);
    await r.start();
    const before = f.batches.length;
    await r.markDifferentPerson(7);
    await r.markDifferentPerson(3);
    expect(f.batches.slice(before).map((b) => b.rows.map((row) => row.rowNo))).toEqual([[7], [3]]);
    const s = r.getState();
    expect(s.invited).toBe(10);
    expect(s.held).toEqual([]);
    expect(s.phase).toBe('completed');
  });

  it('sends nothing for a row that is not held, or a second time for one already marked', async () => {
    const f = fake(sharing);
    const r = run(f, 10);
    await r.start();
    const before = f.batches.length;
    await r.markDifferentPerson(4);
    await r.markDifferentPerson(99);
    expect(f.batches).toHaveLength(before);
    await r.markDifferentPerson(3);
    await r.markDifferentPerson(3);
    expect(f.batches).toHaveLength(before + 1);
  });

  it('keeps a row held when its re-send fails, so it can be marked again', async () => {
    let fail = true;
    const f = fake(sharing, (_call, request) =>
      fail && request.confirmPhoneDuplicate === true ? { ok: false, code: 'conflict' } : undefined,
    );
    const r = run(f, 10);
    await r.start();
    await r.markDifferentPerson(3);
    expect(r.getState()).toMatchObject({ phase: 'ready', held: [3, 7], failure: 'conflict' });
    fail = false;
    await r.markDifferentPerson(3);
    expect(r.getState()).toMatchObject({ phase: 'ready', held: [7], failure: null, invited: 9 });
  });

  it('keeps a held row that comes back refused for another reason as a refused row', async () => {
    const f = fake((row, batch) =>
      batch.confirmPhoneDuplicate === true
        ? 'slot_full'
        : row.rowNo === 2
          ? 'phone_shared'
          : 'invited',
    );
    const r = run(f, 3);
    await r.start();
    await r.markDifferentPerson(2);
    const s = r.getState();
    expect(s.held).toEqual([]);
    expect(s.refused).toEqual([{ rowNo: 2, reason: 'slot_full' }]);
  });

  it('lets the recruiter finish without marking them: the held rows stay uninvited', async () => {
    const f = fake(sharing);
    const r = run(f, 10);
    await r.start();
    await r.finish();
    expect(r.getState().phase).toBe('completed');
    expect(r.getState().invited).toBe(8);
    expect(f.calls.at(-1)).toBe(`complete:${uploadView().uploadId}`);
  });

  it('drops the rows it kept once the upload has ended', async () => {
    const f = fake(sharing);
    const r = run(f, 10);
    await r.start();
    await r.finish();
    await r.markDifferentPerson(3);
    expect(f.batches.filter((b) => b.confirmPhoneDuplicate === true)).toEqual([]);
  });
});

describe('failures and cancel', () => {
  it('stops when the upload cannot be opened, and says why', async () => {
    const f = fake(undefined, undefined, () => ({ ok: false, code: 'crypto_unavailable' }));
    const r = run(f, 5);
    await r.start();
    expect(r.getState()).toMatchObject({ phase: 'failed', failure: 'crypto_unavailable' });
    expect(f.batches).toEqual([]);
  });

  it('retries a batch that fails in transit, then goes on', async () => {
    let failures = 0;
    const f = fake(undefined, (call) => {
      if (call === 1 && failures < 1) {
        failures += 1;
        return { ok: false, code: 'network' };
      }
      return undefined;
    });
    const r = run(f, 5);
    await r.start();
    expect(r.getState().phase).toBe('completed');
    expect(r.getState().invited).toBe(5);
  });

  it('stops after repeated failures and resumes only the batches without an answer', async () => {
    let down = true;
    const f = fake(undefined, (call) =>
      down && call >= 2 ? { ok: false, code: 'unavailable' } : undefined,
    );
    const r = run(f, 400);
    await r.start();
    const stopped = r.getState();
    expect(stopped.phase).toBe('stopped');
    expect(stopped.failure).toBe('unavailable');
    expect(stopped.invited).toBe(200);
    down = false;
    await r.retry();
    const s = r.getState();
    expect(s.phase).toBe('completed');
    expect(s.invited).toBe(400);
    expect(s.failure).toBeNull();
  });

  it('treats an answer that does not match the batch as a failed response, not as success', async () => {
    const f = fake(undefined, (_call, request) => ({
      ok: true,
      data: { results: [{ rowNo: request.rows[0]?.rowNo ?? 1, invitationId: uid(1) }] },
    }));
    const r = run(f, 3);
    await r.start();
    expect(r.getState()).toMatchObject({ phase: 'stopped', failure: 'invalid_response' });
  });

  it('cancels: no new batch starts, what was invited stays, the api is told once', async () => {
    const f = fake(undefined, undefined, undefined, true);
    const r = run(f, 1000);
    const started = r.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
    expect(f.batches).toHaveLength(2);
    const cancelling = r.cancel();
    f.release();
    await cancelling;
    await started;
    const s = r.getState();
    expect(s.phase).toBe('cancelled');
    expect(f.calls.filter((c) => c.startsWith('cancel'))).toHaveLength(1);
    expect(f.batches).toHaveLength(2);
    expect(s.invited).toBe(400);
  });

  it('cancels from the ready screen with held rows', async () => {
    const f = fake((row) => (row.rowNo === 1 ? 'phone_shared' : 'invited'));
    const r = run(f, 3);
    await r.start();
    expect(r.getState().phase).toBe('ready');
    await r.cancel();
    expect(r.getState().phase).toBe('cancelled');
    expect(f.calls.at(-1)).toBe(`cancel:${uploadView().uploadId}`);
  });

  it('"Try again" after a failed cancel retries the cancel and sends no further batch', async () => {
    let down = true;
    let cancelDown = true;
    const f = fake(
      undefined,
      (call) => (down && call >= 2 ? { ok: false, code: 'unavailable' } : undefined),
      undefined,
      false,
      () =>
        cancelDown
          ? { ok: false, code: 'network' }
          : { ok: true, data: uploadView({ status: 'cancelled' }) },
    );
    const r = run(f, 400);
    await r.start();
    expect(r.getState().phase).toBe('stopped');
    down = false;
    await r.cancel();
    expect(r.getState()).toMatchObject({ phase: 'stopped', failure: 'network' });
    const batchesBefore = f.batches.length;
    cancelDown = false;
    await r.retry();
    expect(f.batches).toHaveLength(batchesBefore);
    expect(f.calls.filter((c) => c.startsWith('cancel'))).toHaveLength(2);
    expect(f.calls.some((c) => c.startsWith('complete'))).toBe(false);
    expect(r.getState()).toMatchObject({ phase: 'cancelled', failure: null, invited: 200 });
  });

  it('notes a re-upload of the same file', async () => {
    const f = fake(undefined, undefined, () => ({
      ok: true,
      data: uploadView({ reuploadWarning: true }),
    }));
    const r = run(f, 2);
    await r.start();
    expect(r.getState().reuploadWarning).toBe(true);
  });
});

describe('no row outlives the upload (security finding 5)', () => {
  /** Every field of the run, private ones included, with Maps and Sets opened up. */
  const dump = (r: InviteUploadRun): string =>
    JSON.stringify(Object.entries(r), (_key, value: unknown) =>
      value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value,
    );

  it('the dump does see rows while the upload is open (the check is not vacuous)', async () => {
    const f = fake((row) => (row.rowNo === 2 ? 'phone_shared' : 'invited'));
    const r = run(f, 3);
    expect(dump(r)).toContain('@example.test');
    await r.start();
    expect(r.getState().phase).toBe('ready');
    expect(dump(r)).toContain('a2@example.test');
  });

  it('holds no row data once completed, only the file hash and the counts', async () => {
    const f = fake((row) => (row.rowNo === 2 ? 'phone_shared' : 'invited'));
    const r = run(f, 450);
    await r.start();
    await r.finish();
    expect(r.getState().phase).toBe('completed');
    expect(dump(r)).not.toContain('@example.test');
    expect(dump(r)).not.toContain('Asha Rao');
    expect(dump(r)).toContain(SHA);
    expect(r.getState().rowsInFile).toBe(450);
  });

  it('holds no row data once cancelled, mid-run or before the upload was opened', async () => {
    const f = fake(undefined, undefined, undefined, true);
    const r = run(f, 1000);
    const started = r.start();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
    const cancelling = r.cancel();
    f.release();
    await cancelling;
    await started;
    expect(r.getState().phase).toBe('cancelled');
    expect(dump(r)).not.toContain('@example.test');

    const g = fake();
    const early = run(g, 5);
    await early.cancel();
    expect(early.getState().phase).toBe('cancelled');
    expect(dump(early)).not.toContain('@example.test');
  });
});

describe('a held-row re-send in flight when Cancel is pressed (finding 6)', () => {
  /** Rows 1 and 2 are held; a re-send waits until `release` is called. */
  function heldFake() {
    let open: (() => void) | null = null;
    const posts: InviteBatchRequest[] = [];
    const calls: string[] = [];
    const api: UploadApi = {
      create: () => Promise.resolve({ ok: true, data: uploadView() }),
      postRows: async (request) => {
        posts.push(request);
        const again = request.confirmPhoneDuplicate === true;
        if (again) {
          calls.push('resend sent');
          await new Promise<void>((resolve) => {
            open = resolve;
          });
          calls.push('resend answered');
        }
        return {
          ok: true,
          data: {
            results: request.rows.map((row) =>
              again || ![1, 2].includes(row.rowNo)
                ? { rowNo: row.rowNo, invitationId: uid(9000 + row.rowNo) }
                : { rowNo: row.rowNo, reason: 'phone_shared' as const, held: true },
            ),
          },
        };
      },
      complete: () => {
        calls.push('complete');
        return Promise.resolve({ ok: true, data: uploadView({ status: 'completed' }) });
      },
      cancel: () => {
        calls.push('cancel');
        return Promise.resolve({ ok: true, data: uploadView({ status: 'cancelled' }) });
      },
    };
    return {
      api,
      posts,
      calls,
      release: () => {
        open?.();
      },
    };
  }
  const tick = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 2);
    });

  it('posts no chunk after Cancel, and tells the api only after the re-send has its answer', async () => {
    const f = heldFake();
    const r = new InviteUploadRun(
      f.api,
      { fileSha256: SHA, rowsInFile: 3, rows: rows(3), issues: [] },
      { sleep: noSleep },
    );
    await r.start();
    expect(r.getState().held).toEqual([1, 2]);
    const marking = r.markDifferentPerson(1);
    await tick();
    expect(r.getState().busy).toBe(true);
    const cancelling = r.cancel();
    await r.markDifferentPerson(2);
    await tick();
    expect(f.calls).not.toContain('cancel');
    f.release();
    await Promise.all([marking, cancelling]);
    expect(f.posts.filter((p) => p.confirmPhoneDuplicate === true)).toHaveLength(1);
    expect(f.calls).toEqual(['resend sent', 'resend answered', 'cancel']);
    expect(r.getState().phase).toBe('cancelled');
  });

  it('counts no row as both invited and not invited', async () => {
    const f = heldFake();
    const r = new InviteUploadRun(
      f.api,
      { fileSha256: SHA, rowsInFile: 3, rows: rows(3), issues: [] },
      { sleep: noSleep },
    );
    await r.start();
    const marking = r.markDifferentPerson(1);
    await tick();
    const cancelling = r.cancel();
    f.release();
    await Promise.all([marking, cancelling]);
    const s = r.getState();
    expect(s.invited).toBe(2);
    expect(s.refused).toEqual([{ rowNo: 2, reason: 'phone_shared' }]);
    expect(s.held).toEqual([]);
    expect(s.invited + s.refused.length + s.held.length).toBe(3);
  });
});
