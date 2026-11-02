// Sweep (spec d1 §5.1 "Sweep (L-18)", §7.1): the cron asks the database which sessions have a stage
// missing (private.sweep_pending, injected here as pendingStages), reads each session's mirror.json
// from R2 and re-enqueues that message. The consumer's stages are idempotent, so a re-enqueue is safe.
import { createLogger } from '@trace/shared/log';
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SWEEP_LIMIT,
  NOT_IMPLEMENTED_SWEEP,
  notImplementedPendingStages,
  r2TextReader,
  runSweep,
  type PendingStage,
} from './sweep.js';
import { mirrorKey, ORG_ID, RULESET_ID, SESSION_ID, validMessage } from './test-fixtures.js';

const row = (patch: Partial<PendingStage> = {}): PendingStage => ({
  orgId: ORG_ID,
  sessionId: SESSION_ID,
  rulesetVersionId: RULESET_ID,
  stage: 'session_mirror',
  ...patch,
});

const setup = (
  rows: readonly unknown[],
  files: Record<string, string | null> = {},
  sendError?: Error,
) => {
  const limits: number[] = [];
  const reads: string[] = [];
  const sent: SessionMirrorMessage[] = [];
  const lines: string[] = [];
  const deps = {
    pendingStages: (limit: number) => {
      limits.push(limit);
      return Promise.resolve(rows as readonly PendingStage[]);
    },
    readMirror: (key: string) => {
      reads.push(key);
      return Promise.resolve(files[key] ?? null);
    },
    send: (message: SessionMirrorMessage) => {
      if (sendError !== undefined) return Promise.reject(sendError);
      sent.push(message);
      return Promise.resolve();
    },
    log: createLogger({ service: 'jobs', version: 'dev', sink: (line) => lines.push(line) }),
  };
  return { deps, limits, reads, sent, lines };
};

const fileFor = (msg: SessionMirrorMessage = validMessage()): Record<string, string> => ({
  [mirrorKey(msg.orgId, msg.sessionId)]: JSON.stringify(msg),
});

