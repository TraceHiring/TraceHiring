// App shell: ribbon, role switcher, hash router, cross-tab sync.
import * as server from './server.js';
import { seedDemo } from './seed.js';
import { getUi, setUi, storageAvailable } from './store.js';
import { h, clear, toast, confirmDialog, append, replace } from './dom.js';
import { stopCamera } from './camera.js';
import { REVIEWERS, ORG_NAME } from './util.js';
import { recruiterHome, testEditor, testDetail, resultsView } from './views/recruiter.js';
import { candidateHome, candidateFlow } from './views/candidate.js';
import { reportView } from './views/report.js';
import { reviewerQueue } from './views/reviewer.js';
import { aboutView } from './views/about.js';
import { renderTour, openTour } from './views/tour.js';

const ROLE_HOME = { recruiter: '#/recruiter', candidate: '#/candidate', reviewer: '#/reviewer' };

const ROUTES = [
  { re: /^#\/recruiter$/, role: 'recruiter', view: recruiterHome },
  { re: /^#\/recruiter\/new$/, role: 'recruiter', view: testEditor },
  { re: /^#\/recruiter\/test\/([\w-]+)\/edit$/, role: 'recruiter', view: testEditor },
  { re: /^#\/recruiter\/test\/([\w-]+)\/results$/, role: 'recruiter', view: resultsView },
  { re: /^#\/recruiter\/test\/([\w-]+)$/, role: 'recruiter', view: testDetail },
  { re: /^#\/candidate$/, role: 'candidate', view: candidateHome },
  { re: /^#\/c\/([\w-]+)$/, role: 'candidate', view: candidateFlow },
  { re: /^#\/candidate\/report\/([\w-]+)$/, role: 'candidate', view: reportView, candidate: true },
  { re: /^#\/reviewer$/, role: 'reviewer', view: reviewerQueue },
  { re: /^#\/report\/([\w-]+)$/, role: null, view: reportView },
  { re: /^#\/about$/, role: null, view: aboutView },
];

const main = document.getElementById('main');
let current = null;

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function setRole(role) {
  setUi({ role });
  navigate(ROLE_HOME[role]);
}

function setReviewer(id) {
  setUi({ reviewer: id });
  render();
}

function renderRibbon() {
  const root = document.getElementById('ribbon');
  clear(root);
  append(
    root,
    h(
      'div',
      { class: 'ribbon', role: 'note' },
      h(
        'span',
        { class: 'ribbon-text' },
        h('span', { class: 'ribbon-dot', 'aria-hidden': 'true' }),
        h('strong', {}, 'Prototype: synthetic data, simulated server.'),
        h('span', { class: 'hide-sm' }, ' Nothing leaves this browser.'),
      ),
      h(
        'span',
        { class: 'ribbon-actions' },
        h(
          'button',
          { class: 'btn-ribbon', type: 'button', onclick: () => openTour(ctx()) },
          'Demo tour',
        ),
        h(
          'button',
          { class: 'btn-ribbon', type: 'button', onclick: () => navigate('#/about') },
          'About this prototype',
        ),
        h('button', { class: 'btn-ribbon', type: 'button', onclick: resetDemo }, 'Reset demo'),
      ),
    ),
  );
}

function renderTopbar() {
  const ui = getUi();
  const root = document.getElementById('topbar');
  clear(root);
  const roleBtn = (role, label) =>
    h(
      'button',
      { type: 'button', 'aria-pressed': String(ui.role === role), onclick: () => setRole(role) },
      label,
    );
  const reviewerBtn = (id) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': String(ui.reviewer === id),
        onclick: () => setReviewer(id),
        title: REVIEWERS[id],
      },
      id,
    );
  const initials = ui.role === 'reviewer' ? ui.reviewer : ui.role === 'candidate' ? 'C' : 'RM';
  append(
    root,
    h(
      'div',
      { class: 'topbar-inner' },
      h(
        'a',
        { class: 'brand', href: ROLE_HOME[ui.role] },
        'trace',
        h('span', { class: 'brand-dot' }, '.'),
      ),
      h(
        'div',
        { class: 'role-switch', role: 'group', 'aria-label': 'Demo role' },
        h('span', { class: 'segmented-label' }, 'View as'),
        h(
          'div',
          { class: 'segmented' },
          roleBtn('recruiter', 'Recruiter'),
          roleBtn('candidate', 'Candidate'),
          roleBtn('reviewer', 'Reviewer'),
        ),
      ),
      ui.role === 'reviewer'
        ? h(
            'div',
            { class: 'role-switch', role: 'group', 'aria-label': 'Acting reviewer' },
            h('span', { class: 'segmented-label' }, 'Acting as'),
            h('div', { class: 'segmented' }, reviewerBtn('R1'), reviewerBtn('R2')),
          )
        : null,
      h(
        'div',
        { class: 'topbar-org' },
        h(
          'span',
          {},
          ui.role === 'candidate'
            ? 'Candidate view'
            : ui.role === 'reviewer'
              ? `${ORG_NAME} · ${REVIEWERS[ui.reviewer]}`
              : `${ORG_NAME} · Meera (demo)`,
        ),
        h('span', { class: 'avatar', 'aria-hidden': 'true' }, initials),
      ),
    ),
  );
}

function ctx() {
  return { main, ui: getUi(), navigate, render, setRole, setUi };
}

function render() {
  if (current?.cleanup) {
    try {
      current.cleanup();
    } catch {
      // ignore
    }
  }
  current = null;
  const hash = location.hash || '';
  let route = ROUTES.find((r) => r.re.test(hash));
  if (!route) {
    location.replace(ROLE_HOME[getUi().role] ?? '#/recruiter');
    return;
  }
  const params = hash.match(route.re).slice(1);
  let ui = getUi();
  if (route.role && route.role !== ui.role) ui = setUi({ role: route.role });
  // Rule 5: in the Candidate role a report always renders the candidate projection.
  if (route.view === reportView && !route.candidate && ui.role === 'candidate') {
    location.replace(`#/candidate/report/${params[0]}`);
    return;
  }
  renderTopbar();
  clear(main);
  try {
    current =
      route.view({ ...ctx(), ui, params, candidateRoute: Boolean(route.candidate) }) ?? null;
  } catch (err) {
    console.error(err);
    append(
      main,
      h(
        'div',
        { class: 'card' },
        h('h1', { class: 'h3' }, 'Something went wrong in the prototype'),
        h('p', { class: 'muted' }, 'Try "Reset demo" in the ribbon.'),
      ),
    );
  }
  renderTour(ctx());
}

async function resetDemo() {
  const ok = await confirmDialog(
    'Reset the demo?',
    'This clears everything you created in this browser and reloads the sample test with six synthetic candidates.',
    'Reset demo',
  );
  if (!ok) return;
  stopCamera();
  seedDemo();
  setUi({ role: 'recruiter', reviewer: 'R1', tourStep: 0 });
  toast('Demo reset: sample test and six synthetic candidates loaded.');
  navigate('#/recruiter');
}

// Cross-tab sync: a candidate link opened in another tab updates the recruiter's tab.
window.addEventListener('storage', (event) => {
  if (!event.key || !event.key.startsWith('trace-demo:server')) return;
  server.reloadFromStorage();
  const busy =
    document.querySelector('dialog[open]') ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '');
  if (current?.live && !busy) render();
});

document.getElementById('skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  main.focus();
});

window.addEventListener('hashchange', render);

if (!server.hasData()) {
  seedDemo();
  setUi({ tourOpen: true, tourStep: 0 });
}
renderRibbon();
render();
if (!storageAvailable()) {
  toast('Browser storage is blocked: the demo runs in memory and resets on refresh.', 'error');
}
