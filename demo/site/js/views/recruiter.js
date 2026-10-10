// Recruiter screens: dashboard, test builder, test detail + invites, score-first results.
import * as server from '../server.js';
import { h, field, bar, pill, toast, confirmDialog, append, replace } from '../dom.js';
import { fmtDateTime, ORG_NAME } from '../util.js';
import { RULESET_VERSION } from '../band.js';
import { GRADER_VERSION } from '../grader.js';
import { SAMPLE_TEST_ITEMS } from '../seed.js';
import { bandPill, notUsedPill, pageHead, stat, btnLink, sampleTag } from './shared.js';

function rulesetPill(test) {
  return test.ruleset.frozenAt
    ? pill(`${RULESET_VERSION} · frozen`, 'dark', {
        title: `Frozen ${fmtDateTime(test.ruleset.frozenAt)}`,
      })
    : pill(`${RULESET_VERSION} · freezes at first start`, 'outline');
}

function statusPill(test) {
  return test.status === 'published' ? pill('Published', 'clear') : pill('Draft', 'neutral');
}

function itemSummary(test) {
  const mcq = test.items.filter((i) => i.type === 'mcq').length;
  const written = test.items.length - mcq;
  return `${written} written · ${mcq} MCQ`;
}

// ---------------------------------------------------------------- dashboard
export function recruiterHome({ main }) {
  const tests = server.listTests();
  const attempts = server.allAttempts();
  const submitted = attempts.filter((a) => a.stage === 'submitted');
  const needReview = submitted.filter((a) =>
    ['in_review', 'notice_due', 'awaiting', 'ready_final'].includes(server.triageStatus(a).key),
  );
  append(
    main,
    pageHead({
      crumbs: [ORG_NAME, sampleTag()],
      title: 'Tests',
      sub: 'Build a test, invite candidates by link, then shortlist on Answer Quality.',
      actions: [btnLink('#/recruiter/new', 'Create test', 'primary')],
    }),
    h(
      'div',
      { class: 'grid-stats' },
      stat('Published tests', tests.filter((t) => t.status === 'published').length),
      stat('Invites sent', tests.flatMap((t) => server.invitesForTest(t.id)).length),
      stat('Submitted', submitted.length),
      stat('Need integrity review', needReview.length, { accent: needReview.length > 0 }),
    ),
    h(
      'div',
      { class: 'card stack', id: 'tests-card' },
      h('h2', { class: 'title' }, 'Your tests'),
      testsTable(tests),
    ),
    h(
      'p',
      { class: 'caption' },
      'Every test records the versions it used: ',
      RULESET_VERSION,
      ' for integrity, ',
      GRADER_VERSION,
      ' for Answer Quality. Rules freeze when the first candidate starts.',
    ),
  );
  return { live: true };
}

function testsTable(tests) {
  if (!tests.length) return h('p', { class: 'empty' }, 'No tests yet.');
  return h(
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
          ['Test', 'Status', 'Questions', 'Candidates', 'Integrity rules', ''].map((t) =>
            h('th', { scope: 'col' }, t),
          ),
        ),
      ),
      h(
        'tbody',
        {},
        tests.map((test) => {
          const invites = server.invitesForTest(test.id).length;
          const done = server
            .attemptsForTest(test.id)
            .filter((a) => a.stage === 'submitted').length;
          return h(
            'tr',
            {},
            h(
              'td',
              { 'data-label': 'Test' },
              h(
                'div',
                {},
                h('a', { href: `#/recruiter/test/${test.id}`, class: 'strong' }, test.title),
                h(
                  'div',
                  { class: 'caption' },
                  `${test.durationMin} min · paste ${test.pastePolicy}`,
                ),
              ),
            ),
            h('td', { 'data-label': 'Status' }, statusPill(test)),
            h('td', { 'data-label': 'Questions' }, itemSummary(test)),
            h('td', { 'data-label': 'Candidates' }, `${done} submitted / ${invites} invited`),
            h('td', { 'data-label': 'Rules' }, rulesetPill(test)),
            h(
              'td',
              { 'data-label': '' },
              h(
                'div',
                { class: 'actions' },
                test.status === 'published'
                  ? btnLink(`#/recruiter/test/${test.id}/results`, 'Results', 'secondary', {
                      class: 'btn btn-secondary btn-sm',
                    })
                  : btnLink(`#/recruiter/test/${test.id}/edit`, 'Edit draft', 'secondary', {
                      class: 'btn btn-secondary btn-sm',
                    }),
                btnLink(
                  `#/recruiter/test/${test.id}`,
                  test.status === 'published' ? 'Invite' : 'Open',
                  'ghost',
                  { class: 'btn btn-ghost btn-sm' },
                ),
              ),
            ),
          );
        }),
      ),
    ),
  );
}

