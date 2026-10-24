// The worker's message handling and the page's worker client (R5-48): requests and answers are validated on both
// sides, the worker is always terminated, and a broken worker is one constant failure.
import { describe, expect, it } from 'vitest';
import { asFile, mcqRow, pngBytes, xlsxBytes, zipBytes } from './fixtures.test-helpers';
import { parseExtractRequest, parseWorkerAnswer, type ExtractResult } from './protocol';
import { extractInWorker, type WorkerLike } from './worker-client';
import { handleWorkerMessage } from './worker-handler';

const xlsx = () => asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx');

describe('the worker validates what it receives', () => {
  it('accepts a well-formed request and extracts', async () => {
    const reply = await handleWorkerMessage({
      type: 'extract',
      kind: 'xlsx',
      file: xlsx(),
      name: 'items.xlsx',
    });
    expect(reply.answer.type).toBe('result');
  });

  it('transfers the image buffers it posts', async () => {
    const reply = await handleWorkerMessage({
      type: 'extract',
      kind: 'zip',
      file: asFile(zipBytes({ 'a.png': pngBytes(1) }), 'p.zip'),
      name: 'p.zip',
    });
    expect(reply.transfer).toHaveLength(1);
  });

  it.each([
    ['not an object', 'extract'],
    ['null', null],
    ['an array', []],
    ['an unknown kind', { type: 'extract', kind: 'xls', file: new Blob([]), name: 'a.xls' }],
    ['no file', { type: 'extract', kind: 'xlsx', name: 'a.xlsx' }],
    ['a string for a file', { type: 'extract', kind: 'xlsx', file: 'x', name: 'a.xlsx' }],
    ['an extra key', { type: 'extract', kind: 'xlsx', file: new Blob([]), name: 'a.xlsx', x: 1 }],
    ['a long name', { type: 'extract', kind: 'xlsx', file: new Blob([]), name: 'a'.repeat(300) }],
    ['a wrong type', { type: 'run', kind: 'xlsx', file: new Blob([]), name: 'a.xlsx' }],
  ])('refuses %s with bad_request and does nothing else', async (_label, data) => {
    expect(parseExtractRequest(data)).toBeNull();
    const reply = await handleWorkerMessage(data);
    expect(reply.answer).toEqual({ type: 'error', code: 'bad_request' });
    expect(reply.transfer).toEqual([]);
  });
});

describe('the page validates what the worker posts', () => {
  const good: ExtractResult = {
    type: 'result',
    kind: 'xlsx',
    xml: [{ name: 'xl/workbook.xml', text: '<a/>' }],
    images: [{ name: 'a.png', bytes: new Uint8Array(4) }],
    skippedImages: [{ name: 'big.png', reason: 'too_large' }],
  };

  it('accepts a result and a coded failure', () => {
    expect(parseWorkerAnswer(good)).toEqual(good);
    expect(parseWorkerAnswer({ type: 'error', code: 'macro_file' })).toEqual({
      type: 'error',
      code: 'macro_file',
    });
  });

  it.each([
    ['a string', 'result'],
    ['an unknown code', { type: 'error', code: 'oops' }],
    ['an error with a message', { type: 'error', code: 'macro_file', message: 'x' }],
    ['a result with an extra key', { ...good, extra: 1 }],
    ['xml that is not text', { ...good, xml: [{ name: 'a', text: 5 }] }],
    ['an empty part name', { ...good, xml: [{ name: '', text: '' }] }],
    ['image bytes as an array', { ...good, images: [{ name: 'a.png', bytes: [1, 2] }] }],
    [
      'an image part with a size',
      { ...good, images: [{ name: 'a', bytes: new Uint8Array(1), size: 1 }] },
    ],
    [
      'a skipped image with another reason',
      { ...good, skippedImages: [{ name: 'a', reason: 'x' }] },
    ],
    ['a result with the wrong kind', { ...good, kind: 'pdf' }],
    [
      'too many parts',
      { ...good, xml: Array.from({ length: 513 }, () => ({ name: 'a', text: '' })) },
    ],
  ])('rejects %s', (_label, data) => {
    expect(parseWorkerAnswer(data)).toBeNull();
  });
});

/** A fake Worker: answers with `reply` when it is posted a request (as a real worker would, asynchronously). */
function fakeWorker(reply: () => unknown, opts: { crash?: boolean; throwOnPost?: boolean } = {}) {
  const log = { terminated: 0, posted: [] as unknown[] };
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      if (opts.throwOnPost === true) throw new Error('boom');
      log.posted.push(message);
      queueMicrotask(() => {
        if (opts.crash === true) worker.onerror?.({});
        else worker.onmessage?.({ data: reply() });
      });
    },
    terminate() {
      log.terminated += 1;
    },
  };
  return { worker, log };
}

describe('extractInWorker', () => {
  it('posts one request, returns the checked answer and terminates the worker', async () => {
    const file = xlsx();
    const { worker, log } = fakeWorker(() => ({
      type: 'result',
      kind: 'xlsx',
      xml: [],
      images: [],
      skippedImages: [],
    }));
    const answer = await extractInWorker(() => worker, file, 'xlsx');
    expect(answer.type).toBe('result');
    expect(log.terminated).toBe(1);
    expect(log.posted).toEqual([{ type: 'extract', kind: 'xlsx', file, name: 'items.xlsx' }]);
  });

  it('turns a garbage answer, a wrong-kind answer, a crash and a throwing worker into worker_failed', async () => {
    const failed = { type: 'error', code: 'worker_failed' };
    const garbage = fakeWorker(() => ({ hello: 'world' }));
    expect(await extractInWorker(() => garbage.worker, xlsx(), 'xlsx')).toEqual(failed);
    expect(garbage.log.terminated).toBe(1);
    const wrongKind = fakeWorker(() => ({
      type: 'result',
      kind: 'docx',
      xml: [],
      images: [],
      skippedImages: [],
    }));
    expect(await extractInWorker(() => wrongKind.worker, xlsx(), 'xlsx')).toEqual(failed);
    const crash = fakeWorker(() => null, { crash: true });
    expect(await extractInWorker(() => crash.worker, xlsx(), 'xlsx')).toEqual(failed);
    expect(crash.log.terminated).toBe(1);
    const thrower = fakeWorker(() => null, { throwOnPost: true });
    expect(await extractInWorker(() => thrower.worker, xlsx(), 'xlsx')).toEqual(failed);
    expect(thrower.log.terminated).toBe(1);
    expect(
      await extractInWorker(
        () => {
          throw new Error('no workers here');
        },
        xlsx(),
        'xlsx',
      ),
    ).toEqual(failed);
  });

  it('passes a coded failure from the worker through', async () => {
    const { worker } = fakeWorker(() => ({ type: 'error', code: 'archive_too_large' }));
    expect(await extractInWorker(() => worker, xlsx(), 'xlsx')).toEqual({
      type: 'error',
      code: 'archive_too_large',
    });
  });
});
