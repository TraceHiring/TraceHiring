// @vitest-environment happy-dom
// Client signals (specs/d1-demo-slice.md §4.6, rule 7): exactly the §4.6 table. Paste and drop are capture-phase on
// the document and prevented; a paste of the last in-test copy/cut selection (compared on the device) is not
// recorded; untrusted keyboard/input events are coalesced per item per 5 s; a hidden tab counts from 3 s; a
// fullscreen exit counts only after the test entered fullscreen and not at submit. Payloads are metadata only: never
// the pasted, dropped or typed text, clipboard content or file names.
import { ClientSignal } from '@trace/shared/contracts/candidate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutbox, type SignalBody } from './outbox';
import { installSignals, SIGNALS, type Signals } from './signals';

const SECRET = 'pasted words 1234';
let emitted: SignalBody[];
let item: number | null;
let signals: Signals;
let visibility: DocumentVisibilityState;
let fullscreen: Element | null;

const install = () => {
  signals = installSignals({
    doc: document,
    currentItem: () => item,
    emit: (s) => emitted.push(s),
    monoNow: () => Date.now(),
  });
};

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  emitted = [];
  item = 2;
  visibility = 'visible';
  fullscreen = null;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => fullscreen,
  });
  document.body.innerHTML = '';
  install();
});
afterEach(() => {
  signals.dispose();
  vi.useRealTimers();
});

/** A paste event carrying clipboard text (happy-dom has no ClipboardEvent constructor with data). */
const paste = (target: EventTarget, text: string): Event => {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? text : '') },
  });
  target.dispatchEvent(e);
  return e;
};

const drop = (target: EventTarget, types: string[], text = '', files = 0): Event => {
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    value: {
      types,
      files: { length: files, 0: { name: 'secret-file-name.pdf' } },
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  });
  target.dispatchEvent(e);
  return e;
};

const textarea = (): HTMLTextAreaElement => {
  const el = document.createElement('textarea');
  document.body.append(el);
  return el;
};

const allValid = () => {
  for (const s of emitted)
    expect(
      ClientSignal.safeParse({ seq: 1, t: 0, kind: 'signal', ...s }).success,
      JSON.stringify(s),
    ).toBe(true);
};

describe('paste (capture phase, prevented)', () => {
  it('records the item and the length only, and prevents the paste', () => {
    const el = textarea();
    // A listener on the element that stops propagation cannot hide the paste: the document listens in capture phase.
    el.addEventListener('paste', (e) => e.stopPropagation());
    const e = paste(el, SECRET);
    expect(e.defaultPrevented).toBe(true);
    expect(emitted).toEqual([{ sig: 'paste', item: 2, len: SECRET.length }]);
    expect(JSON.stringify(emitted)).not.toContain('pasted');
    allValid();
  });

  it('does not record a paste of the last in-test copy or cut selection (still prevented)', () => {
    const el = textarea();
    el.value = 'my own answer text';
    el.focus();
    el.setSelectionRange(0, 6);
    el.dispatchEvent(new Event('copy', { bubbles: true }));
    expect(paste(el, 'my own').defaultPrevented).toBe(true);
    expect(emitted).toEqual([]);
    el.setSelectionRange(7, 13);
    el.dispatchEvent(new Event('cut', { bubbles: true }));
    paste(el, 'answer');
    expect(emitted).toEqual([]);
    // Anything else is recorded.
    paste(el, 'my own answer');
    expect(emitted).toEqual([{ sig: 'paste', item: 2, len: 13 }]);
  });

  it('records item null when no item is shown', () => {
    item = null;
    paste(document.body, 'x');
    expect(emitted).toEqual([{ sig: 'paste', item: null, len: 1 }]);
    allValid();
  });
});

