// The evidence report: same report on both sides (rule 5), two separate results (rule 1),
// reviewer actions with notice + 72 h and a second reviewer (rule 4).
import * as server from '../server.js';
import { h, bar, pill, toast, openDialog, uid, append, replace } from '../dom.js';
import { buildOrgReport, projectForCandidate } from '../report-model.js';
import { BANDS, FAMILIES, TIERS, RULES, THRESHOLDS, RULESET_VERSION } from '../band.js';
import { CONTENT_SHARE } from '../grader.js';
import { getStill } from '../store.js';
import { watermarked } from '../camera.js';
import {
  fmtClock,
  fmtClockSec,
  fmtDateTime,
  fmtMmSs,
  fmtLong,
  REVIEWERS,
  actorLabel,
} from '../util.js';
import { bandPill, familyDot, sampleTag } from './shared.js';

const candidateToggle = new Map();

export function reportView(ctx) {
  const { main, params, ui, candidateRoute } = ctx;
  const attempt = server.getAttempt(params[0]);
  if (!attempt || attempt.stage !== 'submitted') {
    append(
      main,
      h(
        'div',
        { class: 'card empty' },
        'This report is not available yet (the test has not been submitted).',
      ),
    );
    return null;
  }
  const asCandidate = candidateRoute || candidateToggle.get(attempt.id) === true;
  const viewer = candidateRoute ? 'candidate' : ui.role === 'reviewer' ? ui.reviewer : 'recruiter';
  const timers = [];
  const state = { ctx, attemptId: attempt.id, asCandidate, viewer, timers, candidateRoute };
  paint(state);
  return {
    live: true,
    cleanup: () => {
      for (const t of state.timers) clearInterval(t);
    },
  };
}

function paint(state) {
  const { ctx } = state;
  for (const t of state.timers) clearInterval(t);
  state.timers.length = 0;
  const attempt = server.getAttempt(state.attemptId);
  const org = buildOrgReport(attempt);
  const model = state.asCandidate ? projectForCandidate(org) : org;
  const scrollY = window.scrollY;
  replace(ctx.main, renderReport(model, state));
  window.scrollTo(0, scrollY);
}

function rerender(state) {
  paint(state);
}

// ------------------------------------------------------------------ layout
function renderReport(m, state) {
  const cand = m.kind === 'candidate';
  const wrap = h('div', { class: 'stack' });
  const viewerText = state.viewer === 'candidate' ? 'Candidate' : actorLabel(state.viewer);

  const toggle = !state.candidateRoute
    ? h(
        'div',
        { class: 'viewing-as' },
        h('span', { class: 'caption' }, 'Viewing as'),
        h(
          'div',
          { class: 'segmented', role: 'group', 'aria-label': 'Report view' },
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': String(!cand),
              onclick: () => {
                candidateToggle.set(m.attemptId, false);
                state.asCandidate = false;
                rerender(state);
              },
            },
            state.viewer === 'recruiter' ? 'Recruiter' : 'Reviewer',
          ),
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': String(cand),
              onclick: () => {
                candidateToggle.set(m.attemptId, true);
                state.asCandidate = true;
                rerender(state);
              },
            },
            "Candidate's view",
          ),
        ),
      )
    : null;

  append(
    wrap,
    h(
      'div',
      { class: 'page-head' },
      h(
        'div',
        {},
        h(
          'div',
          { class: 'crumbs' },
          cand ? 'Your report' : [h('a', { href: '#/recruiter' }, 'Tests'), ' / ', m.testTitle],
          sampleTag(),
        ),
        h('h1', { class: 'display' }, cand ? `Your report · ${m.testTitle}` : m.candidateLabel),
        h(
          'p',
          { class: 'mono caption' },
          `Submitted ${fmtDateTime(m.submittedAt)}${m.autoSubmitted ? ' (auto, time-out)' : ''} · Receipt ${m.receipt} · ${m.versions.ruleset} · frozen at first start · ${m.versions.grader} · ${m.versions.consent} · Stills deleted 30 days after the decision`,
        ),
      ),
      toggle,
    ),
  );

  if (cand && !state.candidateRoute) {
    append(
      wrap,
      h(
        'div',
        { class: 'banner banner-ok' },
        'Preview of the candidate projection: the same report, built from an allow-list that drops other people’s data, reviewer names and exact thresholds.',
      ),
    );
  }
  append(
    wrap,
    h(
      'div',
      { class: 'banner', role: 'note' },
      cand
        ? 'This is the same report the employer sees, without other people’s data. Nothing is decided automatically. If a flag is used in a decision, you get a notice and 72 hours to respond, and a different reviewer decides.'
        : 'This is the same report the candidate sees. Nothing is decided automatically. If a flag is used in a decision, the candidate gets 72 hours to respond and a different reviewer decides.',
    ),
  );

  // Two separate results, side by side, never combined (rule 1).
  append(wrap, h('div', { class: 'grid-2' }, aqCard(m), integrityCard(m, state)));

  const auditSlot = h('div', {});
  const paintAudit = () => replace(auditSlot, auditCard(server.getAttempt(m.attemptId), cand));
  paintAudit();
  const env = { m, state, cand, viewerText, paintAudit };

  if (!m.integrity.notUsed) {
    append(
      wrap,
      h(
        'div',
        { class: 'grid-main-side' },
        h('div', { class: 'stack' }, flagsSection(env), familiesCard(m), timelineCard(env)),
        h('div', { class: 'stack' }, cand ? candidatePanel(env) : reviewPanel(env), auditSlot),
      ),
    );
  } else {
    append(
      wrap,
      h(
        'div',
        { class: 'grid-main-side' },
        answersCard(m),
        h('div', { class: 'stack' }, auditSlot),
      ),
    );
    return wrap;
  }
  append(wrap, answersCard(m));
  return wrap;
}

