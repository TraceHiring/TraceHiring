// Small view components shared across screens.
import { h, pill } from '../dom.js';
import { BANDS, FAMILIES } from '../band.js';

export function bandPill(band, { candidate = false } = {}) {
  const b = BANDS[band];
  // Always text, never colour-only (tokens.json bandPill rule).
  return pill(candidate ? `${b.label} · ${b.candidate}` : b.label, b.tone, {
    class: `pill pill-${b.tone} band-pill`,
  });
}

export function notUsedPill() {
  return pill('Not used', 'neutral', {
    title: 'Not shortlisted: integrity signals are not used in any decision',
  });
}

export function familyDot(family) {
  return h('span', { class: `dot fam-${family}`, 'aria-hidden': 'true', title: FAMILIES[family] });
}

export function pageHead({ crumbs = [], title, sub, actions = [] }) {
  return h(
    'div',
    { class: 'page-head' },
    h(
      'div',
      {},
      crumbs.length ? h('div', { class: 'crumbs' }, crumbs) : null,
      h('h1', { class: 'display' }, title),
      sub ? h('p', { class: 'sub' }, sub) : null,
    ),
    actions.length ? h('div', { class: 'actions' }, actions) : null,
  );
}

export function stat(label, value, { accent = false } = {}) {
  return h(
    'div',
    { class: `card card-tight stat${accent ? ' card-accent' : ''}` },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'metric' }, String(value)),
  );
}

export function link(href, text, cls = '') {
  return h('a', { href, class: cls }, text);
}

export function btnLink(href, text, tone = 'secondary', extra = {}) {
  return h('a', { href, class: `btn btn-${tone}`, ...extra }, text);
}

export function sampleTag() {
  return pill('Synthetic data', 'outline');
}