describe('paste rule per section (R5-24, R5-66 d)', () => {
  let allowed: boolean;
  beforeEach(() => {
    signals.dispose();
    allowed = true;
    signals = installSignals({
      doc: document,
      currentItem: () => item,
      emit: (s) => emitted.push(s),
      monoNow: () => Date.now(),
      pasteAllowed: () => allowed,
    });
  });

  it('allowed_logged: the paste goes through and is recorded (length only, never the text)', () => {
    const el = textarea();
    const e = paste(el, SECRET);
    expect(e.defaultPrevented).toBe(false);
    expect(emitted).toEqual([{ sig: 'paste', item: 2, len: SECRET.length }]);
    expect(JSON.stringify(emitted)).not.toContain('pasted');
    allValid();
  });

  it('blocked: the paste is prevented and recorded, as in D1', () => {
    allowed = false;
    const e = paste(textarea(), SECRET);
    expect(e.defaultPrevented).toBe(true);
    expect(emitted).toEqual([{ sig: 'paste', item: 2, len: SECRET.length }]);
  });

  it('dropping text stays blocked even where pasting is allowed', () => {
    const e = drop(textarea(), ['text/plain'], SECRET);
    expect(e.defaultPrevented).toBe(true);
    expect(emitted).toEqual([{ sig: 'drop', item: 2, len: SECRET.length, dt: 'text' }]);
  });
});

