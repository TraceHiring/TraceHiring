// @vitest-environment happy-dom
// The reload snapshot (specs/d1-demo-slice.md §4.7, SEC-2; M1 R5-9): v1 and v2 views are both kept, always without
// their answers, and a stored value that fits neither is ignored.
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_TOKEN, STREAM_ID, viewAt, viewV2At } from './fixtures.test-helpers';
import { clearSession, loadSession, saveSession, SESSION_KEY } from './session-store';

const NOW = Date.parse('2026-10-19T10:00:00.000Z');

afterEach(() => clearSession());

describe('session-store', () => {
  it('keeps a v1 view without its answers (as D1)', () => {
    const view = viewAt(NOW, { answers: [{ position: 2, text: 'synthetic draft' }] });
    saveSession({ sessionToken: SESSION_TOKEN, streamId: STREAM_ID, view });
    expect(sessionStorage.getItem(SESSION_KEY)).not.toContain('synthetic draft');
    expect(loadSession()).toEqual({
      sessionToken: SESSION_TOKEN,
      streamId: STREAM_ID,
      view: { ...view, answers: [] },
    });
  });

  it('keeps a v2 view without its answers', () => {
    const view = viewV2At(NOW, {
      answers: [
        { position: 1, choice: 'a' },
        { position: 3, text: 'synthetic draft' },
      ],
    });
    saveSession({ sessionToken: SESSION_TOKEN, streamId: STREAM_ID, view });
    expect(sessionStorage.getItem(SESSION_KEY)).not.toContain('synthetic draft');
    expect(loadSession()).toEqual({
      sessionToken: SESSION_TOKEN,
      streamId: STREAM_ID,
      view: { ...view, answers: [] },
    });
  });

  it('ignores a stored view that fits no contract', () => {
    const view = { ...viewV2At(NOW), v: 3 };
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ sessionToken: SESSION_TOKEN, streamId: STREAM_ID, view }),
    );
    expect(loadSession()).toBeNull();
  });
});