// ---------------------------------------------------------------- test builder
function blankWritten() {
  return {
    id: '',
    type: 'written',
    prompt: '',
    rubric: { keywords: [], minWords: 40 },
    points: 20,
    keywordText: '',
  };
}
function blankMcq() {
  return { id: '', type: 'mcq', prompt: '', options: ['', '', '', ''], correct: 0, points: 10 };
}

export function testEditor({ main, params, navigate }) {
  const existing = params[0] ? server.getTest(params[0]) : null;
  if (existing && existing.status !== 'draft') {
    navigate(`#/recruiter/test/${existing.id}`);
    return null;
  }
  const draft = existing
    ? structuredClone(existing)
    : { title: '', durationMin: 10, pastePolicy: 'blocked', items: [blankWritten(), blankMcq()] };
  for (const item of draft.items) {
    if (item.type === 'written')
      item.keywordText = item.keywordText ?? item.rubric.keywords.join(', ');
  }
  let errors = [];
  const root = h('div', {});
  append(main, root);

  const sync = () => {
    for (const item of draft.items) {
      if (item.type === 'written') {
        item.rubric.keywords = item.keywordText
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean);
      }
    }
  };

  const save = async (publish) => {
    sync();
    errors = server.validateTest(draft);
    if (errors.length) {
      paint();
      document.getElementById('editor-errors')?.focus();
      return;
    }
    try {
      const saved = await server.saveTest(draft);
      draft.id = saved.id;
      if (publish) {
        await server.publishTest(saved.id);
        toast('Published. The integrity ruleset freezes when the first candidate starts.');
      } else toast('Draft saved.');
      navigate(`#/recruiter/test/${saved.id}`);
    } catch (err) {
      errors = [err.message];
      paint();
    }
  };

  const paint = () => {
    const focusId = document.activeElement?.id;
    replace(
      root,
      pageHead({
        crumbs: [h('a', { href: '#/recruiter' }, 'Tests'), existing ? 'Edit draft' : 'New test'],
        title: existing ? 'Edit test' : 'Create a test',
        sub: 'Written answers are graded on a rubric; MCQ on the exact key. Both feed Answer Quality only.',
      }),
      errors.length
        ? h(
            'div',
            { class: 'errors', id: 'editor-errors', tabindex: '-1', role: 'alert' },
            h('strong', {}, 'Fix these before saving:'),
            h(
              'ul',
              {},
              errors.map((e) => h('li', {}, e)),
            ),
          )
        : null,
      h(
        'div',
        { class: 'grid-main-side' },
        h(
          'div',
          { class: 'stack' },
          h(
            'section',
            { class: 'card stack', 'aria-labelledby': 'basics-h' },
            h('h2', { class: 'title', id: 'basics-h' }, 'Basics'),
            h(
              'div',
              { class: 'form-grid' },
              field(
                'Test title',
                h('input', {
                  type: 'text',
                  id: 'test-title',
                  value: draft.title,
                  placeholder: 'e.g. Customer Support Associate · Screening',
                  oninput: (e) => (draft.title = e.target.value),
                }),
              ),
              field(
                'Duration (minutes)',
                h('input', {
                  type: 'number',
                  id: 'test-duration',
                  min: '1',
                  max: '180',
                  value: String(draft.durationMin),
                  oninput: (e) => (draft.durationMin = e.target.value),
                }),
                'Held by the server; a refresh never resets it.',
              ),
              field(
                'Paste from outside the test',
                h(
                  'select',
                  { id: 'test-paste', onchange: (e) => (draft.pastePolicy = e.target.value) },
                  h(
                    'option',
                    { value: 'blocked', selected: draft.pastePolicy === 'blocked' },
                    'Blocked (attempts recorded)',
                  ),
                  h(
                    'option',
                    { value: 'allowed', selected: draft.pastePolicy === 'allowed' },
                    'Allowed (large pastes flagged)',
                  ),
                ),
              ),
            ),
          ),
          draft.items.map((item, i) => questionEditor(item, i)),
          h(
            'div',
            { class: 'actions' },
            h(
              'button',
              { class: 'btn btn-secondary', type: 'button', onclick: () => add(blankWritten()) },
              '+ Written question',
            ),
            h(
              'button',
              { class: 'btn btn-secondary', type: 'button', onclick: () => add(blankMcq()) },
              '+ MCQ question',
            ),
            h(
              'button',
              {
                class: 'btn btn-ghost',
                type: 'button',
                onclick: () => {
                  draft.title = draft.title || 'Customer Support Associate · Screening (copy)';
                  draft.items = structuredClone(SAMPLE_TEST_ITEMS).map((it) => ({
                    ...it,
                    id: '',
                    keywordText: it.rubric?.keywords.join(', '),
                  }));
                  paint();
                },
              },
              'Fill with sample questions',
            ),
          ),
        ),
        h(
          'aside',
          { class: 'stack' },
          h(
            'div',
            { class: 'card stack-sm' },
            h('h2', { class: 'title' }, 'Integrity preset'),
            h('p', {}, pill('Standard', 'accent'), ' ', pill(RULESET_VERSION, 'outline')),
            h(
              'ul',
              { class: 'list-tight small' },
              h(
                'li',
                {},
                'Tab and window focus, fullscreen exits and pastes (length only) are recorded.',
              ),
              h(
                'li',
                {},
                'Start photo plus 3 server-requested random stills, background blurred on the device.',
              ),
              h(
                'li',
                {},
                'Mic off outside voice questions. No gaze, emotion or AI-likeness, ever.',
              ),
              h('li', {}, 'Browser-reported signals alone can only reach Review.'),
            ),
          ),
          h(
            'div',
            { class: 'card stack-sm' },
            h('h2', { class: 'title' }, 'Save'),
            h(
              'p',
              { class: 'small muted' },
              'Publishing freezes the questions. Edits after that need a new version.',
            ),
            h(
              'button',
              { class: 'btn btn-primary btn-block', type: 'button', onclick: () => save(true) },
              'Save and publish',
            ),
            h(
              'button',
              { class: 'btn btn-secondary btn-block', type: 'button', onclick: () => save(false) },
              'Save draft',
            ),
          ),
        ),
      ),
    );
    if (focusId) document.getElementById(focusId)?.focus();
  };

  const add = (item) => {
    draft.items.push(item);
    paint();
    document.getElementById(`q-${draft.items.length - 1}-prompt`)?.focus();
  };

  function questionEditor(item, i) {
    const n = i + 1;
    const remove = () => {
      draft.items.splice(i, 1);
      paint();
    };
    const move = (d) => {
      const j = i + d;
      if (j < 0 || j >= draft.items.length) return;
      [draft.items[i], draft.items[j]] = [draft.items[j], draft.items[i]];
      paint();
    };
    const head = h(
      'div',
      { class: 'q-editor-head' },
      h('strong', {}, `Q${n}`),
      pill(item.type === 'mcq' ? 'MCQ' : 'Written', item.type === 'mcq' ? 'outline' : 'accent'),
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => move(-1),
          disabled: i === 0,
          'aria-label': `Move question ${n} up`,
        },
        'Up',
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: () => move(1),
          disabled: i === draft.items.length - 1,
          'aria-label': `Move question ${n} down`,
        },
        'Down',
      ),
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          type: 'button',
          onclick: remove,
          'aria-label': `Remove question ${n}`,
        },
        'Remove',
      ),
    );
    const prompt = field(
      'Question',
      h('textarea', {
        id: `q-${i}-prompt`,
        rows: '2',
        class: 'short',
        value: item.prompt,
        oninput: (e) => (item.prompt = e.target.value),
      }),
    );
    const points = field(
      'Points',
      h('input', {
        type: 'number',
        id: `q-${i}-points`,
        min: '1',
        max: '100',
        value: String(item.points),
        oninput: (e) => (item.points = e.target.value),
      }),
    );
    if (item.type === 'written') {
      return h(
        'section',
        { class: 'q-editor stack-sm', 'aria-label': `Question ${n}, written` },
        head,
        prompt,
        h(
          'div',
          { class: 'form-grid' },
          field(
            'Rubric points (comma-separated)',
            h('input', {
              type: 'text',
              id: `q-${i}-keywords`,
              value: item.keywordText,
              placeholder: 'apologise, refund, timeline',
              oninput: (e) => (item.keywordText = e.target.value),
            }),
            'Mock grader: 70% for rubric points covered (word-start match), 30% for length.',
          ),
          field(
            'Minimum words',
            h('input', {
              type: 'number',
              id: `q-${i}-minwords`,
              min: '1',
              value: String(item.rubric.minWords),
              oninput: (e) => (item.rubric.minWords = e.target.value),
            }),
          ),
          points,
        ),
      );
    }
    const group = `q-${i}-correct`;
    return h(
      'section',
      { class: 'q-editor stack-sm', 'aria-label': `Question ${n}, multiple choice` },
      head,
      prompt,
      h(
        'fieldset',
        { class: 'stack-sm plain-fieldset' },
        h('legend', { class: 'field-label' }, 'Options (mark the correct one)'),
        item.options.map((opt, j) =>
          h(
            'div',
            { class: 'opt-row' },
            h(
              'label',
              { class: 'check' },
              h('input', {
                type: 'radio',
                name: group,
                checked: item.correct === j,
                onchange: () => (item.correct = j),
                'aria-label': `Option ${j + 1} is correct`,
              }),
              h('span', {}, 'Correct'),
            ),
            h('input', {
              type: 'text',
              id: `q-${i}-opt-${j}`,
              value: opt,
              'aria-label': `Option ${j + 1}`,
              placeholder: `Option ${j + 1}`,
              oninput: (e) => (item.options[j] = e.target.value),
            }),
            h(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                disabled: item.options.length <= 2,
                'aria-label': `Remove option ${j + 1}`,
                onclick: () => {
                  item.options.splice(j, 1);
                  if (item.correct >= item.options.length) item.correct = 0;
                  paint();
                },
              },
              'Remove',
            ),
          ),
        ),
        item.options.length < 6
          ? h(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                onclick: () => {
                  item.options.push('');
                  paint();
                },
              },
              '+ Add option',
            )
          : null,
      ),
      h('div', { class: 'form-grid' }, points),
    );
  }

  paint();
  return null;
}