// ------------------------------------------------------------------ answer quality
function aqCard(m) {
  const sections = m.aq.sections;
  return h(
    'section',
    { class: 'card stack-sm', 'aria-labelledby': 'aq-h' },
    h('h2', { class: 'overline', id: 'aq-h' }, 'Answer Quality'),
    h(
      'p',
      { class: 'caption' },
      `${m.versions.grader} (MCQ exact key; written: keyword + length rubric, stands in for the LLM rubric) · not affected by integrity signals`,
    ),
    h(
      'p',
      {},
      h('span', { class: 'score-xl' }, String(m.aq.score)),
      h('span', { class: 'muted' }, ' / 100'),
    ),
    h(
      'div',
      { class: 'stack-sm' },
      barRow('Multiple choice', sections.mcq.earned, sections.mcq.max),
      barRow('Written', sections.written.earned, sections.written.max),
      ...m.aq.items.map((it) =>
        barRow(
          `Q${it.n} · ${it.type === 'mcq' ? 'MCQ' : 'written'}`,
          it.grade.earned,
          it.grade.points,
        ),
      ),
    ),
    m.scoreDecision
      ? h(
          'div',
          { class: 'banner banner-neutral' },
          'Not progressed on Answer Quality (below the cutoff). Integrity was not used.',
        )
      : null,
  );
}

function barRow(label, earned, max) {
  return h(
    'div',
    { class: 'bar-row' },
    h('span', {}, label),
    bar(earned, max),
    h('span', { class: 'mono' }, `${earned}/${max}`),
  );
}

// ------------------------------------------------------------------ integrity summary
function integrityCard(m, state) {
  const cand = m.kind === 'candidate';
  const integ = m.integrity;
  const head = h(
    'div',
    { class: 'card-head' },
    h('h2', { class: 'overline', id: 'int-h' }, 'Integrity Signals'),
    h(
      'button',
      { class: 'link-btn small', type: 'button', onclick: () => rulesDialog(cand) },
      'How the band is set',
    ),
  );
  if (integ.notUsed) {
    return h(
      'section',
      { class: 'card stack-sm', 'aria-labelledby': 'int-h' },
      head,
      h('p', {}, pill('Not used in decision', 'neutral', { class: 'pill pill-neutral band-pill' })),
      h(
        'p',
        { class: 'small' },
        cand
          ? m.scoreDecision
            ? 'You were not shortlisted on Answer Quality, so integrity signals were not reviewed or used in any decision. Nothing needs a response.'
            : 'Integrity is reviewed only if you are shortlisted on Answer Quality. Until then these signals are not used in any decision, and nothing needs a response.'
          : 'Not shortlisted on Answer Quality, so integrity is not reviewed (score-first triage). These signals are "not used" and cannot be appealed. Shortlisting on score makes them reviewable.',
      ),
      h(
        'p',
        { class: 'caption' },
        cand
          ? RULESET_VERSION
          : `${RULESET_VERSION} · ${m.integrity.eventCount} events stored, not shown`,
      ),
    );
  }
  const b = BANDS[integ.band];
  const confirmed = integ.flags.filter((f) => f.review.state === 'confirmed').length;
  return h(
    'section',
    { class: 'card stack-sm', 'aria-labelledby': 'int-h' },
    head,
    h(
      'div',
      { class: 'row' },
      bandPill(integ.band),
      h(
        'span',
        { class: 'mono caption' },
        `Evidence strength ${integ.evidenceStrength.toFixed(2)} · ${integ.flags.length} flag(s) · ${confirmed} confirmed`,
      ),
    ),
    h('p', { class: 'strong' }, cand ? b.candidate : b.recruiter),
    !cand && integ.reasons.length
      ? h(
          'ul',
          { class: 'list-tight small' },
          integ.reasons.map((r) => h('li', {}, r)),
        )
      : null,
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'chip' }, `T1 server-observed · ${integ.tierCounts.T1}`),
      h('span', { class: 'chip' }, `T2 content-bound · ${integ.tierCounts.T2}`),
      h(
        'span',
        { class: 'chip' },
        `T3 client-reported · ${integ.tierCounts.T3} (max Review without viewable media)`,
      ),
    ),
    h(
      'p',
      { class: 'caption' },
      `${RULESET_VERSION}, frozen. Signals are observations, not proof of misconduct. A person makes every decision. No AI-likeness, emotion or gaze is ever scored.`,
    ),
  );
}