describe('runSweep', () => {
  it('re-enqueues the message stored in mirror.json for a pending row', async () => {
    const { deps, reads, sent } = setup([row()], fileFor());

    const result = await runSweep(deps);

    expect(reads).toEqual([mirrorKey(ORG_ID, SESSION_ID)]);
    expect(sent).toEqual([validMessage()]);
    expect(result).toEqual({ pending: 1, enqueued: 1, skipped: 0 });
  });

  it('passes the limit to pendingStages: the default, or the injected one', async () => {
    const first = setup([]);
    await runSweep(first.deps);
    expect(first.limits).toEqual([DEFAULT_SWEEP_LIMIT]);

    const second = setup([]);
    await runSweep({ ...second.deps, limit: 7 });
    expect(second.limits).toEqual([7]);
  });

  it('does nothing and logs nothing when no stage is pending', async () => {
    const { deps, reads, sent, lines } = setup([]);

    expect(await runSweep(deps)).toEqual({ pending: 0, enqueued: 0, skipped: 0 });
    expect(reads).toEqual([]);
    expect(sent).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('sends one message for a session with several pending stages', async () => {
    const { deps, sent } = setup(
      [row({ stage: 'quality_score' }), row({ stage: 'integrity_band' })],
      fileFor(),
    );

    const result = await runSweep(deps);

    expect(sent).toHaveLength(1);
    expect(result).toEqual({ pending: 2, enqueued: 1, skipped: 0 });
  });

  it('handles each (session, ruleset) on its own', async () => {
    const otherSession = validMessage({
      sessionId: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b0aa',
      jobKey: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b0aa:session_mirror:' + RULESET_ID,
    });
    const { deps, sent } = setup([row(), row({ sessionId: otherSession.sessionId })], {
      ...fileFor(),
      ...fileFor(otherSession),
    });

    await runSweep(deps);

    expect(sent.map((m) => m.sessionId)).toEqual([SESSION_ID, otherSession.sessionId]);
  });

  it('skips a row whose mirror.json is missing, logs ids only, and carries on', async () => {
    const other = validMessage({ sessionId: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b0aa' });
    const { deps, sent, lines } = setup(
      [row(), row({ sessionId: other.sessionId })],
      fileFor(other),
    );

    const result = await runSweep(deps);

    expect(sent).toEqual([other]);
    expect(result).toEqual({ pending: 2, enqueued: 1, skipped: 1 });
    expect(lines).toHaveLength(2); // the skip and the summary
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'warn',
      service: 'jobs',
      event: 'sweep.mirror_missing',
      orgId: ORG_ID,
      data: { sessionId: SESSION_ID, stage: 'session_mirror' },
    });
  });

  // Built at run time so no PII-shaped literal sits in the repo.
  const email = (): string => ['pat', 'example.test'].join('@');

  it.each([
    ['not JSON', '{not json'],
    ['JSON of the wrong shape', JSON.stringify({ hello: 'world' })],
    ['a message with an unknown field', JSON.stringify({ ...validMessage(), extra: 1 })],
    ['an array', '[]'],
  ])('skips an invalid mirror.json (%s) without logging its content', async (_label, content) => {
    const poisoned = content.replace(/\}$/, `,"note":"${email()}"}`);
    for (const text of [content, poisoned]) {
      const { deps, sent, lines } = setup([row()], { [mirrorKey(ORG_ID, SESSION_ID)]: text });

      const result = await runSweep(deps);

      expect(sent).toEqual([]);
      expect(result).toEqual({ pending: 1, enqueued: 0, skipped: 1 });
      expect(JSON.parse(lines[0] ?? '')).toMatchObject({
        event: 'sweep.mirror_invalid',
        data: { sessionId: SESSION_ID, stage: 'session_mirror' },
      });
      const out = lines.join('\n');
      expect(out).not.toContain(email());
      expect(out).not.toContain('hello');
      expect(out).not.toContain('extra');
    }
  });

  it('skips a mirror.json that belongs to another session, org or ruleset', async () => {
    for (const patch of [
      { sessionId: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b0aa' },
      { orgId: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b0bb' },
      { rulesetVersionId: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b0cc' },
    ]) {
      const { deps, sent, lines } = setup([row()], {
        [mirrorKey(ORG_ID, SESSION_ID)]: JSON.stringify(validMessage(patch)),
      });

      const result = await runSweep(deps);

      expect(sent).toEqual([]);
      expect(result.skipped).toBe(1);
      expect(JSON.parse(lines[0] ?? '')).toMatchObject({ event: 'sweep.mirror_mismatch' });
    }
  });

  it('skips a row with a malformed id before touching R2 (no path built from it)', async () => {
    const { deps, reads, sent, lines } = setup([
      row({ sessionId: '../../other/final' }),
      row({ orgId: 'x/y' }),
      { orgId: ORG_ID },
      null,
    ]);

    const result = await runSweep(deps);

    expect(reads).toEqual([]);
    expect(sent).toEqual([]);
    expect(result).toEqual({ pending: 4, enqueued: 0, skipped: 4 });
    expect(lines.join('\n')).not.toContain('../');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ event: 'sweep.row_invalid' });
  });

  it('keeps sweeping after a failed send, then throws a constant error so it is reported', async () => {
    const { deps, reads, lines } = setup(
      [row(), row({ sessionId: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b0aa' })],
      {
        ...fileFor(),
        ...fileFor(validMessage({ sessionId: '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b0aa' })),
      },
      new Error(`queue down for ${email()}`),
    );

    await expect(runSweep(deps)).rejects.toThrow('sweep_enqueue_failed');

    expect(reads).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'error',
      event: 'sweep.enqueue_failed',
    });
    expect(lines.join('\n')).not.toContain(email());
  });

  it('treats a failing R2 read like a failed send, not a missing file', async () => {
    const { deps } = setup([row()], fileFor());
    const readMirror = () => Promise.reject(new Error('r2 down'));

    await expect(runSweep({ ...deps, readMirror })).rejects.toThrow('sweep_enqueue_failed');
  });

  it('lets a pendingStages failure through (the database is down)', async () => {
    const { deps } = setup([]);
    const pendingStages = () => Promise.reject(new Error('db down'));

    await expect(runSweep({ ...deps, pendingStages })).rejects.toThrow('db down');
  });
});

describe('notImplementedPendingStages', () => {
  it('rejects with a constant error until stream R2 backs it with private.sweep_pending', async () => {
    await expect(notImplementedPendingStages(10)).rejects.toThrow(NOT_IMPLEMENTED_SWEEP);
  });
});

describe('r2TextReader', () => {
  const bucket = (objects: Record<string, string>) =>
    ({
      get: (key: string) =>
        Promise.resolve(
          key in objects ? { text: () => Promise.resolve(objects[key] ?? '') } : null,
        ),
    }) as unknown as R2Bucket;

  it('returns the object text, or null when the key is absent', async () => {
    const read = r2TextReader(bucket({ 'a/b.json': '{"x":1}' }));

    expect(await read('a/b.json')).toBe('{"x":1}');
    expect(await read('missing.json')).toBeNull();
  });
});