// ---------------------------------------------------------------- test detail + invite
const DEMO_NAMES = ['Gauri', 'Harsh', 'Ishita', 'Jai', 'Kavya', 'Laksh', 'Meher', 'Nikhil'];

export function testDetail({ main, params, navigate, setUi }) {
  const test = server.getTest(params[0]);
  if (!test) {
    append(
      main,
      h(
        'p',
        { class: 'empty' },
        'Test not found. ',
        h('a', { href: '#/recruiter' }, 'Back to tests'),
      ),
    );
    return null;
  }
  const invites = server.invitesForTest(test.id);
  const total = server.listTests().flatMap((t) => server.invitesForTest(t.id)).length;
  const nextName = DEMO_NAMES[Math.max(0, total - 6) % DEMO_NAMES.length];
  const letter = String.fromCharCode(65 + (total % 26));
  const labelInput = h('input', {
    type: 'text',
    id: 'inv-label',
    value: `Candidate ${letter} · ${nextName} (demo)`,
  });
  const emailInput = h('input', {
    type: 'email',
    id: 'inv-email',
    value: `${nextName.toLowerCase()}.demo@example.invalid`,
  });
  const linkSlot = h('div', { 'aria-live': 'polite' });

  const showLink = (invite) => {
    const url = `${location.origin}${location.pathname}#/c/${invite.token}`;
    const input = h('input', {
      type: 'text',
      id: 'invite-url',
      value: url,
      readonly: true,
      'aria-label': 'Invite link',
    });
    const copy = h(
      'button',
      {
        class: 'btn btn-secondary',
        type: 'button',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast('Invite link copied.');
          } catch {
            input.select();
            toast('Select-all done: press Ctrl+C to copy.');
          }
        },
      },
      'Copy link',
    );
    replace(
      linkSlot,
      h(
        'div',
        { class: 'banner banner-ok stack-sm' },
        h('div', { class: 'strong' }, `Invite ready for ${invite.candidateLabel}`),
        h('div', { class: 'link-box' }, input, copy),
        h(
          'div',
          { class: 'actions' },
          h(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              onclick: () => {
                setUi({ role: 'candidate' });
                navigate(`#/c/${invite.token}`);
              },
            },
            'Open as candidate',
          ),
        ),
        h(
          'p',
          { class: 'caption' },
          'The token is random and fake. The link works in this browser only (all demo data lives here). In the product it goes out by email, SMS or WhatsApp.',
        ),
      ),
    );
  };

  const errorSlot = h('div', {});
  const create = async (e) => {
    e.preventDefault();
    replace(errorSlot);
    try {
      const invite = await server.createInvite(test.id, labelInput.value, emailInput.value);
      paintInvites();
      showLink(invite);
    } catch (err) {
      replace(errorSlot, h('div', { class: 'errors', role: 'alert' }, err.message));
    }
  };

  const invitesList = h('ul', { class: 'list-plain' });
  const paintInvites = () => {
    const list = server.invitesForTest(test.id);
    replace(
      invitesList,
      ...(list.length
        ? list.map((inv) => {
            const a = server.attemptForInvite(inv.token);
            return h(
              'li',
              { class: 'row' },
              h(
                'div',
                {},
                h('div', { class: 'strong' }, inv.candidateLabel),
                h(
                  'div',
                  { class: 'caption' },
                  `${inv.email} · invited ${fmtDateTime(inv.createdAt)}`,
                ),
              ),
              h('span', { class: 'spacer' }),
              pill(
                a ? server.stageLabel(a.stage) : 'Invited',
                a?.stage === 'submitted' ? 'clear' : 'neutral',
              ),
              h(
                'button',
                { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => showLink(inv) },
                'Show link',
              ),
            );
          })
        : [h('li', { class: 'muted' }, 'No invites yet.')]),
    );
  };
  paintInvites();

  append(
    main,
    pageHead({
      crumbs: [h('a', { href: '#/recruiter' }, 'Tests'), test.title],
      title: test.title,
      sub: `${test.durationMin} min · ${itemSummary(test)} · paste ${test.pastePolicy} · Standard preset`,
      actions: [
        statusPill(test),
        rulesetPill(test),
        test.status === 'draft'
          ? btnLink(`#/recruiter/test/${test.id}/edit`, 'Edit draft', 'secondary')
          : btnLink(`#/recruiter/test/${test.id}/results`, 'Results', 'secondary'),
        test.status === 'draft'
          ? h(
              'button',
              {
                class: 'btn btn-primary',
                type: 'button',
                onclick: async () => {
                  try {
                    await server.publishTest(test.id);
                    toast('Published.');
                    navigate(`#/recruiter/test/${test.id}`);
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              'Publish',
            )
          : null,
      ],
    }),
    h(
      'div',
      { class: 'grid-main-side' },
      h(
        'section',
        { class: 'card stack', 'aria-labelledby': 'qs-h' },
        h('h2', { class: 'title', id: 'qs-h' }, 'Questions'),
        h(
          'ol',
          { class: 'list-plain' },
          test.items.map((item, i) =>
            h(
              'li',
              { class: 'stack-sm' },
              h(
                'div',
                { class: 'row' },
                h('strong', {}, `Q${i + 1}`),
                pill(
                  item.type === 'mcq' ? 'MCQ' : 'Written',
                  item.type === 'mcq' ? 'outline' : 'accent',
                ),
                h('span', { class: 'caption' }, `${item.points} pts`),
              ),
              h('p', {}, item.prompt),
              item.type === 'mcq'
                ? h(
                    'ul',
                    { class: 'list-tight small' },
                    item.options.map((o, j) =>
                      h(
                        'li',
                        { class: j === item.correct ? 'kw-hit strong' : '' },
                        o,
                        j === item.correct ? ' (correct)' : '',
                      ),
                    ),
                  )
                : h(
                    'p',
                    { class: 'small muted' },
                    `Rubric points: ${item.rubric.keywords.join(', ')} · aim ${item.rubric.minWords}+ words`,
                  ),
            ),
          ),
        ),
      ),
      h(
        'aside',
        { class: 'stack' },
        test.status === 'published'
          ? h(
              'form',
              {
                class: 'card stack-sm',
                onsubmit: create,
                'aria-labelledby': 'inv-h',
                novalidate: true,
              },
              h('h2', { class: 'title', id: 'inv-h' }, 'Invite a candidate'),
              field('Candidate label (synthetic)', labelInput),
              field('Email (synthetic)', emailInput, 'Demo rule: only @example.invalid addresses.'),
              errorSlot,
              h(
                'button',
                { class: 'btn btn-primary btn-block', type: 'submit' },
                'Generate invite link',
              ),
              linkSlot,
            )
          : h('div', { class: 'banner banner-neutral' }, 'Publish the test to invite candidates.'),
        h(
          'section',
          { class: 'card stack-sm', 'aria-labelledby': 'invl-h' },
          h('h2', { class: 'title', id: 'invl-h' }, 'Invites'),
          invitesList,
        ),
      ),
    ),
  );
  return { live: true };
}

// ---------------------------------------------------------------- results (score-first)
const cutoffs = new Map();

export function resultsView({ main, params, render }) {
  const test = server.getTest(params[0]);
  if (!test) {
    append(main, h('p', { class: 'empty' }, 'Test not found.'));
    return null;
  }
  const cutoff = cutoffs.get(test.id) ?? 65;
  const all = server.attemptsForTest(test.id);
  const submitted = all
    .filter((a) => a.stage === 'submitted')
    // Score-first: sorted by Answer Quality only (rule 6). Integrity never enters the sort.
    .sort(
      (x, y) =>
        y.results.aq.score - x.results.aq.score || x.candidateLabel.localeCompare(y.candidateLabel),
    );
  const pending = all.filter((a) => a.stage !== 'submitted');
  const shortlisted = submitted.filter((a) => a.shortlist);
  const toShortlist = submitted.filter(
    (a) => !a.shortlist && !a.scoreDecision && a.results.aq.score >= cutoff,
  );
  const toReject = submitted.filter(
    (a) => !a.shortlist && !a.scoreDecision && a.results.aq.score < cutoff,
  );
  const needReview = shortlisted.filter((a) =>
    ['in_review', 'notice_due', 'awaiting', 'ready_final'].includes(server.triageStatus(a).key),
  );

  const output = h('output', { class: 'metric', for: 'cutoff', id: 'cutoff-out' }, String(cutoff));
  const slider = h('input', {
    type: 'range',
    id: 'cutoff',
    min: '0',
    max: '100',
    step: '1',
    value: String(cutoff),
    'aria-describedby': 'cutoff-help',
    oninput: (e) => {
      output.textContent = e.target.value;
    },
    onchange: (e) => {
      cutoffs.set(test.id, Number(e.target.value));
      render();
      document.getElementById('cutoff')?.focus();
    },
  });

  const shortlistBtn = h(
    'button',
    {
      class: 'btn btn-primary',
      type: 'button',
      disabled: toShortlist.length === 0,
      onclick: async () => {
        const n = await server.shortlistAtCutoff(test.id, cutoff);
        toast(`Shortlisted ${n} on Answer Quality ≥ ${cutoff}.`);
        render();
      },
    },
    `Shortlist ${toShortlist.length} at ≥ ${cutoff}`,
  );
  const rejectBtn = h(
    'button',
    {
      class: 'btn btn-secondary',
      type: 'button',
      disabled: toReject.length === 0,
      onclick: async () => {
        const ok = await confirmDialog(
          'Reject on Answer Quality only?',
          `${toReject.length} candidate(s) scored below ${cutoff}. They will be marked "Not progressed · score below cutoff". This uses Answer Quality only: integrity signals are not read and cannot trigger this.`,
          `Reject ${toReject.length} below ${cutoff}`,
          'danger',
        );
        if (!ok) return;
        const n = await server.rejectBelowCutoff(test.id, cutoff);
        toast(`${n} not progressed on score.`);
        render();
      },
    },
    `Reject ${toReject.length} below ${cutoff} (score only)`,
  );

  const rows = [];
  let cutDrawn = false;
  for (const a of submitted) {
    if (!cutDrawn && a.results.aq.score < cutoff) {
      cutDrawn = true;
      rows.push(
        h(
          'tr',
          { class: 'cutline', 'aria-hidden': 'true' },
          h('td', { colspan: '7', 'data-label': '' }),
        ),
      );
    }
    rows.push(resultRow(a, cutoff, render));
  }

  append(
    main,
    pageHead({
      crumbs: [
        h('a', { href: '#/recruiter' }, 'Tests'),
        h('a', { href: `#/recruiter/test/${test.id}` }, test.title),
        sampleTag(),
      ],
      title: 'Shortlist on score, then check integrity for the shortlist only',
      actions: [btnLink(`#/recruiter/test/${test.id}`, 'Invite more', 'secondary')],
    }),
    h(
      'div',
      { class: 'grid-stats' },
      stat('Submitted', submitted.length),
      stat('Shortlisted', shortlisted.length, { accent: true }),
      stat('Need integrity review', needReview.length),
      stat('In progress / not started', pending.length),
    ),
    h(
      'section',
      { class: 'card stack-sm', 'aria-labelledby': 'cut-h' },
      h(
        'div',
        { class: 'card-head' },
        h(
          'div',
          {},
          h(
            'h2',
            { class: 'title', id: 'cut-h' },
            h('label', { for: 'cutoff' }, 'Answer Quality cutoff'),
          ),
          h(
            'p',
            { class: 'small muted', id: 'cutoff-help' },
            'Candidates below the cutoff are not shortlisted on score. Their integrity signals are marked "not used in decision" and need no review or response.',
          ),
        ),
        output,
      ),
      slider,
      h('div', { class: 'actions' }, shortlistBtn, rejectBtn),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'res-h' },
      h('h2', { class: 'sr-only', id: 'res-h' }, 'Results, sorted by Answer Quality'),
      submitted.length
        ? h(
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
                  [
                    'Candidate',
                    'Answer Quality',
                    'Integrity band',
                    'Confirmed flags',
                    'Device',
                    'Next step',
                    '',
                  ].map((t) => h('th', { scope: 'col' }, t)),
                ),
              ),
              h('tbody', {}, rows),
            ),
          )
        : h('p', { class: 'empty' }, 'No submissions yet. Invite a candidate and take the test.'),
    ),
    pending.length
      ? h(
          'section',
          { class: 'card stack-sm' },
          h('h2', { class: 'title' }, 'Not submitted yet'),
          h(
            'ul',
            { class: 'list-plain' },
            pending.map((a) =>
              h(
                'li',
                { class: 'row' },
                h('span', {}, a.candidateLabel),
                h('span', { class: 'spacer' }),
                pill(server.stageLabel(a.stage), 'neutral'),
              ),
            ),
          ),
        )
      : null,
    h(
      'p',
      { class: 'caption' },
      'Bulk reject is available on score only. No action on this page can reject anyone for integrity.',
    ),
  );
  return { live: true };
}