function rulesDialog(cand) {
  openDialog(
    `How the band is set · ${RULESET_VERSION}`,
    h(
      'div',
      { class: 'stack' },
      h(
        'ol',
        { class: 'list-tight small' },
        h(
          'li',
          {},
          h('strong', {}, 'Insufficient evidence: '),
          'evidence coverage below the floor. Not assessed; never Clear and never a concern.',
        ),
        h(
          'li',
          {},
          h('strong', {}, 'Strong concern: '),
          'any T1 or T2 evidence, or untrusted input, or a T3 signal with raw media a reviewer can view.',
        ),
        h(
          'li',
          {},
          h('strong', {}, 'Review: '),
          'two or more T3 flags from different families, or one medium flag.',
        ),
        h(
          'li',
          {},
          h('strong', {}, 'Clear: '),
          'no T1/T2 evidence and at most one T3 soft signal.',
        ),
      ),
      h(
        'p',
        { class: 'small' },
        'Deterministic and versioned: the same events always give the same band. The ruleset freezes when the first candidate starts. Only human-confirmed flags reach a decision screen.',
      ),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'table stack-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ['Rule', 'Signal', 'Family', 'Tier', cand ? 'Role' : 'Role and threshold'].map((t) =>
                h('th', { scope: 'col' }, t),
              ),
            ),
          ),
          h(
            'tbody',
            {},
            RULES.map((r) =>
              h(
                'tr',
                {},
                h('td', { 'data-label': 'Rule', class: 'mono' }, r.id),
                h('td', { 'data-label': 'Signal' }, r.name),
                h('td', { 'data-label': 'Family' }, FAMILIES[r.family]),
                h('td', { 'data-label': 'Tier' }, r.tier),
                h('td', { 'data-label': 'Role' }, cand ? r.plain : r.role),
              ),
            ),
          ),
        ),
      ),
      cand
        ? h(
            'p',
            { class: 'caption' },
            'Exact thresholds are shared with you if you respond to a notice or appeal.',
          )
        : h(
            'p',
            { class: 'caption' },
            `Demo thresholds (illustrative; the product calibrates on the accuracy study): coverage floor ${THRESHOLDS.coverageFloor}, events merge within ${THRESHOLDS.mergeMs / 1000} s. Detectors in this prototype are treated as validated for the demo; in the product an unvalidated detector runs as context only.`,
          ),
    ),
    { wide: true },
  );
}

// ------------------------------------------------------------------ flags
function flagState(f, band) {
  const s = f.review.state;
  if (s === 'pending_review' && (band === 'clear' || band === 'insufficient')) {
    return pill('No review needed', 'neutral');
  }
  if (s === 'confirmed') return pill('Confirmed', 'concern');
  if (s === 'overturned') return pill('Overturned', 'clear');
  return pill('Awaiting review', 'review');
}

function flagsSection(env) {
  const { m, cand } = env;
  const flags = m.integrity.flags;
  const section = h(
    'section',
    { class: 'card stack', 'aria-labelledby': 'flags-h' },
    h('h2', { class: 'title', id: 'flags-h' }, cand ? 'What a person will check' : 'Flags'),
  );
  if (!flags.length) {
    append(
      section,
      h(
        'p',
        { class: 'muted' },
        cand ? 'Nothing needs explaining.' : 'No flags raised by the ruleset.',
      ),
    );
    return section;
  }
  flags.forEach((f, i) => append(section, flagCard(env, f, i + 1)));
  return section;
}

