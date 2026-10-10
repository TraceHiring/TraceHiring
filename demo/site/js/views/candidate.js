// Candidate screens: invite landing + consent, age check, start photo, rules, test, receipt.
import * as server from '../server.js';
import { h, field, pill, toast, append, replace } from '../dom.js';
import { fmtClock, fmtDateTime, ORG_NAME } from '../util.js';
import {
  cameraSupported,
  startCamera,
  stopCamera,
  isCameraOn,
  getVideo,
  drawBlurred,
  captureStill,
} from '../camera.js';
import { getStill } from '../store.js';
import { runTest } from './test-runner.js';
import { pageHead } from './shared.js';

const STEPS = [
  ['consent', 'What we record'],
  ['age', 'Age check'],
  ['photo', 'Start photo'],
  ['ready', 'Rules'],
  ['in_progress', 'Test'],
  ['submitted', 'Done'],
];

function stepper(stage) {
  const idx = STEPS.findIndex(([k]) => k === stage);
  return h(
    'ol',
    { class: 'steps', 'aria-label': 'Progress' },
    STEPS.map(([k, label], i) =>
      h(
        'li',
        {
          class: `step${i < idx ? ' is-done' : ''}${i === idx ? ' is-current' : ''}`,
          'aria-current': i === idx ? 'step' : null,
        },
        `${i + 1} ${label}`,
      ),
    ),
  );
}

// ---------------------------------------------------------------- candidate home
export function candidateHome({ main }) {
  const tests = server.listTests();
  const invites = tests.flatMap((t) =>
    server.invitesForTest(t.id).map((inv) => ({ inv, test: t })),
  );
  append(
    main,
    pageHead({
      crumbs: ['Candidate'],
      title: 'Your tests',
      sub: 'A candidate never creates an account: they open an invite link (plus an OTP in the product).',
    }),
    h(
      'div',
      { class: 'banner banner-neutral' },
      'Demo note: every role shares this browser, so this page lists all invites on it. In the product a candidate sees only their own invite and report.',
    ),
    h(
      'section',
      { class: 'card' },
      invites.length
        ? h(
            'ul',
            { class: 'list-plain' },
            invites.map(({ inv, test }) => {
              const a = server.attemptForInvite(inv.token);
              const done = a?.stage === 'submitted';
              return h(
                'li',
                { class: 'row' },
                h(
                  'div',
                  {},
                  h('div', { class: 'strong' }, inv.candidateLabel),
                  h('div', { class: 'caption' }, `${test.title} · ${test.durationMin} min`),
                ),
                h('span', { class: 'spacer' }),
                pill(a ? server.stageLabel(a.stage) : 'Not opened', done ? 'clear' : 'neutral'),
                done
                  ? h(
                      'a',
                      { class: 'btn btn-secondary btn-sm', href: `#/candidate/report/${a.id}` },
                      'View my report',
                    )
                  : h(
                      'a',
                      { class: 'btn btn-primary btn-sm', href: `#/c/${inv.token}` },
                      a ? 'Continue' : 'Open invite',
                    ),
              );
            }),
          )
        : h('p', { class: 'empty' }, 'No invites yet. Switch to Recruiter and generate one.'),
    ),
  );
  return { live: true };
}

// ---------------------------------------------------------------- the flow
export function candidateFlow(ctx) {
  const { main, params, render } = ctx;
  const token = params[0];
  const invite = server.getInvite(token);
  if (!invite) {
    append(
      main,
      h(
        'div',
        { class: 'card cand-shell stack-sm' },
        h('h1', { class: 'h3' }, 'This invite link is not valid'),
        h(
          'p',
          { class: 'muted' },
          'It may have been reset with "Reset demo". Ask the recruiter for a new link.',
        ),
      ),
    );
    return null;
  }
  const test = server.getTest(invite.testId);
  let attempt = server.openInvite(token);
  const shell = h('div', { class: 'cand-shell' });
  append(main, shell);

  if (attempt.stage === 'in_progress') {
    // A refresh lands here: the server deadline is unchanged.
    server.enforceDeadline(attempt.id);
    attempt = server.getAttempt(attempt.id);
  }

  const header = h(
    'div',
    { class: 'stack-sm' },
    h('div', { class: 'caption' }, `${ORG_NAME} · invite for ${invite.candidateLabel}`),
    stepper(attempt.stage === 'blocked_age' ? 'age' : attempt.stage),
  );
  append(shell, header);

  switch (attempt.stage) {
    case 'consent':
      return consentStep(shell, attempt, test, render);
    case 'age':
      return ageStep(shell, attempt, render);
    case 'blocked_age':
      return blockedStep(shell, attempt, render);
    case 'photo':
      return photoStep(shell, attempt, render);
    case 'ready':
      return readyStep(shell, attempt, test, render);
    case 'in_progress':
      return runTest(shell, attempt, test, { render });
    case 'submitted':
      return doneStep(shell, attempt, test);
    default:
      return null;
  }
}

