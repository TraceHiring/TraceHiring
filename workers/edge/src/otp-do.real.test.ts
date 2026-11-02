/// <reference types="@cloudflare/vitest-pool-workers/types" />
// C1a SR-6: the real InviteOtpDO class over its own SQLite-backed `ctx.storage.kv` (the `edge-do` pool). OtpCore's logic
// is covered on a Map-backed fake in otp-do.test.ts; these few tests prove the thin wrapper wires the core to the
// object's storage: issue and verify, the lock, and the set-once photo close, each surviving a fresh stub after the
// object was evicted from memory. Synthetic data only.
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { FAILURES_BEFORE_LOCK, LOCK_MS, type IssueResult } from './otp-core.js';
import { otpStub } from './real.test-helpers.js';

const issued = (r: IssueResult) => {
  if (!r.ok) throw new Error(`expected an issue, got ${r.error}`);
  return r;
};

/** A six-digit code that is not `code`. */
const wrong = (code: string): string => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('InviteOtpDO (real class, SQLite-backed storage)', () => {
  it('issues a code kept salted-hashed in the object storage, and verifies it once', async () => {
    const stub = otpStub();
    const { code, challengeId } = issued(await stub.issue());
    expect(code).toMatch(/^[0-9]{6}$/);

    const stored = await runInDurableObject(stub, (_instance, state) =>
      JSON.stringify([...state.storage.kv.list()]),
    );
    expect(stored).toContain(challengeId);
    expect(stored).not.toContain(`"${code}"`);

    const verified = await stub.verify(code);
    expect(verified).toMatchObject({ ok: true });
    // The challenge is spent: the same code again is wrong.
    expect(await stub.verify(code)).toEqual({ ok: false, error: 'otp_wrong' });
  });

  it('locks after five wrong codes, and the lock survives eviction and a fresh stub', async () => {
    const name = crypto.randomUUID();
    const stub = otpStub(name);
    const { code } = issued(await stub.issue());
    for (let n = 1; n < FAILURES_BEFORE_LOCK; n += 1) {
      expect(await stub.verify(wrong(code))).toEqual({ ok: false, error: 'otp_wrong' });
    }
    expect(await stub.verify(wrong(code))).toEqual({
      ok: false,
      error: 'otp_locked',
      retryAfterSeconds: LOCK_MS / 1000,
      lockedNow: true,
    });

    await evictDurableObject(stub);
    const fresh = otpStub(name);
    expect(await fresh.verify(code)).toMatchObject({ ok: false, error: 'otp_locked' });
    expect(await fresh.issue()).toMatchObject({ ok: false, error: 'otp_locked' });
  });

  it('closePhotos is set-once: takePhotoSlot is refused afterwards, also after eviction and a fresh stub', async () => {
    const name = crypto.randomUUID();
    const stub = otpStub(name);
    expect(await stub.takePhotoSlot()).toEqual({ ok: true, n: 1 });

    await stub.closePhotos();
    expect(await stub.takePhotoSlot()).toEqual({ ok: false, error: 'closed' });

    await evictDurableObject(stub);
    const fresh = otpStub(name);
    expect(await fresh.takePhotoSlot()).toEqual({ ok: false, error: 'closed' });
    // A different invitation is its own object and is not closed.
    expect(await otpStub().takePhotoSlot()).toEqual({ ok: true, n: 1 });
  });
});