function flagCard(env, f, n) {
  const { m, state, cand } = env;
  const reviewing = !cand && (state.viewer === 'R1' || state.viewer === 'R2');
  const editable = reviewing && !m.review.notice && ['review', 'strong'].includes(m.integrity.band);
  const tierText =
    f.tier === 'T3'
      ? f.untrustedInput
        ? 'T3 client-reported · untrusted input (hard evidence)'
        : f.viewableMedia
          ? 'T3 client-reported · with media a reviewer can view'
          : 'T3 client-reported · can reach Review only'
      : TIERS[f.tier];
  const kv = [
    ['Rule', `${f.ruleId} · ${FAMILIES[f.family]} family`],
    ['Observed', f.observed],
    ['Evidence tier', tierText],
    ['When', `${fmtMmSs(f.t)} into the test`],
  ];
  if (!cand && f.threshold) kv.push(['Threshold', f.threshold]);
  if (f.oftenInnocent) kv.push(['Often innocent', f.oftenInnocent]);
  if (f.review.rationale && f.review.state !== 'pending_review') {
    kv.push([
      cand ? 'Reviewer’s note' : `Rationale (${actorLabel(f.review.by ?? '')})`.replace(' ()', ''),
      f.review.rationale,
    ]);
  }

  const card = h(
    'article',
    {
      class: `flag-card stack-sm is-${f.review.state === 'pending_review' ? 'pending' : f.review.state}`,
    },
    h(
      'div',
      { class: 'card-head' },
      h('h3', { class: 'title' }, `Flag ${n} · ${f.name}`),
      flagState(f, m.integrity.band),
    ),
    f.stillId
      ? stillStrip(env, [{ stillId: f.stillId, label: `${fmtMmSs(f.t)} · flag still` }])
      : null,
    h(
      'dl',
      { class: 'kv' },
      kv.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
    ),
  );

  if (!cand && f.counterpart) {
    append(
      card,
      h(
        'div',
        { class: 'banner banner-neutral stack-sm' },
        h(
          'div',
          {},
          `Matched with ${f.counterpart.label}. The candidate’s view never shows this name or their answer.`,
        ),
        h(
          'button',
          {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            onclick: () => {
              server.logView(
                m.attemptId,
                state.viewer,
                `Viewed the matching excerpt for flag ${f.ruleId} (another candidate’s answer)`,
              );
              server.logView(
                f.counterpart.attemptId,
                state.viewer,
                'Answer excerpt viewed during a similarity review of another report',
              );
              env.paintAudit();
              openDialog(
                'Matching excerpt (audited view)',
                h(
                  'div',
                  { class: 'stack-sm' },
                  h(
                    'p',
                    { class: 'caption' },
                    `${f.counterpart.label} · ${fmtClockSec(Date.now())} · viewed by ${env.viewerText}`,
                  ),
                  h('div', { class: 'answer-box' }, f.counterpart.excerpt),
                  h(
                    'p',
                    { class: 'caption' },
                    'This view is written to both candidates’ audit trails.',
                  ),
                ),
              );
            },
          },
          'View their matching excerpt (audited)',
        ),
      ),
    );
  }

  if (editable && f.review.state === 'pending_review') {
    const id = uid('rat');
    const rationale = h('textarea', {
      id,
      class: 'short',
      rows: '2',
      placeholder: 'What the evidence shows, in plain words',
    });
    const err = h('p', { class: 'caption', 'aria-live': 'polite' });
    const act = async (confirm) => {
      try {
        if (confirm) await server.confirmFlag(m.attemptId, f.id, state.viewer, rationale.value);
        else await server.dismissFlag(m.attemptId, f.id, state.viewer, rationale.value);
        toast(
          confirm
            ? 'Flag confirmed. Send the notice when every flag is handled.'
            : 'Flag overturned.',
        );
        rerender(state);
      } catch (e) {
        err.textContent = e.message;
        rationale.focus();
      }
    };
    append(
      card,
      h(
        'div',
        { class: 'stack-sm' },
        h('label', { for: id, class: 'field-label' }, 'Rationale (shown to the candidate)'),
        rationale,
        err,
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => act(false) },
            'Overturn',
          ),
          h(
            'button',
            { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => act(true) },
            'Confirm with rationale',
          ),
        ),
        h(
          'p',
          { class: 'caption' },
          'Confirming does not decide anything. A notice goes to the candidate, they get 72 hours, and a different reviewer makes the final call.',
        ),
      ),
    );
  } else if (!cand && state.viewer === 'recruiter' && f.review.state === 'pending_review') {
    append(
      card,
      h(
        'p',
        { class: 'caption' },
        'Recruiters cannot confirm flags. Switch to the Reviewer role to act on this flag.',
      ),
    );
  }
  return card;
}

// ------------------------------------------------------------------ families + timeline
function familiesCard(m) {
  return h(
    'section',
    { class: 'card stack-sm', 'aria-labelledby': 'fam-h' },
    h('h2', { class: 'title', id: 'fam-h' }, 'Signals by family'),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'table stack-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ['Family', 'Status', 'Observed'].map((t) => h('th', { scope: 'col' }, t)),
          ),
        ),
        h(
          'tbody',
          {},
          m.integrity.families.map((f) =>
            h(
              'tr',
              {},
              h(
                'td',
                { 'data-label': 'Family' },
                h('span', { class: 'row' }, familyDot(f.family), FAMILIES[f.family]),
              ),
              h('td', { 'data-label': 'Status' }, pill(f.status, f.tone)),
              h('td', { 'data-label': 'Observed', class: 'small' }, f.observed),
            ),
          ),
        ),
      ),
    ),
  );
}

const ITEM_N = (m, itemId) => {
  const it = m.aq.items.find((x) => x.id === itemId);
  return it ? `Q${it.n}` : 'an answer';
};

export function eventInfo(e, m) {
  const q = ITEM_N(m, e.itemId);
  switch (e.type) {
    case 'tab_hidden':
      return { label: 'Test tab hidden (switched tab or app)', family: 'focus' };
    case 'tab_visible':
      return {
        label: `Back on the test tab (away ${Math.round((e.awayMs ?? 0) / 1000)} s)`,
        family: 'focus',
      };
    case 'window_blur':
      return { label: 'Test window lost focus', family: 'focus' };
    case 'window_focus':
      return {
        label: `Test window focused again (${Math.round((e.awayMs ?? 0) / 1000)} s)`,
        family: 'focus',
      };
    case 'fullscreen_exit':
      return { label: 'Left fullscreen', family: 'focus' };
    case 'paste':
      return {
        label: e.internal
          ? `Paste from within the test into ${q} · ${e.length} chars (ignored)`
          : e.blocked
            ? `Paste attempt blocked in ${q} · ${e.length} chars (text not stored)`
            : `Paste into ${q} · ${e.length} chars (text not stored)`,
        family: 'paste',
      };
    case 'question_copy':
      return { label: `Question text copied (${q}, ${e.length} chars)`, family: 'paste' };
    case 'untrusted_input':
      return { label: `Untrusted input event in ${q} (isTrusted = false)`, family: 'environment' };
    case 'still':
      return {
        label:
          e.reason === 'start'
            ? 'Start photo (background blurred)'
            : 'Server-requested random still',
        family: 'camera',
      };
    case 'second_face':
      return { label: `Second face near the screen for ${e.durationS} s`, family: 'camera' };
    case 'similarity':
      return {
        label: `Answer similarity ${e.similarity.toFixed(2)} on ${e.itemLabel ?? q}`,
        family: 'server',
      };
    case 'replay_mismatch':
      return { label: `Replay mismatch on ${q}`, family: 'server' };
    case 'connectivity_gap':
      return {
        label: `Connectivity gap · ${Math.round((e.durationMs ?? 0) / 60000)} min (not focus loss)`,
        family: 'environment',
      };
    case 'diary':
      return { label: `Candidate’s note: “${e.note}”`, family: 'identity' };
    default:
      return { label: e.type, family: 'environment' };
  }
}

