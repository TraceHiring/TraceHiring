// Client signals on the test screen only (specs/d1-demo-slice.md §4.6, rules 7 and 8). Exactly the §4.6 table and
// nothing else: paste and drop (capture phase on the document, prevented), untrusted keyboard or input events,
// a hidden tab of 3 s or more, and a fullscreen exit after the test entered fullscreen. Every payload is metadata
// (item position, length, count, duration). The text of a paste or drop, clipboard content, typed text and file
// names never leave this module; the last in-test copy/cut selection is kept in memory only, to compare a paste
// with it on the device (a paste of the candidate's own text is not recorded, plan §6). No gaze, no face, no
// emotion, no device or network fact. Listeners are capture-phase through the boolean third argument.
import type { SignalBody } from './outbox';

export const SIGNALS = {
  untrustedWindowMs: 5_000,
  tabHiddenMinMs: 3_000,
} as const;

export interface SignalDeps {
  doc: Document;
  /** The item position shown, or null. */
  currentItem: () => number | null;
  emit: (signal: SignalBody) => void;
  /** Monotonic ms (performance.now). */
  monoNow?: () => number;
}

export interface Signals {
  /** From now on a fullscreen exit is the submit, not a signal (`false` again if the submit did not go through). */
  markSubmitting(on?: boolean): void;
  /** Emits the open untrusted-input windows now (before a submit). */
  flush(): void;
  /** Removes every listener and timer. */
  dispose(): void;
}

type Via = 'keydown' | 'beforeinput' | 'input';

interface Window5s {
  item: number | null;
  via: Via;
  count: number;
  timer: ReturnType<typeof setTimeout>;
}

/** The selected text of the focused field, or of the page. Kept in memory only. */
const selectionOf = (doc: Document): string => {
  const el = doc.activeElement;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    return el.value.slice(start, end);
  }
  return doc.getSelection()?.toString() ?? '';
};

export const installSignals = (deps: SignalDeps): Signals => {
  const { doc, currentItem, emit } = deps;
  const mono = deps.monoNow ?? (() => performance.now());
  let lastCopy: string | null = null;
  let submitting = false;
  let hiddenAt: number | null = null;
  let hiddenItem: number | null = null;
  let inFullscreen = doc.fullscreenElement !== null && doc.fullscreenElement !== undefined;
  const windows = new Map<string, Window5s>();

  const onCopy = () => {
    lastCopy = selectionOf(doc);
  };

  const onPaste = (event: Event) => {
    event.preventDefault();
    const data = (event as ClipboardEvent).clipboardData;
    const text = data?.getData('text/plain') ?? '';
    if (lastCopy !== null && lastCopy !== '' && text === lastCopy) return;
    emit({ sig: 'paste', item: currentItem(), len: text.length });
  };

  const onDrop = (event: Event) => {
    event.preventDefault();
    const data = (event as DragEvent).dataTransfer;
    const types = Array.from(data?.types ?? []);
    const item = currentItem();
    if (types.includes('Files')) {
      emit({ sig: 'drop', item, len: data?.files.length ?? 0, dt: 'files' });
    } else if (types.includes('text/plain') || types.includes('text')) {
      emit({ sig: 'drop', item, len: (data?.getData('text/plain') ?? '').length, dt: 'text' });
    } else {
      emit({ sig: 'drop', item, len: 0, dt: 'other' });
    }
  };

  const close = (key: string) => {
    const open = windows.get(key);
    if (open === undefined) return;
    windows.delete(key);
    clearTimeout(open.timer);
    emit({ sig: 'untrusted_input', item: open.item, via: open.via, count: open.count });
  };

  const onUntrusted = (via: Via) => (event: Event) => {
    if (event.isTrusted) return;
    const item = currentItem();
    const key = `${item ?? 'none'}:${via}`;
    const open = windows.get(key);
    if (open !== undefined) {
      open.count += 1;
      return;
    }
    windows.set(key, {
      item,
      via,
      count: 1,
      timer: setTimeout(() => close(key), SIGNALS.untrustedWindowMs),
    });
  };
  const onKeydown = onUntrusted('keydown');
  const onBeforeInput = onUntrusted('beforeinput');
  const onInput = onUntrusted('input');

  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      if (hiddenAt === null) {
        hiddenAt = mono();
        hiddenItem = currentItem();
      }
      return;
    }
    if (hiddenAt === null) return;
    const ms = Math.max(0, Math.round(mono() - hiddenAt));
    hiddenAt = null;
    if (ms >= SIGNALS.tabHiddenMinMs) emit({ sig: 'tab_hidden', item: hiddenItem, ms });
  };

  const onFullscreen = () => {
    if (doc.fullscreenElement !== null && doc.fullscreenElement !== undefined) {
      inFullscreen = true;
      return;
    }
    if (!inFullscreen) return;
    inFullscreen = false;
    if (!submitting) emit({ sig: 'fullscreen_exit', item: currentItem() });
  };

  const listeners: [string, (event: Event) => void][] = [
    ['copy', onCopy],
    ['cut', onCopy],
    ['paste', onPaste],
    ['drop', onDrop],
    ['keydown', onKeydown],
    ['beforeinput', onBeforeInput],
    ['input', onInput],
    ['visibilitychange', onVisibility],
    ['fullscreenchange', onFullscreen],
  ];
  for (const [type, fn] of listeners) doc.addEventListener(type, fn, true);

  const flush = () => {
    for (const key of [...windows.keys()]) close(key);
  };

  return {
    markSubmitting(on = true) {
      submitting = on;
    },
    flush,
    dispose() {
      for (const [type, fn] of listeners) doc.removeEventListener(type, fn, true);
      for (const open of windows.values()) clearTimeout(open.timer);
      windows.clear();
      lastCopy = null;
    },
  };
};