function consentStep(shell, attempt, test, render) {
  const check = h('input', { type: 'checkbox', id: 'consent-check' });
  const btn = h(
    'button',
    { class: 'btn btn-primary', type: 'button', disabled: true },
    'Agree and continue',
  );
  check.addEventListener('change', () => (btn.disabled = !check.checked));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    await server.recordConsent(attempt.id);
    render();
  });
  const written = test.items.filter((i) => i.type === 'written').length;
  append(
    shell,
    h(
      'div',
      { class: 'stack' },
      h('h1', { class: 'display' }, 'Before you start: exactly what is recorded'),
      h(
        'p',
        { class: 'muted' },
        `${ORG_NAME} uses Trace to check that answers are your own work. ${test.title}: ${test.durationMin} minutes, ${test.items.length} questions (${written} written). Laptop or phone. You will see the same report the employer sees, and you can explain or respond to anything it shows. A person makes every decision.`,
      ),
      h(
        'div',
        { class: 'grid-2' },
        h(
          'section',
          { class: 'card stack-sm' },
          h('h2', { class: 'title' }, 'We record'),
          h(
            'ul',
            { class: 'list-tight' },
            h(
              'li',
              {},
              'Your answers, and every edit to them (to rebuild the final answer on the server)',
            ),
            h('li', {}, 'When you leave or return to the test tab or window, and fullscreen exits'),
            h('li', {}, 'Pastes into answers: the length only, never the pasted text'),
            h(
              'li',
              {},
              'A start photo and a few random still images, background blurred on your device',
            ),
          ),
        ),
        h(
          'section',
          { class: 'card stack-sm' },
          h('h2', { class: 'title' }, 'We never'),
          h(
            'ul',
            { class: 'list-tight' },
            h('li', {}, 'Guess your emotions, stress or personality'),
            h('li', {}, 'Flag you for looking away from the screen (people look up to think)'),
            h('li', {}, 'Score whether your writing "looks like AI"'),
            h('li', {}, 'Record your full session on video, or record audio in this test'),
            h('li', {}, 'Reject you automatically'),
          ),
        ),
        h(
          'section',
          { class: 'card stack-sm' },
          h('h2', { class: 'title' }, 'What leaves your device'),
          h(
            'ul',
            { class: 'list-tight' },
            h('li', {}, 'Start photo'),
            h('li', {}, 'Random stills the server asks for (3 in this test)'),
            h('li', {}, 'Stills around a flagged moment'),
            h('li', {}, 'Voice or video answers (none in this test)'),
          ),
          h(
            'p',
            { class: 'caption' },
            'In this prototype nothing is uploaded at all: stills stay in this browser.',
          ),
        ),
        h(
          'section',
          { class: 'card stack-sm' },
          h('h2', { class: 'title' }, 'Stays on your device'),
          h(
            'ul',
            { class: 'list-tight' },
            h('li', {}, 'The live camera video and every frame between stills'),
            h('li', {}, 'Ambient audio (the microphone is not used)'),
            h('li', {}, 'Your background: it is blurred before any still is kept'),
          ),
        ),
      ),
      h(
        'section',
        { class: 'card stack-sm' },
        h('h2', { class: 'title' }, 'Who sees it, and for how long'),
        h(
          'p',
          { class: 'small' },
          'The hiring team members assigned to you, and you. Stills are deleted 30 days after the decision. Every view of your evidence is logged and you can see who viewed it (by role). You can ask for your data or its deletion at any time. Grievance contact: grievance@example.invalid (demo).',
        ),
      ),
      h(
        'div',
        { class: 'card stack-sm' },
        h(
          'label',
          { class: 'check', for: 'consent-check' },
          check,
          h(
            'span',
            {},
            'I have read what is recorded and agree to continue. I can withdraw by closing the test; my data will then be deleted. ',
            h('span', { class: 'caption' }, `(${server.CONSENT_VERSION})`),
          ),
        ),
        h('div', { class: 'actions' }, btn),
      ),
    ),
  );
  return null;
}

