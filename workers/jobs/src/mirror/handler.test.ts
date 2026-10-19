// The mirror stage over the fake SqlTx and evidence bucket (spec d1 §5.1 row `mirror`; AT-D16; C1b photo binding).
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './evidence.js';
import { inTx, mirrorHandlers, shared, table } from './fake-db.test-helpers.js';
import { runMirror } from './handler.js';
import { PHOTO_KEY, PHOTO_SHA, W, sessionWorld, type SessionWorld } from './world.test-helpers.js';

const KEY = `${W.session}:session_mirror:${W.ruleset}`;

const run = (w: SessionWorld, message = w.message, org: string = message.orgId) =>
  inTx(w.db, org, mirrorHandlers, (tx) => runMirror(message, { tx, evidence: w.evidence }));

const written = [
  'sessions',
  'session_items',
  'responses',
  'media_objects',
  'reports',
  'idempotency_keys',
];

describe('mirror stage', () => {
  it('writes the public session rows, one report pointer with both card ids null, submitted, and the key', async () => {
    const w = await sessionWorld();
    await run(w);
    expect(table(w.db, 'sessions')).toEqual([
      expect.objectContaining({
        id: W.session,
        invitation_id: W.invitation,
        consent_id: W.consent,
        test_version_id: W.testVersion,
        ruleset_version_id: W.ruleset,
        state: 'submitted',
        submit_kind: 'candidate',
        mirror_seq: 1,
        receipt_ref: 'K7M2P9QX',
      }),
    ]);
    expect(
      table(w.db, 'session_items').map((r) => [
        r['position'],
        r['item_version_id'],
        r['section_id'],
      ]),
    ).toEqual([
      [1, W.i1, W.s1],
      [2, W.i2, W.s1],
      [3, W.i3, W.s2],
    ]);
    const responses = table(w.db, 'responses');
    expect(
      responses.map((r) => [r['answer_kind'], r['final_choice'], r['final_text'] !== null]),
    ).toEqual([
      ['choice', 'b', false],
      ['choice', 'a', false],
      ['text', null, true],
    ]);
    expect(responses[2]?.['answer_sha256']).toBe(
      await sha256Hex('The queue will retry the message.'),
    );
    expect(table(w.db, 'media_objects')).toEqual([
      expect.objectContaining({
        r2_key: PHOTO_KEY,
        sha256: PHOTO_SHA,
        kind: 'start_photo',
        blurred_on_device: true,
      }),
    ]);
    expect(table(w.db, 'reports')).toEqual([
      expect.objectContaining({
        session_id: W.session,
        quality_card_id: null,
        integrity_card_id: null,
      }),
    ]);
    expect(table(w.db, 'invitations')[0]?.['status']).toBe('submitted');
    expect(table(w.db, 'idempotency_keys')).toEqual([
      { org_id: W.org, scope: 'session_mirror', key: KEY, result_ref: W.session },
    ]);
    // the mirror writes no consent, signal or result
    for (const t of ['signals', 'results', 'scores', 'quality_cards', 'integrity_cards']) {
      expect(table(w.db, t)).toHaveLength(0);
    }
    expect(table(w.db, 'consents')).toHaveLength(1);
  });

  it('auto_submitted maps to submit_kind deadline', async () => {
    const w = await sessionWorld();
    await run(w, { ...w.message, state: 'auto_submitted' });
    expect(table(w.db, 'sessions')[0]).toMatchObject({
      state: 'auto_submitted',
      submit_kind: 'deadline',
    });
  });

  describe('start photo (C1b binding, fail closed)', () => {
    it('(a) canonical object missing: no media row, everything else stored', async () => {
      const w = await sessionWorld({ photo: 'missing_object' });
      await run(w);
      expect(table(w.db, 'media_objects')).toHaveLength(0);
      expect(table(w.db, 'sessions')).toHaveLength(1);
      expect(table(w.db, 'idempotency_keys')).toHaveLength(1);
    });

    it('(b) canonical object present with another sha256: no media row', async () => {
      const w = await sessionWorld({ photo: 'other_sha' });
      await run(w);
      expect(table(w.db, 'media_objects')).toHaveLength(0);
      expect(table(w.db, 'sessions')).toHaveLength(1);
    });

    it('a photo named under a non-canonical key or with another size is not recorded', async () => {
      const w = await sessionWorld();
      const photo = w.message.photo!;
      await run(w, {
        ...w.message,
        photo: { ...photo, key: `media/${W.org}/${W.session}/start_photo.upload.jpg` },
      });
      expect(table(w.db, 'media_objects')).toHaveLength(0);
      const v = await sessionWorld();
      await run(v, { ...v.message, photo: { ...photo, bytes: photo.bytes + 1 } });
      expect(table(v.db, 'media_objects')).toHaveLength(0);
    });

    it('no photo in the message: no media row', async () => {
      const w = await sessionWorld({ photo: 'none' });
      await run(w);
      expect(table(w.db, 'media_objects')).toHaveLength(0);
    });
  });

  describe('final.json', () => {
    it('a hash mismatch throws a constant code and writes nothing', async () => {
      const w = await sessionWorld();
      const message = {
        ...w.message,
        evidence: { ...w.message.evidence, finalSha256: '0'.repeat(64) },
      };
      await expect(run(w, message)).rejects.toThrow(/^mirror_final_hash_mismatch$/);
      for (const t of written) expect(table(w.db, t)).toHaveLength(0);
      expect(table(w.db, 'invitations')[0]?.['status']).toBe('started');
    });

    it('a missing file is retried (constant code), nothing written', async () => {
      const w = await sessionWorld();
      w.evidence.objects.delete(w.message.evidence.finalKey);
      await expect(run(w)).rejects.toThrow(/^mirror_final_missing$/);
      for (const t of written) expect(table(w.db, t)).toHaveLength(0);
    });

    it('a key outside the session is refused', async () => {
      const w = await sessionWorld();
      const message = {
        ...w.message,
        evidence: {
          ...w.message.evidence,
          finalKey: `sessions/${W.otherOrg}/${W.session}/final.json`,
        },
      };
      await expect(run(w, message)).rejects.toThrow(/^mirror_bad_message$/);
    });

    it('an answer at a position that was not served is a malformed file', async () => {
      const w = await sessionWorld();
      await expect(run(w, { ...w.message, served: w.message.served.slice(0, 2) })).rejects.toThrow(
        /^mirror_final_invalid$/,
      );
    });

    // Security review #2: text Postgres cannot store (NUL, a lone surrogate) is a constant mirror_final_invalid,
    // never a 22P05/22P02 from the database, and nothing is written.
    it.each([
      ['a NUL', 'before\u0000after'],
      ['a lone high surrogate', 'before\uD800after'],
      ['a lone low surrogate', 'before\uDC00after'],
    ])('a text answer with %s is mirror_final_invalid, nothing written', async (_name, text) => {
      const w = await sessionWorld();
      const body = JSON.stringify({
        v: 1,
        sessionId: W.session,
        answers: [{ position: 3, kind: 'text', text, sha256: await sha256Hex(text), finalSeq: 6 }],
      });
      w.evidence.put(w.message.evidence.finalKey, body);
      const err = (await run(w, {
        ...w.message,
        evidence: { ...w.message.evidence, finalSha256: await sha256Hex(body) },
      }).catch((e: unknown) => e)) as Error & { code?: string };
      expect(err.message).toBe('mirror_final_invalid');
      expect(err.code).toBeUndefined();
      for (const t of written) expect(table(w.db, t)).toHaveLength(0);
    });

    it('a cleared MCQ choice stores no response', async () => {
      const w = await sessionWorld();
      const body = JSON.stringify({
        v: 1,
        sessionId: W.session,
        answers: [
          { position: 1, kind: 'choice', choice: null, sha256: await sha256Hex(''), finalSeq: 2 },
        ],
      });
      w.evidence.put(w.message.evidence.finalKey, body);
      await run(w, {
        ...w.message,
        evidence: { ...w.message.evidence, finalSha256: await sha256Hex(body) },
      });
      expect(table(w.db, 'responses')).toHaveLength(0);
      expect(table(w.db, 'session_items')).toHaveLength(3);
    });
  });

  describe('refusals', () => {
    it('a revoked invitation is a dead letter: no session (R-14)', async () => {
      const w = await sessionWorld({ invitationStatus: 'revoked' });
      await expect(run(w)).rejects.toThrow(/^mirror_dead_invitation$/);
      expect(table(w.db, 'sessions')).toHaveLength(0);
    });

    it('a missing consent row is refused', async () => {
      const w = await sessionWorld({ consent: false });
      await expect(run(w)).rejects.toThrow(/^mirror_consent_missing$/);
      expect(table(w.db, 'sessions')).toHaveLength(0);
    });

    it('a session id that is not the invitation one is refused', async () => {
      const w = await sessionWorld();
      table(w.db, 'invitations')[0]!['session_id'] = W.otherOrg;
      await expect(run(w)).rejects.toThrow(/^mirror_session_mismatch$/);
    });

    it('a repeated position or item in served is malformed', async () => {
      const w = await sessionWorld();
      const served = [...w.message.served, { ...w.message.served[0]! }];
      await expect(run(w, { ...w.message, served })).rejects.toThrow(/^mirror_bad_message$/);
    });

    it('another org sees no invitation (trace.job_org_id)', async () => {
      const w = await sessionWorld();
      await expect(run(w, w.message, W.otherOrg)).rejects.toThrow(/^mirror_invitation_missing$/);
    });
  });

  it('a database error becomes mirror_failed, keeping only a well-formed SQLSTATE', async () => {
    const w = await sessionWorld();
    const tx = {
      query: () =>
        Promise.reject(Object.assign(new Error('Key (x)=(y) exists'), { code: 'not a state' })),
    };
    const err = (await runMirror(w.message, { tx, evidence: w.evidence }).catch(
      (e: unknown) => e,
    )) as Error;
    expect(err.message).toBe('mirror_failed');
    expect((err as Error & { code?: string }).code).toBeUndefined();
  });

  describe('exactly-once (AT-D16)', () => {
    it('the same message twice: one row of each, same ids', async () => {
      const w = await sessionWorld();
      await run(w);
      const before = structuredClone(w.db.tables);
      await run(w);
      expect(w.db.tables).toEqual(before);
    });

    it('a replay with the key lost re-reads the same rows instead of adding new ones', async () => {
      const w = await sessionWorld();
      await run(w);
      const ids = table(w.db, 'session_items').map((r) => r['id']);
      w.db.tables['idempotency_keys'] = [];
      table(w.db, 'invitations')[0]!['status'] = 'started';
      await run(w);
      for (const t of written) expect(table(w.db, t).length).toBeLessThanOrEqual(3);
      expect(table(w.db, 'sessions')).toHaveLength(1);
      expect(table(w.db, 'responses')).toHaveLength(3);
      expect(table(w.db, 'session_items').map((r) => r['id'])).toEqual(ids);
    });

    it('two concurrent mirrors of one message give one row each', async () => {
      const w = await sessionWorld();
      const go = () =>
        shared(w.db, W.org, mirrorHandlers, (tx) =>
          runMirror(w.message, { tx, evidence: w.evidence }),
        );
      await Promise.all([go(), go()]);
      expect(table(w.db, 'sessions')).toHaveLength(1);
      expect(table(w.db, 'session_items')).toHaveLength(3);
      expect(table(w.db, 'responses')).toHaveLength(3);
      expect(table(w.db, 'media_objects')).toHaveLength(1);
      expect(table(w.db, 'reports')).toHaveLength(1);
      expect(table(w.db, 'idempotency_keys')).toHaveLength(1);
    });
  });
});
