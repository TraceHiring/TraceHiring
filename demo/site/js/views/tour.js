// Guided demo tour: a small floating card that walks through the D1 flow.
import * as server from '../server.js';
import { h, clear, toast, append } from '../dom.js';
import { getUi, setUi } from '../store.js';

function latestPublished() {
  return server.listTests().find((t) => t.status === 'published') ?? null;
}

async function openInviteForTour() {
  // Reuse an unfinished invite if there is one, otherwise create a fresh synthetic one.
  for (const t of server.listTests()) {
    for (const inv of server.invitesForTest(t.id)) {
      const a = server.attemptForInvite(inv.token);
      if (!a || (a.stage !== 'submitted' && a.stage !== 'blocked_age')) return `#/c/${inv.token}`;
    }
  }
  const test = latestPublished();
  if (!test) return '#/recruiter';
  const inv = await server.createInvite(
    test.id,
    'Candidate G · Gauri (demo)',
    'gauri.demo@example.invalid',
  );
  toast('Created a synthetic invite for Candidate G.');
  return `#/c/${inv.token}`;
}

function sampleCandidate(letter) {
  return (
    server.allAttempts().find((a) => a.candidateLabel.startsWith(`Candidate ${letter} `)) ?? null
  );
}

const STEPS = [
  {
    title: 'Welcome to the Trace prototype',
    body: 'Everything runs in this browser with synthetic data. The ribbon’s “Reset demo” restores the sample test and six candidates at any time. Start as a recruiter.',
    go: () => ({ role: 'recruiter', hash: '#/recruiter' }),
    cta: 'Open the recruiter dashboard',
  },
  {
    title: '1 · Create a test',
    body: 'Add a written question with rubric points and an MCQ with options and a correct answer. “Fill with sample questions” is a shortcut. Then “Save and publish”.',
    go: () => ({ role: 'recruiter', hash: '#/recruiter/new' }),
    cta: 'Open the test builder',
  },
  {
    title: '2 · Invite a candidate',
    body: 'On a published test, generate an invite link. Copy it, or press “Open as candidate”. The token is random and fake.',
    go: () => {
      const t = latestPublished();
      return { role: 'recruiter', hash: t ? `#/recruiter/test/${t.id}` : '#/recruiter' };
    },
    cta: 'Open the latest published test',
  },
  {
    title: '3 · Take the test as the candidate',
    body: 'Read what is recorded and what stays on the device, confirm age (try an under-18 date to see the block), take a start photo with the background blurred on the device, or decline the camera.',
    go: async () => ({ role: 'candidate', hash: await openInviteForTour() }),
    cta: 'Open a candidate invite',
  },
  {
    title: '4 · Make some integrity signals',
    body: 'During the test, switch tabs, paste into a written answer, copy the question, or leave fullscreen. Each lands in “What is recorded so far” and later in the evidence timeline. Pastes keep the length only. Refresh the page: the timer does not reset.',
    go: null,
  },
  {
    title: '5 · Submit, or let time run out',
    body: 'Submit, or use “Skip to the last 20 seconds” to watch the auto-submit. You get a receipt and can open your report.',
    go: null,
  },
  {
    title: '6 · Results: score first',
    body: 'Sorted by Answer Quality only. Move the cutoff and shortlist. Integrity shows only for shortlisted rows; the rest say “Not used”. Bulk reject takes only the score cutoff.',
    go: () => {
      const t = latestPublished();
      return { role: 'recruiter', hash: t ? `#/recruiter/test/${t.id}/results` : '#/recruiter' };
    },
    cta: 'Open results',
  },
  {
    title: '7 · Reviewer R1 confirms and sends a notice',
    body: 'Open Candidate B (Review) or C (Strong concern). Confirm or overturn each flag with a rationale, then send the notice. Select any timeline event or still to see the watermarked, audited view.',
    go: () => {
      setUi({ reviewer: 'R1' });
      const c = sampleCandidate('B');
      return { role: 'reviewer', hash: c ? `#/report/${c.id}` : '#/reviewer' };
    },
    cta: 'Open Candidate B as R1',
  },
  {
    title: '8 · 72 hours, then a different reviewer',
    body: 'Press “Demo: simulate 72 h passing”. R1 is locked out of the final call. Switch to Reviewer R2 (top bar) to decide. Only confirmed flags appear on the decision screen.',
    go: null,
  },
  {
    title: '9 · The candidate’s view of the same report',
    body: 'On Candidate C’s report, switch “Viewing as” to “Candidate’s view”: the similarity flag no longer names the other candidate or shows their answer, and reviewer names become roles.',
    go: () => {
      const c = sampleCandidate('C');
      return { role: 'reviewer', hash: c ? `#/report/${c.id}` : '#/reviewer' };
    },
    cta: 'Open Candidate C',
  },
  {
    title: 'What is real, and what is simulated',
    body: 'The About page lists what exists in the codebase today (the M0a foundation) and the nine product rules in plain English.',
    go: () => ({ role: null, hash: '#/about' }),
    cta: 'Open About',
  },
];

export function openTour(ctx) {
  setUi({ tourOpen: true });
  renderTour(ctx);
  document.getElementById('tour-card')?.focus();
}

export function renderTour(ctx) {
  const root = document.getElementById('tour-root');
  clear(root);
  const ui = getUi();
  if (!ui.tourOpen) return;
  const i = Math.min(Math.max(0, ui.tourStep ?? 0), STEPS.length - 1);
  const s = STEPS[i];
  const goTo = (n) => {
    setUi({ tourStep: n });
    renderTour(ctx);
  };
  const run = async () => {
    const target = await s.go();
    if (target.role) setUi({ role: target.role });
    ctx.navigate(target.hash);
  };
  append(
    root,
    h(
      'aside',
      {
        class: 'tour stack-sm',
        id: 'tour-card',
        tabindex: '-1',
        'aria-labelledby': 'tour-h',
        role: 'dialog',
        'aria-modal': 'false',
      },
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'overline' }, `Demo tour · ${i + 1} of ${STEPS.length}`),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            onclick: () => {
              setUi({ tourOpen: false });
              renderTour(ctx);
            },
          },
          'Close',
        ),
      ),
      h(
        'div',
        { class: 'tour-progress', 'aria-hidden': 'true' },
        STEPS.map((_, n) => h('span', { class: n <= i ? 'is-on' : '' })),
      ),
      h('h2', { class: 'title', id: 'tour-h' }, s.title),
      h('p', { class: 'small' }, s.body),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            disabled: i === 0,
            onclick: () => goTo(i - 1),
          },
          'Back',
        ),
        s.go
          ? h('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: run }, s.cta)
          : null,
        h('span', { class: 'spacer' }),
        i < STEPS.length - 1
          ? h(
              'button',
              { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => goTo(i + 1) },
              'Next',
            )
          : h(
              'button',
              {
                class: 'btn btn-primary btn-sm',
                type: 'button',
                onclick: () => {
                  setUi({ tourOpen: false, tourStep: 0 });
                  renderTour(ctx);
                },
              },
              'Finish',
            ),
      ),
    ),
  );
}