function ageStep(shell, attempt, render) {
  const dob = h('input', {
    type: 'date',
    id: 'dob',
    max: new Date().toISOString().slice(0, 10),
    required: true,
  });
  const error = h('div', { 'aria-live': 'polite' });
  const go = async (e) => {
    e.preventDefault();
    if (!dob.value) {
      replace(error, h('p', { class: 'errors' }, 'Enter your date of birth.'));
      dob.focus();
      return;
    }
    const birth = new Date(`${dob.value}T00:00:00`);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age -= 1;
    dob.value = ''; // the date itself is never stored
    await server.recordAge(attempt.id, age >= 18);
    render();
  };
  append(
    shell,
    h(
      'form',
      { class: 'card stack', onsubmit: go, novalidate: true },
      h('h1', { class: 'h2' }, 'Confirm your age'),
      h(
        'p',
        { class: 'muted' },
        'Trace is open to candidates aged 18 and over at launch. We keep only "18 or over: yes", never your date of birth.',
      ),
      field('Date of birth', dob, 'Demo tip: try a date less than 18 years ago to see the block.'),
      error,
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Continue'),
      ),
    ),
  );
  return null;
}

function blockedStep(shell, attempt, render) {
  append(
    shell,
    h(
      'div',
      { class: 'card stack' },
      h('h1', { class: 'h2' }, 'You can’t take this test yet'),
      h(
        'p',
        {},
        'Trace is open to candidates aged 18 and over at launch. A parental-consent route is planned for later. Nothing from this test has been recorded, and your date of birth was not stored.',
      ),
      h(
        'p',
        { class: 'muted small' },
        'If you entered the wrong date, ask the recruiter to resend the invite.',
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'btn btn-secondary',
            type: 'button',
            onclick: () => {
              server.resetAgeBlock(attempt.id);
              render();
            },
          },
          'Demo only: go back to the age check',
        ),
      ),
    ),
  );
  return null;
}

function photoStep(shell, attempt, render) {
  let raf = 0;
  let stillId = null;
  const stage = h(
    'div',
    { class: 'camera-stage', role: 'img', 'aria-label': 'Camera preview' },
    h('span', {}, 'Camera is off'),
  );
  const status = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const actions = h('div', { class: 'actions' });

  const loop = (canvas) => {
    const v = getVideo();
    if (v) drawBlurred(v, canvas);
    raf = requestAnimationFrame(() => loop(canvas));
  };

  const showLive = () => {
    const canvas = h('canvas', { width: '480', height: '360' });
    replace(
      stage,
      canvas,
      h('span', { class: 'camera-badge' }, 'Live · background blurred on this device'),
    );
    cancelAnimationFrame(raf);
    loop(canvas);
    status.textContent =
      'This is what a reviewer would see in a still. The live video never leaves this device.';
    replace(
      actions,
      h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          onclick: () => {
            stillId = captureStill(getVideo());
            showStill();
          },
        },
        'Take start photo',
      ),
      declineBtn('Continue without camera'),
    );
  };

  const showStill = () => {
    cancelAnimationFrame(raf);
    const url = stillId ? getStill(stillId) : null;
    replace(
      stage,
      url
        ? h('img', { src: url, alt: 'Your start photo, background blurred' })
        : h('span', {}, 'Still unavailable'),
      h('span', { class: 'camera-badge' }, 'Start photo · kept in this browser'),
    );
    status.textContent =
      'Saved on this device only. In the product, this blurred still is the one image uploaded at the start.';
    replace(
      actions,
      h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          onclick: async () => {
            await server.recordPhoto(attempt.id, { camera: 'allowed', stillId });
            render();
          },
        },
        'Use this photo',
      ),
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: showLive }, 'Retake'),
    );
  };

  const declineBtn = (label) =>
    h(
      'button',
      {
        class: 'btn btn-secondary',
        type: 'button',
        onclick: async () => {
          cancelAnimationFrame(raf);
          stopCamera();
          await server.recordPhoto(attempt.id, { camera: 'declined', stillId: null });
          render();
        },
      },
      label,
    );

  const turnOn = async () => {
    status.textContent = 'Asking your browser for the camera…';
    try {
      await startCamera();
      showLive();
    } catch (err) {
      const denied = err?.name === 'NotAllowedError';
      status.textContent = denied
        ? 'Camera permission was declined. You can continue without it: the test is never blocked, the report notes lower evidence coverage.'
        : 'No camera is available here. You can continue without it.';
      replace(stage, h('span', {}, 'Placeholder: no camera'));
      replace(actions, declineBtn('Continue without camera'));
    }
  };

  if (isCameraOn()) showLive();
  else
    append(
      actions,
      cameraSupported()
        ? h(
            'button',
            { class: 'btn btn-primary', type: 'button', onclick: turnOn },
            'Turn on camera',
          )
        : null,
      declineBtn('Continue without camera'),
    );

  append(
    shell,
    h(
      'div',
      { class: 'grid-2' },
      h(
        'section',
        { class: 'card stack' },
        h('h1', { class: 'h2' }, 'Start photo'),
        h(
          'p',
          {},
          'One photo at the start, with your background blurred on this device. A face or ID mismatch never blocks the start; a person resolves it.',
        ),
        h(
          'ul',
          { class: 'list-tight small muted' },
          h('li', {}, 'No face template or biometric data is created.'),
          h('li', {}, 'Low light gives advice; it never blocks.'),
          h(
            'li',
            {},
            'Declining the camera never blocks the test. It lowers evidence coverage, and the report says so.',
          ),
        ),
        status,
        actions,
      ),
      h('div', { class: 'card' }, stage),
    ),
  );
  return { cleanup: () => cancelAnimationFrame(raf) };
}