function resultRow(a, cutoff, render) {
  const aq = a.results.aq.score;
  const integ = a.results.integrity;
  const status = server.triageStatus(a);
  const confirmed = Object.values(a.review.flags).filter((f) => f.state === 'confirmed').length;
  const below = !a.shortlist;
  return h(
    'tr',
    { class: below ? 'below' : '' },
    h(
      'td',
      { 'data-label': 'Candidate' },
      h('a', { href: `#/report/${a.id}`, class: 'strong' }, a.candidateLabel),
    ),
    h(
      'td',
      { 'data-label': 'Answer Quality' },
      h(
        'span',
        { class: 'score-cell' },
        h('strong', {}, String(aq)),
        bar(aq, 100, aq >= cutoff ? '' : 'dim'),
      ),
    ),
    // Rule 6: integrity is shown only for shortlisted candidates.
    h('td', { 'data-label': 'Integrity' }, a.shortlist ? bandPill(integ.band) : notUsedPill()),
    h('td', { 'data-label': 'Confirmed' }, a.shortlist ? String(confirmed) : '—'),
    h('td', { 'data-label': 'Device' }, a.device?.kind ?? '—'),
    h('td', { 'data-label': 'Next step' }, pill(status.label, status.tone)),
    h(
      'td',
      { 'data-label': '' },
      h(
        'div',
        { class: 'actions' },
        h('a', { href: `#/report/${a.id}`, class: 'btn btn-ghost btn-sm' }, 'Open report'),
        a.shortlist && !a.review.final
          ? h(
              'button',
              {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                onclick: async () => {
                  try {
                    await server.removeFromShortlist(a.id);
                    render();
                  } catch (err) {
                    toast(err.message, 'error');
                  }
                },
              },
              'Unshortlist',
            )
          : null,
      ),
    ),
  );
}
