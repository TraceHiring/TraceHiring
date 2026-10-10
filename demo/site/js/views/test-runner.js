// The in-test screen. The client only displays the server's deadline, autosaves every edit as
// a sequenced event, and reports real browser integrity events (T3, client-reported).
import * as server from '../server.js';
import { h, toast, confirmDialog, append, replace } from '../dom.js';
import { fmtMmSs, fnv1a, wordCount } from '../util.js';
import { isCameraOn, getVideo, captureStill, startCamera } from '../camera.js';

const SAVE_DEBOUNCE_MS = 600;
const MAX_NUDGES = 3;

export function runTest(shell, attemptIn, test, { render }) {
  const attemptId = attemptIn.id;
  const items = test.items;
  const answers = server.rebuildAnswers(attemptIn.editEvents);
  const resumed = attemptIn.editEvents.length > 0 || Date.now() - attemptIn.startedAt > 8000;
  let seq = attemptIn.lastSeq;
  let current = Math.max(
    0,
    items.findIndex((it) => answers[it.id] === undefined),
  );
  let pending = 0;
  let submitting = false;
  let cleaned = false;
  let nudges = 0;
  let hiddenAt = null;
  let blurAt = null;
  let wasFullscreen = Boolean(document.fullscreenElement);
  let lastUntrusted = 0;
  let timerHandle = 0;
  let stillHandle = 0;
  const announced = new Set();
  const debouncers = new Map();
  const inflight = new Set();
  const copiedHashes = new Set();
  const disposers = [];
  const fsSupported =
    Boolean(document.documentElement.requestFullscreen) && document.fullscreenEnabled;

  // ---------- elements ----------
  const timerEl = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Time left' }, '--:--');
  const srTimer = h('span', { class: 'sr-only', 'aria-live': 'polite' });
  const savedEl = h(
    'span',
    { class: 'saved', 'aria-live': 'polite' },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('span', { class: 'saved-text' }, 'All answers saved'),
  );
  const fsSlot = h('span', {});
  const submitBtn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Submit test');
  const nudgeSlot = h('div', { 'aria-live': 'polite' });
  const questionSlot = h('div', {});
  const navSlot = h('div', { class: 'qnav', role: 'group', 'aria-label': 'Questions' });
  const monitorList = h('ul', { class: 'monitor-list' });
  const cameraSlot = h('div', {});
  const logList = h('ol', { class: 'edit-log', reversed: true });
  const logCount = h('span', { class: 'caption' });

  append(
    shell,
    h(
      'div',
      { class: 'test-bar' },
      h('div', { class: 'strong small' }, test.title),
      h('span', { class: 'spacer' }),
      savedEl,
      fsSlot,
      timerEl,
      srTimer,
      submitBtn,
    ),
    resumed
      ? h(
          'div',
          { class: 'banner', role: 'status' },
          'Welcome back. Your answers and the timer were restored from the server: refreshing never resets the clock.',
        )
      : null,
    nudgeSlot,
    h(
      'div',
      { class: 'grid-main-side' },
      h(
        'div',
        { class: 'stack' },
        questionSlot,
        h(
          'div',
          { class: 'card card-tight stack-sm' },
          h('div', { class: 'caption' }, 'Questions (filled = answered)'),
          navSlot,
        ),
      ),
      h(
        'aside',
        { class: 'stack' },
        h(
          'section',
          { class: 'card stack-sm', 'aria-labelledby': 'mon-h' },
          h('h2', { class: 'title', id: 'mon-h' }, 'What is recorded so far'),
          h(
            'p',
            { class: 'caption' },
            'You see the same events the reviewer will. Content of pastes is never stored.',
          ),
          monitorList,
          cameraSlot,
        ),
        h(
          'section',
          { class: 'card stack-sm' },
          h(
            'details',
            {},
            h('summary', {}, 'Autosave edit log ', logCount),
            h(
              'p',
              { class: 'caption' },
              'Each edit is sent with a sequence number. The server rebuilds your final answer from these events.',
            ),
            logList,
          ),
        ),
        h(
          'section',
          { class: 'card stack-sm card-warn' },
          h('h2', { class: 'title' }, 'Demo controls'),
          h(
            'p',
            { class: 'caption' },
            'Not in the product. Moves the server deadline to show the auto-submit.',
          ),
          h(
            'button',
            {
              class: 'btn btn-secondary btn-sm',
              type: 'button',
              onclick: async () => {
                await server.demoSkipToEnd(attemptId, 20);
                toast('Server deadline moved: 20 seconds left.');
              },
            },
            'Skip to the last 20 seconds',
          ),
        ),
      ),
    ),
  );

  // ---------- saving ----------
  function setSaved(state, text) {
    savedEl.classList.toggle('is-saving', state === 'saving');
    savedEl.classList.toggle('is-error', state === 'error');
    savedEl.querySelector('.saved-text').textContent = text;
  }

  function save(itemId, value) {
    seq += 1;
    const mySeq = seq;
    pending += 1;
    setSaved('saving', 'Saving…');
    const p = server
      .saveEdit(attemptId, { seq: mySeq, itemId, value })
      .then(() => {
        pending -= 1;
        if (!pending)
          setSaved(
            'saved',
            `Saved · ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`,
          );
        refreshLog();
      })
      .catch((err) => {
        pending -= 1;
        setSaved('error', err.message);
        if (server.getAttempt(attemptId)?.stage === 'submitted') finish();
      })
      .finally(() => inflight.delete(p));
    inflight.add(p);
    return p;
  }

  function scheduleSave(itemId) {
    clearTimeout(debouncers.get(itemId));
    setSaved('saving', 'Editing…');
    debouncers.set(
      itemId,
      setTimeout(() => {
        debouncers.delete(itemId);
        save(itemId, answers[itemId]);
      }, SAVE_DEBOUNCE_MS),
    );
  }

  function flushAll() {
    for (const [itemId, t] of debouncers) {
      clearTimeout(t);
      save(itemId, answers[itemId]);
    }
    debouncers.clear();
    return Promise.allSettled([...inflight]);
  }

  // ---------- integrity events (T3, client-reported) ----------
  function post(type, extra = {}) {
    if (submitting || cleaned) return;
    server.postEvent(attemptId, { type, ...extra });
    refreshMonitor();
  }

  function showNudge(reason) {
    if (nudges >= MAX_NUDGES) return;
    nudges += 1;
    const diary = (note) =>
      h(
        'button',
        {
          class: 'btn btn-secondary btn-sm',
          type: 'button',
          onclick: () => {
            post('diary', { note });
            replace(
              nudgeSlot,
              h(
                'div',
                { class: 'banner banner-ok' },
                `Noted: "${note}". The reviewer sees your note next to the event.`,
              ),
            );
          },
        },
        note,
      );
    replace(
      nudgeSlot,
      h(
        'div',
        { class: 'nudge' },
        h(
          'span',
          {},
          `${reason} That is recorded as an event, not a penalty. Want to add a note? (reminder ${nudges} of ${MAX_NUDGES})`,
        ),
        h(
          'span',
          { class: 'actions' },
          diary('Someone entered'),
          diary('Power or network'),
          diary('Stepped away'),
        ),
      ),
    );
  }

  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    disposers.push(() => target.removeEventListener(type, fn, opts));
  }

  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      post('tab_hidden');
    } else if (hiddenAt) {
      const awayMs = Date.now() - hiddenAt;
      hiddenAt = null;
      post('tab_visible', { awayMs });
      showNudge(`You left the test tab for ${Math.round(awayMs / 1000)} s.`);
    }
  });
  listen(window, 'blur', () => {
    blurAt = Date.now();
    post('window_blur');
  });
  listen(window, 'focus', () => {
    if (!blurAt) return;
    const awayMs = Date.now() - blurAt;
    blurAt = null;
    post('window_focus', { awayMs });
    if (document.visibilityState === 'visible' && awayMs > 1500) {
      showNudge(`The test window lost focus for ${Math.round(awayMs / 1000)} s.`);
    }
  });
  listen(document, 'fullscreenchange', () => {
    if (document.fullscreenElement) wasFullscreen = true;
    else if (wasFullscreen) {
      wasFullscreen = false;
      post('fullscreen_exit');
      showNudge('You left fullscreen.');
    }
    paintFullscreen();
  });
  listen(document, 'copy', onCopy);
  listen(document, 'cut', onCopy);

  function onCopy(e) {
    const target = e.target;
    let text = '';
    if (target instanceof HTMLTextAreaElement) {
      text = target.value.slice(target.selectionStart, target.selectionEnd);
    } else {
      const sel = document.getSelection();
      text = sel ? String(sel) : '';
      const prompt = shell.querySelector('.prompt');
      if (text && prompt && sel.anchorNode && prompt.contains(sel.anchorNode)) {
        post('question_copy', { itemId: items[current].id, length: text.length });
      }
    }
    // Remember only a hash, so a later paste of the same text counts as "from within the test".
    if (text) copiedHashes.add(fnv1a(text));
  }

  function checkTrusted(e, itemId) {
    if (e.isTrusted) return;
    const t = Date.now();
    if (t - lastUntrusted < 3000) return;
    lastUntrusted = t;
    post('untrusted_input', { itemId });
  }

  // ---------- question rendering ----------
  function paintQuestion() {
    const item = items[current];
    const n = current + 1;
    const promptEl = h('p', { class: 'prompt', id: 'q-prompt' }, item.prompt);
    let body;
    if (item.type === 'mcq') {
      body = h(
        'fieldset',
        { class: 'plain-fieldset mcq-options', 'aria-labelledby': 'q-prompt' },
        item.options.map((opt, j) =>
          h(
            'label',
            { class: 'mcq-option' },
            h('input', {
              type: 'radio',
              name: `ans-${item.id}`,
              value: String(j),
              checked: Number(answers[item.id]) === j && answers[item.id] !== undefined,
              onchange: (e) => {
                checkTrusted(e, item.id);
                answers[item.id] = j;
                save(item.id, j);
                paintNav();
              },
            }),
            h('span', {}, opt),
          ),
        ),
      );
    } else {
      const counter = h('span', { class: 'caption', 'aria-live': 'off' });
      const note = h('p', { class: 'caption', 'aria-live': 'polite' });
      const ta = h('textarea', {
        id: 'answer',
        rows: '9',
        value: answers[item.id] ?? '',
        spellcheck: 'true',
        'aria-labelledby': 'q-prompt',
        'aria-describedby': 'answer-help',
      });
      const updateCount = () =>
        (counter.textContent = `${wordCount(ta.value)} words · aim ${item.rubric.minWords}+`);
      ta.addEventListener('input', (e) => {
        checkTrusted(e, item.id);
        answers[item.id] = ta.value;
        updateCount();
        scheduleSave(item.id);
        paintNav();
      });
      ta.addEventListener('blur', () => {
        if (debouncers.has(item.id)) {
          clearTimeout(debouncers.get(item.id));
          debouncers.delete(item.id);
          save(item.id, answers[item.id]);
        }
      });
      ta.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text') ?? '';
        const length = text.length;
        const internal = copiedHashes.has(fnv1a(text));
        const blocked = test.pastePolicy === 'blocked' && !internal;
        if (blocked) e.preventDefault();
        post('paste', { itemId: item.id, length, blocked, internal });
        note.textContent = internal
          ? 'Paste from within the test: allowed and ignored.'
          : blocked
            ? `Pasting from outside the test is off for this test. The attempt (${length} characters, not the text) is recorded.`
            : `Paste recorded (${length} characters, not the text).`;
      });
      updateCount();
      body = h(
        'div',
        { class: 'stack-sm' },
        ta,
        h(
          'div',
          { class: 'row', id: 'answer-help' },
          counter,
          h('span', { class: 'spacer' }),
          h('span', { class: 'caption' }, `Paste ${test.pastePolicy}`),
        ),
        note,
      );
    }
    replace(
      questionSlot,
      h(
        'section',
        { class: 'card stack', 'aria-label': `Question ${n} of ${items.length}` },
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'overline' }, `Question ${n} of ${items.length}`),
          h(
            'span',
            { class: 'caption' },
            `${item.type === 'mcq' ? 'Multiple choice' : 'Written answer'} · ${item.points} pts`,
          ),
        ),
        promptEl,
        body,
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              class: 'btn btn-secondary',
              type: 'button',
              disabled: current === 0,
              onclick: () => go(current - 1),
            },
            'Previous',
          ),
          h('span', { class: 'spacer' }),
          current < items.length - 1
            ? h(
                'button',
                { class: 'btn btn-primary', type: 'button', onclick: () => go(current + 1) },
                'Next question',
              )
            : h(
                'button',
                { class: 'btn btn-primary', type: 'button', onclick: askSubmit },
                'Review and submit',
              ),
        ),
      ),
    );
  }

  function go(index) {
    flushAll();
    current = index;
    paintQuestion();
    paintNav();
    questionSlot.querySelector('textarea, input')?.focus({ preventScroll: false });
  }

  function isAnswered(item) {
    const v = answers[item.id];
    return item.type === 'mcq' ? v !== undefined && v !== null && v !== '' : wordCount(v) > 0;
  }

  function paintNav() {
    replace(
      navSlot,
      ...items.map((item, i) =>
        h(
          'button',
          {
            type: 'button',
            class: isAnswered(item) ? 'is-answered' : '',
            'aria-current': i === current ? 'true' : null,
            'aria-label': `Question ${i + 1}, ${isAnswered(item) ? 'answered' : 'not answered'}`,
            onclick: () => go(i),
          },
          String(i + 1),
        ),
      ),
    );
  }

  function paintFullscreen() {
    replace(
      fsSlot,
      fsSupported && !document.fullscreenElement
        ? h(
            'button',
            {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              onclick: () => document.documentElement.requestFullscreen().catch(() => {}),
            },
            'Fullscreen',
          )
        : '',
    );
  }

  // ---------- monitor + log ----------
  function refreshMonitor() {
    const a = server.getAttempt(attemptId);
    if (!a) return;
    const count = (pred) => a.events.filter(pred).length;
    const pastes = a.events.filter((e) => e.type === 'paste');
    const rows = [
      ['Left the tab or app', count((e) => e.type === 'tab_hidden')],
      ['Window lost focus', count((e) => e.type === 'window_blur')],
      ['Fullscreen exits', count((e) => e.type === 'fullscreen_exit')],
      [
        'Pastes (length only)',
        pastes.length ? `${pastes.length} · ${pastes.reduce((s, e) => s + e.length, 0)} chars` : 0,
      ],
      ['Question text copied', count((e) => e.type === 'question_copy')],
      [
        'Random stills (on device)',
        `${count((e) => e.type === 'still' && e.reason === 'random')} of 3`,
      ],
      ['Your notes', count((e) => e.type === 'diary')],
    ];
    const untrusted = count((e) => e.type === 'untrusted_input');
    if (untrusted) rows.push(['Untrusted input events', untrusted]);
    replace(
      monitorList,
      ...rows.map(([k, v]) => h('li', {}, h('span', {}, k), h('strong', {}, String(v)))),
    );
    paintCamera(a);
  }

  function paintCamera(a) {
    if (a.camera !== 'allowed') {
      replace(
        cameraSlot,
        h(
          'p',
          { class: 'caption' },
          'Camera: off (declined). Evidence coverage is lower; the test is not blocked.',
        ),
      );
    } else if (isCameraOn()) {
      replace(
        cameraSlot,
        h('p', { class: 'caption' }, 'Camera: on. Only blurred stills are kept, in this browser.'),
      );
    } else {
      replace(
        cameraSlot,
        h(
          'div',
          { class: 'banner banner-warn stack-sm' },
          h('div', {}, 'Camera is off since the page reloaded. Random stills will be skipped.'),
          h(
            'button',
            {
              class: 'btn btn-secondary btn-sm',
              type: 'button',
              onclick: async () => {
                try {
                  await startCamera();
                } catch {
                  toast('Camera not available.', 'error');
                }
                refreshMonitor();
              },
            },
            'Turn camera back on',
          ),
        ),
      );
    }
  }

  function refreshLog() {
    const a = server.getAttempt(attemptId);
    if (!a) return;
    const list = [...a.editEvents].sort((x, y) => y.seq - x.seq).slice(0, 30);
    logCount.textContent = `(${a.editEvents.length} events)`;
    replace(
      logList,
      ...list.map((e) => {
        const n = items.findIndex((it) => it.id === e.itemId) + 1;
        const desc =
          typeof e.value === 'number' ? `option ${e.value + 1}` : `${String(e.value).length} chars`;
        return h('li', {}, `#${e.seq} · ${fmtMmSs(e.t)} · Q${n} · ${desc}`);
      }),
    );
  }

  // ---------- timer (display only: the deadline lives on the server) ----------
  async function tick() {
    if (submitting || cleaned) return;
    const a = server.getAttempt(attemptId);
    if (!a || a.stage === 'submitted') return finish();
    const left = a.deadline - Date.now();
    timerEl.textContent = fmtMmSs(left);
    timerEl.classList.toggle('is-low', left < 60000);
    for (const [mark, text] of [
      [300000, '5 minutes left'],
      [60000, '1 minute left'],
      [10000, '10 seconds left'],
    ]) {
      if (left <= mark && left > mark - 2000 && !announced.has(mark)) {
        announced.add(mark);
        srTimer.textContent = text;
      }
    }
    if (left <= 1500 && debouncers.size) flushAll();
    if (left <= 0) {
      submitting = true;
      setSaved('saving', 'Time is up: submitting…');
      await Promise.allSettled([...inflight]);
      try {
        await server.timeUp(attemptId);
      } catch {
        server.enforceDeadline(attemptId);
      }
      finish();
    }
  }

  function pollStills() {
    if (submitting || cleaned) return;
    for (const req of server.dueStillRequests(attemptId)) {
      const id = isCameraOn() ? captureStill(getVideo()) : null;
      server.fulfilStill(attemptId, req.index, id);
    }
    refreshMonitor();
  }

  async function askSubmit() {
    const unanswered = items.filter((it) => !isAnswered(it)).length;
    const ok = await confirmDialog(
      'Submit your test?',
      unanswered
        ? `${unanswered} question(s) are not answered. You cannot change answers after submitting.`
        : 'All questions are answered. You cannot change answers after submitting.',
      'Submit test',
    );
    if (!ok || submitting) return;
    submitting = true;
    setSaved('saving', 'Submitting…');
    await flushAll();
    try {
      await server.submit(attemptId);
    } catch (err) {
      toast(err.message, 'error');
    }
    finish();
  }

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    for (const d of disposers) d();
    clearInterval(timerHandle);
    clearInterval(stillHandle);
    for (const t of debouncers.values()) clearTimeout(t);
  }

  function finish() {
    if (cleaned) return;
    cleanup();
    render();
  }

  submitBtn.addEventListener('click', askSubmit);
  paintQuestion();
  paintNav();
  paintFullscreen();
  refreshMonitor();
  refreshLog();
  tick();
  timerHandle = setInterval(tick, 250);
  stillHandle = setInterval(pollStills, 1000);
  return { cleanup };
}
