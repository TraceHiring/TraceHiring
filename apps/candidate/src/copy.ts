// Every visible string of the candidate app, in one place (English only in D1; Hindi is M3b, Q48). The E2E spec
// (stream R5) clicks the labels below, so a change here is a change to that spec. Plain language, neutral wording:
// nothing here calls a candidate suspicious, and no step shows a score or a band (rules 1, 5).
/** RT-1: shown while events wait for the edge (also the outbox's own constant). */
export const OFFLINE_MESSAGE = 'Offline: your answers are kept on this device';

const minutes = (n: number) => `${n} minute${n === 1 ? '' : 's'}`;
const seconds = (n: number) => `${n} second${n === 1 ? '' : 's'}`;

export const COPY = {
  product: 'Trace',
  version: (v: string) => `Version ${v}`,
  loading: 'Loading…',
  errorSummaryTitle: 'There is a problem',

  resolving: {
    title: 'Opening your test',
    body: 'One moment while we check your link.',
  },

  unavailable: {
    title: 'This link cannot be used',
    noLink:
      'Open the test link from your invitation email. The link must include everything after the # sign.',
    invalid:
      'We could not find a test for this link. Check that you opened the full link from your invitation.',
    expired: 'This link has expired. Contact the person who invited you for a new one.',
    revoked:
      'This invitation has been withdrawn. Contact the person who invited you if you think this is a mistake.',
    submitted: 'This test has already been submitted. Thank you.',
    closed: 'The time for this test has ended.',
    config: 'The test service is not available right now. Please try again later.',
  },

  otp: {
    title: 'Confirm it is you',
    intro: (title: string | undefined, durationMinutes: number | undefined) =>
      [
        title === undefined
          ? 'You have been invited to a test.'
          : `You have been invited to “${title}”.`,
        durationMinutes === undefined ? '' : `It takes ${minutes(durationMinutes)}.`,
      ]
        .filter((s) => s !== '')
        .join(' '),
    explain:
      'We will email a 6-digit code to the address your invitation was sent to. Nothing starts until you enter it.',
    send: 'Email me a code',
    resend: 'Send a new code',
    sent: (expiresInSeconds: number) =>
      `We sent a 6-digit code to your email. It works for ${minutes(Math.max(1, Math.round(expiresInSeconds / 60)))}.`,
    label: '6-digit code',
    hint: 'Numbers only.',
    verify: 'Continue',
    needSixDigits: 'Enter the 6 digits from the email.',
    wrong: 'That code is not right. Check it and try again.',
    locked: (retryAfterSeconds: number | undefined) =>
      retryAfterSeconds === undefined
        ? 'Too many wrong codes. Please wait and try again later.'
        : `Too many wrong codes. Try again in about ${minutes(Math.max(1, Math.ceil(retryAfterSeconds / 60)))}.`,
    tooSoon: (retryAfterSeconds: number | undefined) =>
      `Please wait ${seconds(retryAfterSeconds ?? 30)} before asking for a new code.`,
    expired: 'That code has expired. Ask for a new code.',
  },

  age: {
    title: 'Your age',
    question: 'This test is for people aged 18 or older. Are you 18 or older?',
    adult: 'I am 18 or older',
    minor: 'I am under 18',
  },

  blocked: {
    title: 'You cannot take this test',
    body: 'This test is only for people aged 18 or older, so there is nothing more to do here. If you think this is a mistake, contact the person who invited you.',
  },

  consent: {
    title: 'What we record and why',
    intro: 'Please read this notice before you continue.',
    agreeLabel: 'I have read this notice and I agree',
    agree: 'Agree and continue',
    mustAgree: 'Tick the box to agree before you continue.',
  },

  photo: {
    title: 'Start photo',
    intro:
      'We take one photo at the start so the people who invited you can see who took the test. Only this photo is sent. Everything outside the oval is blurred on your device before the photo is taken, and no video or sound is recorded.',
    guide: 'Place your face inside the oval, then take the photo.',
    start: 'Turn on camera',
    starting: 'Turning on the camera…',
    take: 'Take photo',
    retake: 'Retake',
    use: 'Use this photo',
    skip: 'Continue without a photo',
    retry: 'Try again',
    preview: 'Your photo. Everything outside the oval is blurred.',
    live: 'Camera preview. Everything outside the oval is blurred.',
    shotTaken: 'Photo taken. The camera is off.',
    preparing: 'Preparing your photo…',
    uploading: 'Saving your photo…',
    deniedTitle: 'The camera is not allowed',
    denied:
      'Your browser did not let this page use the camera. You can allow the camera in your browser settings and try again, or continue without a photo.',
    noneTitle: 'No camera found',
    none: 'We could not find a camera on this device. You can try again, or continue without a photo.',
    failed: 'We could not save the photo. Check your connection and try again.',
    unusable: 'This photo could not be used. Retake it, or continue without a photo.',
    limit: 'You have used all your photo tries. Continue without a new photo.',
  },

  rules: {
    title: 'Test rules',
    intro: 'Please read these rules before you start.',
    items: [
      // R5-24, R5-66 c, R5-68 a: no paste rule before start; the test screen shows it where an answer is typed.
      'Answer on your own. Where you type an answer, the screen shows whether pasting text is allowed. Dropping text is turned off. Paste and drop attempts are recorded.',
      'We record your start photo, your answers and every edit, paste and drop attempts, when you leave this tab, when you leave full screen, and a regular signal that the page is still connected.',
      'We never record camera video, sound or your screen.',
      'The timer starts when you press Start test and keeps running even if you lose your connection or close the page. Your answers are saved as you type.',
      'When the time is up, your answers are submitted for you.',
      'The people who invited you see your answers and this record. To ask for your data to be deleted, contact the person who invited you.',
    ],
    ackLabel: 'I have read the rules',
    start: 'Start test',
    mustAck: 'Tick the box to confirm you have read the rules.',
    wait: (retryAfterSeconds: number | undefined) =>
      `Please wait ${seconds(retryAfterSeconds ?? 10)} and try again.`,
  },

  test: {
    questions: 'Questions',
    question: (n: number, of: number) => `Question ${n} of ${of}`,
    answered: 'answered',
    previous: 'Previous question',
    next: 'Next question',
    loadingItem: 'Loading the question…',
    itemFailed: 'We could not load this question. Check your connection and try again.',
    retry: 'Try again',
    chooseOne: 'Choose one answer',
    clearChoice: 'Clear my choice',
    answerLabel: 'Your answer',
    chars: (n: number, max: number) => `${n} of ${max} characters`,
    timeLeft: 'Time left',
    announce: {
      tenMinutes: '10 minutes left',
      fiveMinutes: '5 minutes left',
      oneMinute: '1 minute left',
      thirtySeconds: '30 seconds left',
    },
    offline: OFFLINE_MESSAGE,
    backOnline: 'Back online. Your answers are being saved.',
    submit: 'Submit test',
    confirmTitle: 'Submit your test?',
    confirmBody: 'You cannot change your answers after you submit.',
    confirm: 'Yes, submit now',
    keepWorking: 'Keep working',
    submitting: 'Submitting your test…',
    timeUp: 'Time is up. Your answers are being submitted.',
    submitOffline:
      'We could not reach the test service, so your test is not submitted yet. Your answers are kept on this device. Check your connection and try again.',
    fullscreen: 'Return to full screen',

    // M1 sections (R5-9, R5-20, R5-24, R5-59 e, R5-66). Neutral: a closed section is a matter of time or choice.
    section: (n: number, of: number, title: string) => `Section ${n} of ${of}: ${title}`,
    sectionTimeLeft: 'Time left in this section',
    sectionClosed: 'This section is closed. Its answers are saved and can no longer be changed.',
    sectionNotOpen: 'This section opens when the one before it ends.',
    passedQuestion:
      'You have moved on from this question. Questions in this section are answered in order.',
    forwardOnly:
      'Questions in this section are answered in order: you cannot go back to an earlier question.',
    pasteBlocked: 'Pasting text is turned off in this section. Paste attempts are recorded.',
    /** R5-68 a: a v1 (D1) test screen, from the view's `pasteBlocked`. */
    pasteOffInTest: 'Pasting text is turned off in this test. Paste attempts are recorded.',
    pasteAllowed:
      'Pasting text is allowed in this section. Each paste is recorded and shown to the reviewers as context.',
    dropBlocked: 'Dropping text is turned off.',
    finishSection: 'Finish this section',
    finishTitle: 'Finish this section?',
    finishBody:
      'Finishing is final: you cannot go back to this section or change its answers after you finish.',
    finishConfirm: 'Yes, finish this section',
    finishCancel: 'Stay in this section',
    moving: 'Saving your answers and opening the next part of the test…',
    imageUnavailable: (alt: string) => `Image unavailable. Description: ${alt}`,
  },

  submitted: {
    title: 'Test submitted',
    body: 'Thank you. Your answers have been received.',
    receiptLabel: 'Receipt number',
    submittedAtLabel: 'Submitted at',
    keep: 'Keep this receipt number in case you need to contact the person who invited you.',
  },

  error: {
    title: 'Something went wrong',
    superseded: 'This test is open in another window. Continue there, or close this window.',
    invalid: 'This test session can no longer be used here. Open your invitation link again.',
    network: 'We could not reach the test service. Check your connection and try again.',
    step: 'A step before this one is not finished. Open your invitation link again to continue.',
    generic: 'Please try again. If this keeps happening, contact the person who invited you.',
    retry: 'Try again',
  },
} as const;

/** The receipt as the candidate sees it (§4.4): `TR-` and the 8-character reference. */
export const receiptLabel = (receiptRef: string): string => `TR-${receiptRef}`;