describe('drop (capture phase, prevented)', () => {
  it('SR-11: prevents dragover in capture phase, so a dropped file cannot navigate away (no signal)', () => {
    const el = document.createElement('div');
    document.body.append(el);
    el.addEventListener('dragover', (e) => e.stopPropagation());
    const e = new Event('dragover', { bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(emitted).toEqual([]);
    signals.dispose();
    const after = new Event('dragover', { bubbles: true, cancelable: true });
    el.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    install();
  });

  it('records text, files and other drops by kind and length, never a name or the text', () => {
    const el = textarea();
    expect(drop(el, ['text/plain'], SECRET).defaultPrevented).toBe(true);
    expect(drop(el, ['Files'], '', 2).defaultPrevented).toBe(true);
    expect(drop(el, ['text/uri-list']).defaultPrevented).toBe(true);
    expect(emitted).toEqual([
      { sig: 'drop', item: 2, len: SECRET.length, dt: 'text' },
      { sig: 'drop', item: 2, len: 2, dt: 'files' },
      { sig: 'drop', item: 2, len: 0, dt: 'other' },
    ]);
    const all = JSON.stringify(emitted);
    expect(all).not.toContain('secret');
    expect(all).not.toContain('pasted');
    allValid();
  });
});

describe('untrusted input', () => {
  it('records the first synthetic event at once, then coalesces the rest per item and kind over 5 s', () => {
    const el = textarea();
    for (let k = 0; k < 3; k += 1)
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // SR-1: the window's first event is recorded when it happens, before any edit it causes is queued.
    expect(emitted).toEqual([
      { sig: 'untrusted_input', item: 2, via: 'keydown', count: 1 },
      { sig: 'untrusted_input', item: 2, via: 'input', count: 1 },
    ]);
    vi.advanceTimersByTime(4_999);
    expect(emitted).toHaveLength(2);
    vi.advanceTimersByTime(1);
    // The two further keydowns come as one more signal when the window closes; the input window had no more.
    expect(emitted.slice(2)).toEqual([
      { sig: 'untrusted_input', item: 2, via: 'keydown', count: 2 },
    ]);
    // A new window after the first closed.
    item = 1;
    el.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    signals.flush();
    expect(emitted.at(-1)).toEqual({
      sig: 'untrusted_input',
      item: 1,
      via: 'beforeinput',
      count: 1,
    });
    allValid();
  });

  it('SR-1: the batch that carries an injected edit also carries the signal (or an earlier one did)', async () => {
    const sent: { events: { seq: number; kind: string; sig?: string }[] }[] = [];
    const outbox = createOutbox({
      api: {
        events: async (_token, batch) => {
          sent.push(structuredClone(batch));
          return {
            ok: true,
            value: {
              ackSeq: batch.events.at(-1)?.seq ?? 0,
              serverNow: new Date().toISOString(),
              deadlineAt: new Date(Date.now() + 600_000).toISOString(),
              state: 'in_progress',
            },
          };
        },
      },
      sessionToken: 'fakeSessionHead.fakeSessionBody.fakeSessionSig',
      streamId: '22222222-2222-4222-8222-222222222222',
      heartbeatSeconds: 10,
      texts: new Map(),
      choices: new Map(),
      monoNow: () => Date.now(),
      wallNow: () => Date.now(),
      on: {
        status: () => undefined,
        revert: () => undefined,
        ack: () => undefined,
        end: () => undefined,
      },
    });
    signals.dispose();
    signals = installSignals({
      doc: document,
      currentItem: () => 2,
      emit: (s) => outbox.signal(s),
      monoNow: () => Date.now(),
    });
    const el = textarea();
    // The page's own handler turns the input into an edit (as React's onChange does, after the capture listener).
    el.addEventListener('input', () => outbox.text(2, 'injected text', 10_000));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(2_000);
    const events = sent.flatMap((b) => b.events);
    const edit = events.findIndex((e) => e.kind === 'answer.text');
    const signal = events.findIndex((e) => e.sig === 'untrusted_input');
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(signal).toBeGreaterThanOrEqual(0);
    expect(signal).toBeLessThan(edit);
    outbox.stop();
  });

  it('dispose and pagehide record the open windows', () => {
    const el = textarea();
    el.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    el.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    window.dispatchEvent(new Event('pagehide'));
    expect(emitted).toEqual([
      { sig: 'untrusted_input', item: 2, via: 'beforeinput', count: 1 },
      { sig: 'untrusted_input', item: 2, via: 'beforeinput', count: 1 },
    ]);
    el.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    el.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    el.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    signals.dispose();
    expect(emitted.slice(2)).toEqual([
      { sig: 'untrusted_input', item: 2, via: 'beforeinput', count: 1 },
      { sig: 'untrusted_input', item: 2, via: 'beforeinput', count: 2 },
    ]);
    vi.advanceTimersByTime(10_000);
    expect(emitted).toHaveLength(4);
    install();
  });

  it('ignores trusted events', () => {
    const el = textarea();
    const e = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    Object.defineProperty(e, 'isTrusted', { value: true });
    el.dispatchEvent(e);
    vi.advanceTimersByTime(6_000);
    expect(emitted).toEqual([]);
  });
});

describe('tab_hidden', () => {
  const setVisibility = (v: DocumentVisibilityState) => {
    visibility = v;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('records an absence of 3 s or more on return, with the item shown when it started', () => {
    setVisibility('hidden');
    item = 1;
    vi.advanceTimersByTime(4_250);
    setVisibility('visible');
    expect(emitted).toEqual([{ sig: 'tab_hidden', item: 2, ms: 4_250 }]);
    allValid();
  });

  it('ignores an absence under 3 s', () => {
    setVisibility('hidden');
    vi.advanceTimersByTime(SIGNALS.tabHiddenMinMs - 1);
    setVisibility('visible');
    expect(emitted).toEqual([]);
  });
});

describe('fullscreen_exit', () => {
  const setFullscreen = (el: Element | null) => {
    fullscreen = el;
    document.dispatchEvent(new Event('fullscreenchange'));
  };

  it('records an exit only after the test entered fullscreen', () => {
    setFullscreen(null);
    expect(emitted).toEqual([]);
    setFullscreen(document.documentElement);
    setFullscreen(null);
    expect(emitted).toEqual([{ sig: 'fullscreen_exit', item: 2 }]);
    allValid();
  });

  it('counts a test that starts in fullscreen as entered', () => {
    signals.dispose();
    fullscreen = document.documentElement;
    install();
    setFullscreen(null);
    expect(emitted).toEqual([{ sig: 'fullscreen_exit', item: 2 }]);
  });

  it('records nothing when the exit is the submit', () => {
    setFullscreen(document.documentElement);
    signals.markSubmitting();
    setFullscreen(null);
    expect(emitted).toEqual([]);
  });
});

describe('dispose', () => {
  it('removes every listener', () => {
    signals.dispose();
    const el = textarea();
    const e = paste(el, 'x');
    expect(e.defaultPrevented).toBe(false);
    drop(el, ['text/plain'], 'x');
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    vi.advanceTimersByTime(10_000);
    expect(emitted).toEqual([]);
    install();
  });
});
