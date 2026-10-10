// Reviewer: action items. Only shortlisted candidates ever reach this queue (rule 6).
import * as server from '../server.js';
import { h, pill, append } from '../dom.js';
import { fmtLong, REVIEWERS } from '../util.js';
import { bandPill, pageHead, stat } from './shared.js';

const GROUPS = [
  {
    keys: ['in_review', 'notice_due'],
    title: 'Needs review',
    empty: 'Nothing waiting for review.',
  },
  {
    keys: ['awaiting'],
    title: 'Awaiting the candidate’s response',
    empty: 'No open response windows.',
  },
  {
    keys: ['ready_final'],
    title: 'Ready for the final call (a different reviewer)',
    empty: 'Nothing ready for a final call.',
  },
  { keys: ['decided'], title: 'Decided', empty: 'No final decisions yet.' },
];

export function reviewerQueue({ main, ui }) {
  const submitted = server.allAttempts().filter((a) => a.stage === 'submitted');
  const shortlisted = submitted.filter((a) => a.shortlist);
  const byKey = (keys) => shortlisted.filter((a) => keys.includes(server.triageStatus(a).key));
  const noReview = shortlisted.filter((a) =>
    ['advance', 'advance_interview', 'cleared'].includes(server.triageStatus(a).key),
  );
  const notUsed = submitted.filter((a) => !a.shortlist).length;

  append(
    main,
    pageHead({
      crumbs: ['Review queue', `Acting as ${REVIEWERS[ui.reviewer]}`],
      title: 'Action items',
      sub: 'Shortlisted candidates in Review or Strong concern, open response windows and final calls. Candidates below the score cutoff never appear here.',
    }),
    h(
      'div',
      { class: 'grid-stats' },
      stat('Needs review', byKey(GROUPS[0].keys).length, { accent: true }),
      stat('Awaiting response', byKey(GROUPS[1].keys).length),
      stat('Ready for final call', byKey(GROUPS[2].keys).length),
      stat('Flags not used (not shortlisted)', notUsed),
    ),
    ...GROUPS.map((g) => group(g.title, byKey(g.keys), g.empty, ui)),
    h(
      'section',
      { class: 'card stack-sm' },
      h('h2', { class: 'title' }, 'No integrity review needed'),
      noReview.length
        ? h(
            'ul',
            { class: 'list-plain' },
            noReview.map((a) =>
              h(
                'li',
                { class: 'row' },
                h('a', { href: `#/report/${a.id}` }, a.candidateLabel),
                h('span', { class: 'spacer' }),
                bandPill(a.results.integrity.band),
                pill(server.triageStatus(a).label, 'neutral'),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'None.'),
    ),
    h(
      'p',
      { class: 'caption' },
      'Your overturn rate is shown after 20 decisions. A reviewer who confirmed a flag cannot make the final call on it: the server blocks it.',
    ),
  );
  return { live: true };
}

function group(title, list, empty, ui) {
  return h(
    'section',
    { class: 'stack-sm' },
    h('h2', { class: 'title' }, `${title} · ${list.length}`),
    list.length
      ? h(
          'div',
          { class: 'grid-2' },
          list.map((a) => item(a, ui)),
        )
      : h('p', { class: 'muted small' }, empty),
  );
}

function item(a, ui) {
  const test = server.getTest(a.testId);
  const integ = a.results.integrity;
  const status = server.triageStatus(a);
  const notice = a.review.notice;
  let extra = `${integ.flags.length} flag(s): ${integ.flags.map((f) => f.name).join('; ')}`;
  if (status.key === 'awaiting')
    extra = `Response window: ${fmtLong(server.noticeRemainingMs(a))} left`;
  if (status.key === 'ready_final') {
    const gate = server.canDecide(a, ui.reviewer);
    extra = gate.ok ? 'You can make the final call.' : `Locked for you: ${gate.why}`;
  }
  if (status.key === 'decided')
    extra = `${server.OUTCOMES[a.review.final.outcome]} by ${REVIEWERS[a.review.final.by]}`;
  return h(
    'a',
    { class: 'queue-item stack-sm', href: `#/report/${a.id}` },
    h(
      'div',
      { class: 'row' },
      bandPill(integ.band),
      h('span', { class: 'spacer' }),
      h('span', { class: 'caption mono' }, `AQ ${a.results.aq.score}`),
    ),
    h('div', { class: 'strong' }, a.candidateLabel),
    h('div', { class: 'caption' }, test.title),
    h('div', { class: 'small' }, extra),
    notice && !a.review.final ? pill(`Notice by ${notice.by}`, 'outline') : null,
  );
}
