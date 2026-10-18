// AT-D11 (d), edge part (rule 5, D1-11; specs/d1-demo-slice.md §4.1 step 8): the candidate only ever sees a receipt,
// exactly `{receiptRef, submittedAt}`, with no score, band or other key at any depth, from submit, a repeated submit,
// a later start and attach. receiptRef is the deterministic 8-character Crockford reference of the session id.
import { Receipt } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import { receiptRefOf } from './session-evidence.js';
import { heartbeat, postEvents, sessionHarness } from './session.test-helpers.js';
import { SESSION } from './token.test-helpers.js';

const FORBIDDEN = /score|band|quality|integrity|flag|cutoff|signal|coverage|evidence|replay/i;

/** Every key of a JSON value, at any depth. */
const keysOf = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
};

describe('the receipt is exactly {receiptRef, submittedAt} (AT-D11 d)', () => {
  it('on submit, a repeated submit, a later start and attach; no score or band anywhere', async () => {
    const h = await sessionHarness();
    const { token, view } = await h.startSession();
    await postEvents(h, token, view.streamId, [heartbeat(1)]);
    h.clock.ms += 2000;
    const submitted = await (
      await h.request('POST', '/v1/session/submit', {
        token,
        json: { streamId: view.streamId, finalSeq: 1 },
      })
    ).json();
    const repeated = await (
      await h.request('POST', '/v1/session/submit', {
        token,
        json: { streamId: view.streamId, finalSeq: 1 },
      })
    ).json();
    const attached = await (await h.request('POST', '/v1/session/attach', { token })).json();
    h.clock.ms += 60_000;
    const lobby = await h.login();
    const restarted = await (
      await h.request('POST', '/v1/session/start', {
        token: lobby,
        json: { rulesAcknowledged: true, photo: { skippedReason: 'declined' } },
      })
    ).json();

    expect(Object.keys(submitted as object).sort()).toEqual(['receiptRef', 'submittedAt']);
    expect(Receipt.parse(submitted)).toEqual(submitted);
    expect(repeated).toEqual(submitted);
    expect((attached as { view: { receipt: unknown } }).view.receipt).toEqual(submitted);
    expect(restarted).toEqual({ state: 'submitted', receipt: submitted });
    for (const body of [submitted, repeated, attached, restarted]) {
      expect(keysOf(body).filter((key) => FORBIDDEN.test(key))).toEqual([]);
    }
    expect((submitted as { receiptRef: string }).receiptRef).toBe(await receiptRefOf(SESSION));
  });

  it('receiptRef is deterministic per session and in the Crockford alphabet', async () => {
    const a = await receiptRefOf(SESSION);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(await receiptRefOf(SESSION)).toBe(a);
    expect(await receiptRefOf('cccccccc-cccc-4ccc-8ccc-cccccccccccc')).not.toBe(a);
  });
});
