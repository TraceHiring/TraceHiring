// About this prototype: what is real in the codebase today vs simulated here, and the rules.
import { h, append } from '../dom.js';
import { pageHead } from './shared.js';
import { RULESET_VERSION } from '../band.js';
import { GRADER_VERSION } from '../grader.js';

const PRINCIPLES = [
  [
    'Two results, never blended.',
    'How good the answers are (Answer Quality, 0–100) and how they were produced (the Integrity band) are computed, stored and shown separately. An integrity decision never changes a score.',
  ],
  [
    'No automatic rejection.',
    'Nothing rejects a candidate on integrity: no button, job or bulk action. Bulk reject works only on an Answer Quality cutoff.',
  ],
  [
    'A deterministic, versioned band.',
    'The same events always give the same band, and the rules freeze when the first candidate starts. Browser-reported signals alone can reach Review at most, unless the input was untrusted or a reviewer can view raw media.',
  ],
  [
    'Notice and 72 hours, then a different reviewer.',
    'Before any integrity-based rejection, the candidate is told why and gets 72 hours to respond. Someone other than the confirming reviewer makes the final call.',
  ],
  [
    'The same report on both sides.',
    'The candidate reads the same report, built as a separate projection that removes other people’s data: never another candidate’s answer, identity, device or IP.',
  ],
  [
    'Score first.',
    'Integrity is reviewed only for shortlisted candidates. Flags on everyone else are marked “not used” and need no response.',
  ],
  [
    'Never build the wrong things.',
    'No emotion, stress or personality inference; no AI-likeness score shown to anyone; no gaze as a flag; no biometric templates; IP or network is never a flag in India.',
  ],
  [
    'Media leaves the device only on an allow-list.',
    'A start photo, random stills, voice/video answers and stills around a flagged moment. Live video and ambient audio stay on the device. Backgrounds are blurred on the device, links last 5 minutes, carry the viewer’s watermark and every view is audited.',
  ],
  [
    'Under-18 candidates are blocked at launch.',
    'Only “18 or over: yes” is kept, never the date of birth.',
  ],
];

export function aboutView({ main }) {
  append(
    main,
    pageHead({
      crumbs: ['About'],
      title: 'About this prototype',
      sub: 'A clickable demo of the D1 slice: a recruiter creates a test and invites a candidate, the candidate takes it with a server-held timer, a start photo and autosave, and a reviewer opens a report with two separate results.',
    }),
    h(
      'div',
      { class: 'grid-2' },
      h(
        'section',
        { class: 'card stack-sm' },
        h('h2', { class: 'title' }, 'Real in the codebase today (M0a foundation)'),
        h(
          'ul',
          { class: 'list-tight small' },
          h(
            'li',
            {},
            'A TypeScript monorepo: candidate and recruiter app shells (React + Vite), API and edge/jobs Worker skeletons, shared packages.',
          ),
          h(
            'li',
            {},
            'A CI pipeline: typecheck, lint, unit tests, build, RLS and catalog tests, a gitleaks secret scan over full history, dependency audit and OSV scan, and a migrations check.',
          ),
          h(
            'li',
            {},
            'Repository guards: import boundaries and credential-name checks, workflow hardening checks, security-header checks on every build, a 150 kB gzip budget for the candidate app, and a secret scan over build output.',
          ),
          h(
            'li',
            {},
            'A PII redactor for logs and error reports, with a structured logger and an error-reporter interface.',
          ),
        ),
        h(
          'p',
          { class: 'caption' },
          'Not built yet: the database, sign-in, the test engine, the grader, the band engine, media handling and every screen you see here.',
        ),
      ),
      h(
        'section',
        { class: 'card stack-sm' },
        h('h2', { class: 'title' }, 'Simulated in this prototype'),
        h(
          'ul',
          { class: 'list-tight small' },
          h(
            'li',
            {},
            'The server: a module over this browser’s localStorage. It holds the deadline, rebuilds answers from sequenced edit events, and enforces the review rules.',
          ),
          h(
            'li',
            {},
            `Answer Quality: ${GRADER_VERSION}, a transparent keyword + length rubric standing in for the LLM rubric grader.`,
          ),
          h(
            'li',
            {},
            `Integrity: ${RULESET_VERSION}, a small deterministic band engine with illustrative thresholds, not the calibrated product detectors.`,
          ),
          h(
            'li',
            {},
            'Real browser signals: tab/visibility switches, window blur, paste (length only), question copy, fullscreen exits, untrusted input events, and webcam stills blurred on the device.',
          ),
          h(
            'li',
            {},
            'Seeded signals that need the server or models (similarity, replay mismatch, second face, connectivity) use synthetic events and drawn stills.',
          ),
          h(
            'li',
            {},
            'Data: synthetic names, @example.invalid addresses, no phone numbers. Nothing is uploaded or sent anywhere. “Reset demo” restores the sample.',
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card stack-sm' },
      h('h2', { class: 'title' }, 'The nine product rules, in plain English'),
      h(
        'ol',
        { class: 'principles' },
        PRINCIPLES.map(([t, d]) => h('li', {}, h('strong', {}, t), ' ', d)),
      ),
    ),
    h(
      'section',
      { class: 'card stack-sm' },
      h('h2', { class: 'title' }, 'Where to see each rule in the demo'),
      h(
        'ul',
        { class: 'list-tight small' },
        h(
          'li',
          {},
          'Rules 1 and 6: Recruiter → Results. Sorted by Answer Quality only; integrity shows only for shortlisted rows.',
        ),
        h(
          'li',
          {},
          'Rule 2: the bulk reject button on Results takes only the Answer Quality cutoff.',
        ),
        h('li', {}, 'Rules 3 and 7: “How the band is set” on any report.'),
        h(
          'li',
          {},
          'Rule 4: Reviewer R1 confirms and sends the notice; simulate 72 h; R1 is locked out and R2 decides.',
        ),
        h(
          'li',
          {},
          'Rule 5: “Candidate’s view” on Candidate C’s report hides the other candidate in the similarity flag.',
        ),
        h('li', {}, 'Rules 8 and 9: the candidate’s consent screen, start photo and age check.'),
      ),
    ),
  );
  return null;
}