function timelineCard(env) {
  const { m } = env;
  const events = [...m.integrity.events].sort((a, b) => a.t - b.t);
  const flagByEvent = new Map();
  for (const f of m.integrity.flags) for (const id of f.eventIds) flagByEvent.set(id, f);
  return h(
    'section',
    { class: 'card stack-sm', 'aria-labelledby': 'tl-h' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', { class: 'title', id: 'tl-h' }, `Evidence timeline · ${events.length} events`),
      h('span', { class: 'caption' }, 'Select an event for its detail'),
    ),
    events.length
      ? h(
          'ol',
          { class: 'timeline' },
          events.map((e) => {
            const info = eventInfo(e, m);
            const flag = flagByEvent.get(e.id);
            return h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: 'tl-item', onclick: () => eventDialog(env, e, flag) },
                h('span', { class: 'tl-time' }, fmtMmSs(e.t)),
                familyDot(info.family),
                h('span', { class: 'tl-label' }, info.label),
                h(
                  'span',
                  { class: 'tl-meta' },
                  flag ? `Flag ${flag.ruleId}` : e.type === 'diary' ? 'note' : 'context',
                ),
              ),
            );
          }),
        )
      : h('p', { class: 'muted' }, 'No events were recorded.'),
  );
}

function eventDialog(env, e, flag) {
  const { m, state } = env;
  const info = eventInfo(e, m);
  const rows = [
    ['Event', info.label],
    ['Time', `${fmtMmSs(e.t)} into the test · ${fmtClockSec(m.startedAt + e.t)}`],
    ['Family', FAMILIES[info.family] ?? info.family],
    [
      'Source',
      ['similarity', 'replay_mismatch'].includes(e.type)
        ? 'T1 server-observed'
        : e.type === 'diary'
          ? 'Candidate’s own note'
          : 'T3 client-reported (browser)',
    ],
  ];
  if (e.length != null) rows.push(['Length', `${e.length} characters (content never stored)`]);
  if (e.awayMs != null) rows.push(['Away', `${(e.awayMs / 1000).toFixed(1)} s`]);
  if (flag)
    rows.push([
      'Used by',
      `${flag.ruleId} · ${flag.name} (${flag.review.state.replace('_', ' ')})`,
    ]);
  else if (e.type !== 'diary') rows.push(['Used by', 'Context only: not a flag on its own']);
  const body = h(
    'div',
    { class: 'stack' },
    h(
      'dl',
      { class: 'kv' },
      rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
    ),
  );
  const dlg = openDialog('Evidence detail', body, { wide: Boolean(e.stillId) });
  if (e.stillId) showStillInto(env, body, e.stillId, dlg);
}

function stillStrip(env, list) {
  return h(
    'div',
    { class: 'still-strip' },
    list.map(({ stillId, label }) => {
      const url = getStill(stillId);
      return h(
        'button',
        {
          type: 'button',
          class: 'still-thumb',
          'aria-label': `Open still: ${label}`,
          onclick: () => {
            const body = h('div', { class: 'stack' });
            const dlg = openDialog('Still (audited view)', body, { wide: true });
            showStillInto(env, body, stillId, dlg);
          },
        },
        url ? h('img', { src: url, alt: '' }) : h('span', {}, 'Not on this device'),
        h('span', {}, label),
      );
    }),
  );
}

/** Renders a watermarked still with a simulated 5-minute signed link, and audits the view. */
async function showStillInto(env, container, stillId, dlg) {
  const { m, state } = env;
  const url = getStill(stillId);
  const stamp = `Viewed by ${env.viewerText} · ${fmtClockSec(Date.now())}`;
  const box = h('div', { class: 'media-box stack-sm' });
  append(container, box);
  if (!url) {
    append(
      box,
      h(
        'p',
        {},
        'This still is not stored on this device (stills stay in the browser that took them).',
      ),
    );
    return;
  }
  const canvas = await watermarked(url, stamp);
  if (canvas) {
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Blurred still with viewer watermark');
    append(box, canvas);
  }
  const expiry = h('span', { class: 'countdown' }, '5:00');
  append(box, h('p', { class: 'small' }, stamp));
  append(
    container,
    h(
      'p',
      { class: 'caption' },
      'Audited view: written to the audit trail (the candidate sees that a ',
      env.cand ? 'person' : 'reviewer',
      ' viewed it). Signed link (simulated) expires in ',
      expiry,
      '. Background blurred on the device; the watermark is drawn into the pixels.',
    ),
  );
  server.logView(
    m.attemptId,
    state.viewer === 'candidate' ? 'candidate' : state.viewer,
    'Viewed a still (5-minute signed link, watermarked)',
  );
  env.paintAudit();
  const until = Date.now() + 5 * 60 * 1000;
  const t = setInterval(() => {
    const left = until - Date.now();
    expiry.textContent = fmtMmSs(left).replace(/^0/, '');
    if (left <= 0) {
      clearInterval(t);
      replace(box, h('p', {}, 'The signed link expired. Open the still again to get a new one.'));
    }
  }, 1000);
  dlg.addEventListener('close', () => clearInterval(t));
}

