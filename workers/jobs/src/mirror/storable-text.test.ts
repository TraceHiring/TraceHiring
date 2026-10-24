// Security review #2, defence in depth: the contract (FinalAnswers) refuses text Postgres cannot store, but the
// mirror must not depend on that alone. Here the contract is replaced by one that lets every final.json through, so
// only the mirror's own check stands between unstorable text and the database (whose 22P05/22P02 would otherwise
// make every redelivery fail the same way). The fake database refuses such text as Postgres does.
import { describe, expect, it, vi } from 'vitest';
import { sha256Hex } from './evidence.js';
import { inTx, mirrorHandlers, table } from './fake-db.test-helpers.js';
import { runMirror } from './handler.js';
import { W, sessionWorld } from './world.test-helpers.js';

vi.mock('@trace/shared/contracts/candidate', async (importOriginal) => {
  const real = await importOriginal<typeof import('@trace/shared/contracts/candidate')>();
  return {
    ...real,
    FinalAnswers: { safeParse: (data: unknown) => ({ success: true, data }) },
  };
});

describe('unstorable text with a permissive contract', () => {
  it.each([
    ['a NUL', 'before\u0000after'],
    ['a lone high surrogate', 'before\uD800after'],
    ['a lone low surrogate', 'before\uDC00after'],
  ])('a text answer with %s is mirror_final_invalid, not a database error', async (_n, text) => {
    const w = await sessionWorld();
    const body = JSON.stringify({
      v: 1,
      sessionId: W.session,
      answers: [{ position: 3, kind: 'text', text, sha256: await sha256Hex(text), finalSeq: 6 }],
    });
    w.evidence.put(w.message.evidence.finalKey, body);
    const message = {
      ...w.message,
      evidence: { ...w.message.evidence, finalSha256: await sha256Hex(body) },
    };
    const err = (await inTx(w.db, message.orgId, mirrorHandlers, (tx) =>
      runMirror(message, { tx, evidence: w.evidence }),
    ).catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.message).toBe('mirror_final_invalid');
    expect(err.code).toBeUndefined();
    expect(table(w.db, 'responses')).toHaveLength(0);
    expect(table(w.db, 'sessions')).toHaveLength(0);
  });
});