function readyStep(shell, attempt, test, render) {
  const fsSupported =
    Boolean(document.documentElement.requestFullscreen) && document.fullscreenEnabled;
  const start = async (wantFullscreen) => {
    if (wantFullscreen && fsSupported) {
      // Requested inside the click (user gesture). Never wait on it: some embedded browsers
      // leave the promise pending, and the test must start regardless.
      document.documentElement.requestFullscreen().catch(() => {});
    }
    try {
      await server.startTest(attempt.id, {
        kind: deviceKind(),
        fullscreen: Boolean(document.fullscreenElement),
      });
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  append(
    shell,
    h(
      'section',
      { class: 'card stack' },
      h('h1', { class: 'h2' }, 'Rules for this test'),
      h(
        'ul',
        { class: 'list-tight' },
        h(
          'li',
          {},
          `${test.durationMin} minutes. The timer is held by the server: refreshing or closing the tab does not pause or reset it.`,
        ),
        h('li', {}, 'Every answer saves automatically. You can move between questions freely.'),
        h(
          'li',
          {},
          test.pastePolicy === 'blocked'
            ? 'Pasting from outside the test is turned off. Attempts are recorded (length only).'
            : 'Pasting is allowed. Pastes are recorded (length only); cite your source.',
        ),
        h(
          'li',
          {},
          'Leaving the tab or fullscreen is recorded. You will see a gentle reminder, never a penalty on your score.',
        ),
        h(
          'li',
          {},
          `Camera: ${attempt.camera === 'allowed' ? 'on, 3 random stills, background blurred' : 'off (declined)'}.`,
        ),
      ),
      h(
        'div',
        { class: 'banner' },
        'Your Answer Quality score is never lowered by integrity signals. They are a separate result, and a person reviews any flag before it is used.',
      ),
      h(
        'div',
        { class: 'actions' },
        fsSupported
          ? h(
              'button',
              { class: 'btn btn-primary', type: 'button', onclick: () => start(true) },
              'Start in fullscreen',
            )
          : null,
        h(
          'button',
          {
            class: fsSupported ? 'btn btn-secondary' : 'btn btn-primary',
            type: 'button',
            onclick: () => start(false),
          },
          fsSupported ? 'Start without fullscreen' : 'Start test',
        ),
      ),
    ),
  );
  return null;
}

function deviceKind() {
  const ua = navigator.userAgent;
  const phone = /Android|iPhone|iPad|Mobile/i.test(ua);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  return `${phone ? 'Phone' : 'Laptop'} · ${browser}`;
}

function doneStep(shell, attempt, test) {
  if (isCameraOn()) stopCamera();
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  append(
    shell,
    h(
      'section',
      { class: 'card stack' },
      h(
        'h1',
        { class: 'h2' },
        attempt.autoSubmitted ? 'Time ended: your answers were submitted' : 'Submitted',
      ),
      h(
        'p',
        {},
        `Saved at ${fmtClock(attempt.submittedAt)}, reference `,
        h('span', { class: 'receipt' }, attempt.receipt),
      ),
      h(
        'p',
        { class: 'muted small' },
        `${test.title} · ${fmtDateTime(attempt.submittedAt)}${attempt.camera === 'allowed' ? ' · the camera is now off' : ''}.`,
      ),
      h(
        'ul',
        { class: 'list-tight' },
        h(
          'li',
          {},
          'Your report is released after review, or after 7 days, whichever comes first.',
        ),
        h(
          'li',
          {},
          'If a confirmed flag is used in a decision, you get a notice and 72 hours to respond.',
        ),
        h('li', {}, 'Nothing is decided automatically.'),
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'a',
          { class: 'btn btn-primary', href: `#/candidate/report/${attempt.id}` },
          'View my report',
        ),
        h('a', { class: 'btn btn-secondary', href: '#/recruiter' }, 'Switch to Recruiter'),
      ),
      h(
        'p',
        { class: 'caption' },
        'Demo: the report opens straight away so you can compare both sides.',
      ),
    ),
  );
  return null;
}