// ------------------------------------------------------------------ review panel (org)
function reviewPanel(env) {
  const { m, state } = env;
  const panel = h('section', { class: 'card stack', 'aria-labelledby': 'rev-h' });
  const reviewing = state.viewer === 'R1' || state.viewer === 'R2';
  append(
    panel,
    h(
      'div',
      { class: 'card-head' },
      h('h2', { class: 'title', id: 'rev-h' }, 'Integrity review'),
      pill(m.status.label, m.status.tone),
    ),
  );
  const band = m.integrity.band;
  if (band === 'clear') {
    append(panel, h('p', {}, 'Clear: proceed. Nothing to review.'));
    return panel;
  }
  if (band === 'insufficient') {
    append(
      panel,
      h('p', {}, 'Integrity not assessed: evidence coverage is below the floor.'),
      h(
        'p',
        { class: 'small muted' },
        'Use another stage (interview, supervised re-test) to judge integrity. Low coverage is its own finding, so covering the camera is not a free pass, but it is never a concern by itself.',
      ),
    );
    return panel;
  }
  const flags = m.integrity.flags;
  const pending = flags.filter((f) => f.review.state === 'pending_review').length;
  const confirmed = flags.filter((f) => f.review.state === 'confirmed');
  const notice = m.review.notice;

  // Step 1
  append(
    panel,
    step(
      1,
      'Confirm or overturn each flag',
      pending ? `${pending} awaiting review` : 'Done',
      !pending,
    ),
  );
  if (!reviewing && pending)
    append(panel, h('p', { class: 'caption' }, 'Switch to the Reviewer role to act.'));

  // Step 2: notice + 72 h
  const s2 = h(
    'div',
    { class: 'stack-sm' },
    step(
      2,
      'Notice and 72-hour response window',
      notice ? 'Sent' : confirmed.length ? 'Ready' : 'Needs a confirmed flag',
      Boolean(notice),
    ),
  );
  append(panel, s2);
  if (!notice) {
    if (confirmed.length) {
      const btn = h(
        'button',
        {
          class: 'btn btn-primary btn-block',
          type: 'button',
          disabled: !reviewing || pending > 0,
          onclick: async () => {
            try {
              await server.sendNotice(m.attemptId, state.viewer);
              toast('Notice sent. The candidate has 72 hours to respond.');
              rerender(state);
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        },
        'Send notice to the candidate',
      );
      append(
        s2,
        btn,
        h(
          'p',
          { class: 'caption' },
          pending
            ? 'Act on every flag first.'
            : 'The candidate sees the confirmed flags and your rationale, and can respond in text, voice or Hindi.',
        ),
      );
    } else if (flags.length && !pending) {
      append(
        s2,
        h('p', { class: 'small' }, 'All flags overturned: nothing is used against the candidate.'),
      );
    }
  } else {
    const remaining = h('span', { class: 'countdown' });
    const update = () => {
      const a = server.getAttempt(m.attemptId);
      const left = server.noticeRemainingMs(a);
      remaining.textContent = left > 0 ? `${fmtLong(left)} left` : 'Window closed';
    };
    update();
    state.timers.push(setInterval(update, 1000));
    append(
      s2,
      h(
        'dl',
        { class: 'kv' },
        h('dt', {}, 'Sent'),
        h('dd', {}, `${fmtDateTime(notice.sentAt)} by ${actorLabel(notice.by)}`),
        h('dt', {}, 'Response window'),
        h('dd', {}, remaining),
        h('dt', {}, 'Response'),
        h(
          'dd',
          {},
          notice.response
            ? h('span', {}, `“${notice.response.text}” · ${fmtDateTime(notice.response.at)}`)
            : 'None yet',
        ),
      ),
    );
    if (!notice.response && server.noticeRemainingMs(server.getAttempt(m.attemptId)) > 0) {
      append(
        s2,
        h(
          'button',
          {
            class: 'btn btn-secondary btn-sm',
            type: 'button',
            onclick: async () => {
              await server.simulate72h(m.attemptId);
              toast('Demo: 72 hours simulated. The window is closed.');
              rerender(state);
            },
          },
          'Demo: simulate 72 h passing',
        ),
      );
    }
  }

  // Step 3: final decision, different reviewer, confirmed flags only.
  const s3 = h(
    'div',
    { class: 'stack-sm' },
    step(
      3,
      'Final call by a different reviewer',
      m.review.final ? 'Decided' : 'Locked until the window closes or the candidate responds',
      Boolean(m.review.final),
    ),
  );
  append(panel, s3);
  if (m.review.final) {
    append(
      s3,
      h(
        'div',
        { class: 'banner banner-neutral stack-sm' },
        h(
          'div',
          { class: 'strong' },
          `${server.OUTCOMES[m.review.final.outcome]} · ${actorLabel(m.review.final.by)}`,
        ),
        h('div', {}, m.review.final.rationale),
        h(
          'div',
          { class: 'caption' },
          `${fmtDateTime(m.review.final.at)} · the recruiter’s decision is now unlocked. The Answer Quality score is unchanged.`,
        ),
      ),
    );
    return panel;
  }
  if (!notice) return panel;
  const attempt = server.getAttempt(m.attemptId);
  const gate = reviewing
    ? server.canDecide(attempt, state.viewer)
    : { ok: false, why: 'Only a reviewer can decide.' };
  append(
    s3,
    h('div', { class: 'overline' }, 'Decision screen · confirmed flags only'),
    h(
      'ul',
      { class: 'list-tight small' },
      confirmed.map((f) => h('li', {}, `${f.ruleId} · ${f.name}: “${f.review.rationale}”`)),
    ),
  );
  if (!gate.ok) {
    const other = state.viewer === 'R1' ? 'R2' : 'R1';
    append(
      s3,
      h(
        'div',
        { class: 'banner banner-warn stack-sm' },
        h(
          'div',
          {},
          `Locked for ${reviewing ? REVIEWERS[state.viewer] : 'this role'}: ${gate.why}`,
        ),
        reviewing && /different reviewer/.test(gate.why)
          ? h(
              'button',
              {
                class: 'btn btn-secondary btn-sm',
                type: 'button',
                onclick: () => {
                  state.ctx.setUi({ reviewer: other });
                  state.ctx.render();
                },
              },
              `Switch to ${REVIEWERS[other]}`,
            )
          : null,
      ),
    );
    return panel;
  }
  const group = uid('outcome');
  const rationaleId = uid('final');
  let outcome = 'overturn';
  const radios = h(
    'fieldset',
    { class: 'plain-fieldset stack-sm' },
    h('legend', { class: 'field-label' }, 'Outcome'),
    Object.entries(server.OUTCOMES).map(([k, label]) =>
      h(
        'label',
        { class: 'mcq-option' },
        h('input', {
          type: 'radio',
          name: group,
          value: k,
          checked: k === outcome,
          onchange: () => (outcome = k),
        }),
        h('span', {}, label),
      ),
    ),
  );
  const rationale = h('textarea', { id: rationaleId, class: 'short', rows: '3' });
  const err = h('p', { class: 'caption', 'aria-live': 'polite' });
  append(
    s3,
    radios,
    h('label', { for: rationaleId, class: 'field-label' }, 'Rationale (shown to the candidate)'),
    rationale,
    err,
    h(
      'button',
      {
        class: 'btn btn-primary btn-block',
        type: 'button',
        onclick: async () => {
          try {
            await server.finalDecision(m.attemptId, state.viewer, outcome, rationale.value);
            toast('Final decision recorded and logged.');
            rerender(state);
          } catch (e) {
            err.textContent = e.message;
          }
        },
      },
      'Record final decision',
    ),
    h(
      'p',
      { class: 'caption' },
      'Saving logs your name, time and rationale to the audit trail. The candidate is notified. Nothing here changes Answer Quality.',
    ),
  );
  return panel;
}

function step(n, title, status, done) {
  return h(
    'div',
    { class: 'row' },
    h('span', { class: `pill ${done ? 'pill-clear' : 'pill-outline'}` }, String(n)),
    h('strong', {}, title),
    h('span', { class: 'spacer' }),
    h('span', { class: 'caption' }, status),
  );
}

// ------------------------------------------------------------------ candidate panel
function candidatePanel(env) {
  const { m, state } = env;
  const panel = h(
    'section',
    { class: 'card stack-sm', 'aria-labelledby': 'cp-h' },
    h('h2', { class: 'title', id: 'cp-h' }, 'Your response'),
  );
  const notice = m.review.notice;
  if (m.review.final) {
    append(
      panel,
      h('p', {}, h('strong', {}, `Outcome: ${server.OUTCOMES[m.review.final.outcome]}`)),
      h('p', {}, m.review.final.rationale),
      h(
        'p',
        { class: 'caption' },
        `Decided ${fmtDateTime(m.review.final.at)} by a different reviewer from the one who confirmed the flag. Your Answer Quality score is unchanged.`,
      ),
    );
    return panel;
  }
  if (!notice) {
    append(
      panel,
      h(
        'p',
        { class: 'small' },
        m.integrity.band === 'clear'
          ? 'Nothing needs explaining.'
          : m.integrity.band === 'insufficient'
            ? 'Integrity not assessed (device, camera or connectivity). This is not a concern; another stage may check it instead.'
            : 'A person will check this. If a confirmed flag is used in a decision you will get a notice here, with 72 hours to respond.',
      ),
    );
    return panel;
  }
  const attempt = server.getAttempt(m.attemptId);
  const left = server.noticeRemainingMs(attempt);
  const remaining = h(
    'span',
    { class: 'countdown' },
    left > 0 ? `${fmtLong(left)} left` : 'closed',
  );
  state.timers.push(
    setInterval(() => {
      const l = server.noticeRemainingMs(server.getAttempt(m.attemptId));
      remaining.textContent = l > 0 ? `${fmtLong(l)} left` : 'closed';
    }, 1000),
  );
  append(
    panel,
    h(
      'div',
      { class: 'banner banner-warn' },
      'Notice: a reviewer confirmed the flag(s) above and may use them in a decision. You can explain before anyone decides.',
    ),
    h('p', { class: 'small' }, 'Response window: ', remaining),
  );
  if (notice.response) {
    append(
      panel,
      h('div', { class: 'answer-box' }, notice.response.text),
      h(
        'p',
        { class: 'caption' },
        `Sent ${fmtDateTime(notice.response.at)}. A different reviewer will decide.`,
      ),
    );
    return panel;
  }
  if (left <= 0) {
    append(
      panel,
      h(
        'p',
        { class: 'small muted' },
        'The window has closed without a response. A different reviewer will now decide.',
      ),
    );
    return panel;
  }
  const id = uid('resp');
  const text = h('textarea', {
    id,
    rows: '4',
    placeholder: 'e.g. I drafted my answer in notes first, then typed it in.',
  });
  const err = h('p', { class: 'caption', 'aria-live': 'polite' });
  append(
    panel,
    h(
      'label',
      { for: id, class: 'field-label' },
      'Your explanation (text, voice or Hindi accepted in the product)',
    ),
    text,
    err,
    h(
      'button',
      {
        class: 'btn btn-primary',
        type: 'button',
        onclick: async () => {
          try {
            await server.candidateRespond(m.attemptId, text.value);
            toast('Response sent.');
            rerender(state);
          } catch (e) {
            err.textContent = e.message;
          }
        },
      },
      'Send response',
    ),
    h('p', { class: 'caption' }, 'You can also ask for a supervised re-attempt.'),
  );
  return panel;
}

// ------------------------------------------------------------------ answers + audit
function answersCard(m) {
  const cand = m.kind === 'candidate';
  return h(
    'section',
    { class: 'card stack', 'aria-labelledby': 'ans-h' },
    h('h2', { class: 'title', id: 'ans-h' }, cand ? 'Your answers' : 'Answers'),
    m.aq.items.map((it) =>
      h(
        'article',
        { class: 'stack-sm' },
        h(
          'div',
          { class: 'row' },
          h('strong', {}, `Q${it.n}`),
          pill(it.type === 'mcq' ? 'MCQ' : 'Written', it.type === 'mcq' ? 'outline' : 'accent'),
          h(
            'span',
            { class: 'mono caption' },
            `${it.grade.earned}/${it.grade.points} · ${it.edits} edit event(s)`,
          ),
        ),
        h('p', {}, it.prompt),
        it.type === 'mcq' ? mcqAnswer(it, cand) : writtenAnswer(it),
        h('hr', { class: 'sep' }),
      ),
    ),
  );
}

function mcqAnswer(it, cand) {
  const chosen = it.answer;
  if (chosen === undefined || chosen === null) return h('p', { class: 'muted' }, 'Not answered');
  return h(
    'div',
    { class: 'stack-sm' },
    h('div', { class: 'answer-box' }, it.options[chosen] ?? '—'),
    h(
      'p',
      { class: it.grade.correct ? 'kw-hit small' : 'small muted' },
      it.grade.correct
        ? 'Correct'
        : cand
          ? 'Incorrect'
          : `Incorrect · key: ${it.options[it.correct]}`,
    ),
  );
}

function writtenAnswer(it) {
  const g = it.grade;
  if (!g.answered) return h('p', { class: 'muted' }, 'Not answered');
  return h(
    'div',
    { class: 'stack-sm' },
    h('div', { class: 'answer-box' }, it.answer),
    h(
      'p',
      { class: 'small' },
      'Rubric points: ',
      g.matched.map((k) => h('span', { class: 'kw-hit' }, `✓ ${k}  `)),
      g.missing.map((k) => h('span', { class: 'kw-miss' }, `${k}  `)),
    ),
    h(
      'p',
      { class: 'caption' },
      `${g.detail}. Mock grader: ${Math.round(CONTENT_SHARE * 100)}% rubric points, ${Math.round((1 - CONTENT_SHARE) * 100)}% length.`,
    ),
  );
}

function auditCard(attempt, cand) {
  const list = [...attempt.audit].slice(-14).reverse();
  return h(
    'section',
    { class: 'card stack-sm', 'aria-labelledby': 'aud-h' },
    h('h2', { class: 'title', id: 'aud-h' }, 'Audit trail'),
    h(
      'ul',
      { class: 'audit-list' },
      list.map((x) =>
        h(
          'li',
          {},
          h('span', { class: 'dot', 'aria-hidden': 'true' }),
          h(
            'span',
            {},
            x.action,
            h(
              'span',
              { class: 'caption' },
              ` · ${cand ? actorRoleOnlyLabel(x.actor) : actorLabel(x.actor)}`,
            ),
          ),
          h('span', { class: 'caption mono' }, fmtClock(x.t)),
        ),
      ),
    ),
    h(
      'p',
      { class: 'caption' },
      cand
        ? 'Every view of your evidence is logged. You see who viewed it by role and organisation.'
        : 'Append-only. Every view, export and decision is logged with name and time.',
    ),
  );
}

function actorRoleOnlyLabel(actor) {
  if (actor === 'R1' || actor === 'R2') return 'Reviewer · Demo Staffing Co.';
  if (actor === 'recruiter') return 'Recruiter · Demo Staffing Co.';
  if (actor === 'candidate') return 'You';
  return 'Trace (system)';
}
