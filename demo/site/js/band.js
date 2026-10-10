// Integrity Signals: the band engine (plan §6, §7.2). Deterministic and versioned:
// the same events and context always give the same band. It never reads answers or the
// Answer Quality score (rule 1); its only inputs are integrity events and coverage context.
export const RULESET_VERSION = 'ruleset v1';

export const BANDS = {
  clear: {
    label: 'Clear',
    tone: 'clear',
    recruiter: 'Proceed',
    candidate: 'Nothing needs explaining',
  },
  review: {
    label: 'Review',
    tone: 'review',
    recruiter: 'A person checks before any integrity decision',
    candidate: 'A person will check this',
  },
  strong: {
    label: 'Strong concern',
    tone: 'concern',
    recruiter: 'Confirm or overturn each flag; notice + 72 h before any decision',
    candidate: 'Needs explanation',
  },
  insufficient: {
    label: 'Insufficient evidence',
    tone: 'insufficient',
    recruiter: 'Use another stage (interview, supervised re-test) to judge integrity',
    candidate: 'Integrity not assessed',
  },
};

export const TIERS = {
  T1: 'T1 server-observed',
  T2: 'T2 content-bound',
  T3: 'T3 client-reported',
};

export const FAMILIES = {
  typing: 'Typing',
  focus: 'Focus',
  paste: 'Paste',
  camera: 'Camera',
  mic: 'Mic',
  environment: 'Environment',
  identity: 'Identity',
  server: 'Server-observed',
};

/** Demo thresholds. The product calibrates every threshold on the accuracy study (plan §6). */
export const THRESHOLDS = {
  mergeMs: 1500,
  focusEpisodesForFlag: 3,
  blockedPasteMedium: 3,
  allowedPasteChars: 200,
  secondFaceSeconds: 10,
  similarity: 0.85,
  coverageFloor: 0.6,
  connectivityShare: 0.25,
};

/** The rule table published inside the product (plan §7.2). */
export const RULES = [
  {
    id: 'F-01',
    plain: 'Context; repeated → soft flag',
    name: 'Left the test (tab hidden, window blur or fullscreen exit)',
    family: 'focus',
    tier: 'T3',
    role: `Context; ${THRESHOLDS.focusEpisodesForFlag}+ episodes → soft flag`,
  },
  {
    id: 'P-01',
    plain: 'Flag',
    name: 'Paste from outside the test',
    family: 'paste',
    tier: 'T3',
    role: `Blocked policy: any attempt → soft flag, ${THRESHOLDS.blockedPasteMedium}+ → medium. Allowed policy: ${THRESHOLDS.allowedPasteChars}+ characters → soft flag`,
  },
  {
    id: 'P-02',
    plain: 'Ignored (context only)',
    name: 'Paste from within the test',
    family: 'paste',
    tier: 'T3',
    role: 'Ignored (context only)',
  },
  {
    id: 'Q-01',
    plain: 'Soft flag',
    name: 'Question copy',
    family: 'paste',
    tier: 'T3',
    role: 'Soft flag',
  },
  {
    id: 'U-01',
    plain: 'Hard evidence',
    name: 'Untrusted input (isTrusted = false)',
    family: 'environment',
    tier: 'T3',
    role: 'Hard evidence: can reach Strong concern',
  },
  {
    id: 'C-02',
    plain: 'Flag; with a viewable still can reach Strong concern',
    name: 'Second face',
    family: 'camera',
    tier: 'T3',
    role: `${THRESHOLDS.secondFaceSeconds}+ s → flag; with a still a reviewer can view it can reach Strong concern`,
  },
  {
    id: 'S-01',
    plain: 'Flag (T1)',
    name: 'Content similarity within the drive',
    family: 'server',
    tier: 'T1',
    role: `Similarity ≥ ${THRESHOLDS.similarity} → flag (T1)`,
  },
  {
    id: 'S-02',
    plain: 'Hard evidence (T1)',
    name: 'Replay mismatch (rebuilt answer ≠ submitted answer)',
    family: 'server',
    tier: 'T1',
    role: 'Hard evidence (T1)',
  },
  {
    id: 'K-01',
    plain: 'Context; lowers coverage',
    name: 'Connectivity gap',
    family: 'environment',
    tier: 'T3',
    role: 'Labelled "Connectivity", never focus loss; lowers coverage',
  },
  {
    id: 'C-01',
    plain: 'Context only',
    name: 'Server-requested random still',
    family: 'camera',
    tier: 'T3',
    role: 'Context only',
  },
];

const EXPECTED_FAMILIES = ['focus', 'paste', 'camera', 'environment'];

/**
 * @param {Array<{id: string, t: number, type: string}>} events integrity events, any order
 * @param {{pastePolicy: 'blocked'|'allowed', camera: 'allowed'|'declined', durationMs: number}} ctx
 */
export function evaluate(events, ctx) {
  const sorted = [...events].sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  const flags = [];
  const context = [];

  // F-01: focus episodes. Events within mergeMs of each other are one episode.
  const exits = sorted.filter((e) =>
    ['tab_hidden', 'window_blur', 'fullscreen_exit'].includes(e.type),
  );
  const episodes = [];
  for (const e of exits) {
    const last = episodes[episodes.length - 1];
    if (last && e.t - last.end <= THRESHOLDS.mergeMs) {
      last.events.push(e);
      last.end = e.t;
    } else episodes.push({ start: e.t, end: e.t, events: [e] });
  }
  const awayMs = sorted
    .filter((e) => e.type === 'tab_visible' || e.type === 'window_focus')
    .reduce((s, e) => Math.max(s, e.awayMs ?? 0), 0);
  if (episodes.length >= THRESHOLDS.focusEpisodesForFlag) {
    flags.push(
      makeFlag(
        'F-01',
        'Repeated focus loss',
        'focus',
        'T3',
        'soft',
        episodes.flatMap((p) => p.events),
        {
          observed: `${episodes.length} times the test lost focus (longest away ${Math.round(awayMs / 1000)} s)`,
          threshold: `${THRESHOLDS.focusEpisodesForFlag}+ episodes`,
          oftenInnocent: 'Notifications, a phone call, an OS dialog, a family member at the door',
        },
      ),
    );
  } else {
    for (const p of episodes) {
      context.push(makeContext('F-01', 'Left the test', 'focus', p.events));
    }
  }

  // P-01 / P-02: pastes. Content is never stored, only its length.
  const pastes = sorted.filter((e) => e.type === 'paste');
  const external = pastes.filter((e) => !e.internal);
  for (const p of pastes.filter((e) => e.internal)) {
    context.push(makeContext('P-02', 'Paste from within the test (ignored)', 'paste', [p]));
  }
  if (external.length) {
    const chars = external.reduce((s, e) => s + (e.length ?? 0), 0);
    if (ctx.pastePolicy === 'blocked') {
      const severity = external.length >= THRESHOLDS.blockedPasteMedium ? 'medium' : 'soft';
      flags.push(
        makeFlag(
          'P-01',
          'Paste attempt while pasting is blocked',
          'paste',
          'T3',
          severity,
          external,
          {
            observed: `${external.length} blocked paste attempt(s), ${chars} characters in total (content not stored)`,
            threshold: `Any attempt; ${THRESHOLDS.blockedPasteMedium}+ attempts is medium`,
            oftenInnocent: 'Habitual Ctrl+V, a password manager, an accessibility tool',
          },
        ),
      );
    } else if (chars >= THRESHOLDS.allowedPasteChars) {
      flags.push(
        makeFlag('P-01', 'Large paste from outside the test', 'paste', 'T3', 'soft', external, {
          observed: `${external.length} paste(s), ${chars} characters (content not stored)`,
          threshold: `${THRESHOLDS.allowedPasteChars}+ characters`,
          oftenInnocent: 'Pasting your own notes where the test allows it',
        }),
      );
    } else {
      for (const p of external) context.push(makeContext('P-01', 'Paste (allowed)', 'paste', [p]));
    }
  }

  // Q-01: question copy.
  const copies = sorted.filter((e) => e.type === 'question_copy');
  if (copies.length) {
    flags.push(
      makeFlag('Q-01', 'Question text copied', 'paste', 'T3', 'soft', copies, {
        observed: `Question text copied ${copies.length} time(s)`,
        threshold: 'Any',
        oftenInnocent: 'Copying a phrase to quote it in the answer',
      }),
    );
  }

  // U-01: untrusted input events.
  const untrusted = sorted.filter((e) => e.type === 'untrusted_input');
  if (untrusted.length) {
    flags.push(
      makeFlag('U-01', 'Untrusted input events', 'environment', 'T3', 'hard', untrusted, {
        observed: `${untrusted.length} input event(s) not generated by a real keyboard or touch (isTrusted = false)`,
        threshold: 'Any',
        oftenInnocent: 'An assistive-input tool not declared as an accommodation',
        untrustedInput: true,
      }),
    );
  }

  // C-02: second face, with or without a still a reviewer can view.
  for (const e of sorted.filter((x) => x.type === 'second_face')) {
    if ((e.durationS ?? 0) < THRESHOLDS.secondFaceSeconds) continue;
    flags.push(
      makeFlag('C-02', 'Second face near the screen', 'camera', 'T3', 'medium', [e], {
        observed: `A second face close to the screen for ${e.durationS} s`,
        threshold: `${THRESHOLDS.secondFaceSeconds}+ s and close to the screen`,
        oftenInnocent: 'A family member walking in and staying briefly',
        stillId: e.stillId ?? null,
        viewableMedia: Boolean(e.stillId),
      }),
    );
  }

  // S-01: similarity within the drive (T1).
  for (const e of sorted.filter((x) => x.type === 'similarity')) {
    if ((e.similarity ?? 0) < THRESHOLDS.similarity) continue;
    flags.push(
      makeFlag('S-01', 'Answer closely matches another submission', 'server', 'T1', 'hard', [e], {
        observed: `Similarity ${e.similarity.toFixed(2)} on ${e.itemLabel ?? 'a written answer'}`,
        threshold: `≥ ${THRESHOLDS.similarity}`,
        oftenInnocent: 'Both candidates used the same training template',
        counterpart: {
          attemptId: e.counterpartAttemptId,
          label: e.counterpartLabel,
          excerpt: e.counterpartExcerpt,
        },
      }),
    );
  }

  // S-02: replay mismatch (T1).
  const replay = sorted.filter((e) => e.type === 'replay_mismatch');
  if (replay.length) {
    flags.push(
      makeFlag(
        'S-02',
        'Submitted answer differs from the replayed edits',
        'server',
        'T1',
        'hard',
        replay,
        {
          observed: 'The answer rebuilt from edit events does not match the submitted text',
          threshold: 'Any',
          oftenInnocent: 'Rarely innocent; check for a sync fault before confirming',
        },
      ),
    );
  }

  // Context-only entries.
  for (const e of sorted.filter((x) => x.type === 'connectivity_gap')) {
    context.push(makeContext('K-01', 'Connectivity', 'environment', [e]));
  }
  for (const e of sorted.filter((x) => x.type === 'still')) {
    context.push(
      makeContext(
        'C-01',
        e.reason === 'start' ? 'Start photo' : 'Random still',
        'camera',
        [e],
        e.stillId,
      ),
    );
  }

  // Coverage / evidence strength: share of expected families with usable data.
  const gapMs = sorted
    .filter((e) => e.type === 'connectivity_gap')
    .reduce((s, e) => s + (e.durationMs ?? 0), 0);
  const connectivityPoor =
    ctx.durationMs > 0 && gapMs / ctx.durationMs >= THRESHOLDS.connectivityShare;
  const usable = {
    focus: !connectivityPoor,
    paste: true,
    camera: ctx.camera === 'allowed' && !connectivityPoor,
    environment: true,
  };
  const evidenceStrength =
    Math.round(
      (100 * EXPECTED_FAMILIES.filter((f) => usable[f]).length) / EXPECTED_FAMILIES.length,
    ) / 100;

  // The band (plan §7.2), in order.
  const reasons = [];
  let band;
  const t3Families = new Set(flags.filter((f) => f.tier === 'T3').map((f) => f.family));
  if (evidenceStrength < THRESHOLDS.coverageFloor) {
    band = 'insufficient';
    const why = [];
    if (ctx.camera !== 'allowed') why.push('camera declined');
    if (connectivityPoor) why.push('connectivity gaps');
    reasons.push(
      `Evidence coverage ${evidenceStrength} is below the floor ${THRESHOLDS.coverageFloor} (${why.join(', ') || 'device'})`,
    );
  } else if (
    flags.some((f) => f.tier === 'T1' || f.tier === 'T2' || f.untrustedInput || f.viewableMedia)
  ) {
    band = 'strong';
    for (const f of flags) {
      if (f.tier === 'T1' || f.tier === 'T2') reasons.push(`${f.ruleId}: ${f.tier} evidence`);
      else if (f.untrustedInput) reasons.push(`${f.ruleId}: untrusted input`);
      else if (f.viewableMedia) reasons.push(`${f.ruleId}: T3 with raw media a reviewer can view`);
    }
  } else if (t3Families.size >= 2 || flags.some((f) => f.severity === 'medium')) {
    band = 'review';
    if (t3Families.size >= 2) {
      reasons.push(
        `T3 flags from ${t3Families.size} families (${[...t3Families].map((f) => FAMILIES[f]).join(', ')})`,
      );
    }
    for (const f of flags.filter((x) => x.severity === 'medium'))
      reasons.push(`${f.ruleId}: one medium flag`);
    reasons.push('Client-reported (T3) signals without viewable media are capped at Review');
  } else {
    band = 'clear';
    reasons.push(flags.length ? 'At most one T3 soft signal' : 'No flags raised');
  }

  const tierCounts = { T1: 0, T2: 0, T3: 0 };
  for (const f of flags) tierCounts[f.tier] += 1;

  return {
    rulesetVersion: RULESET_VERSION,
    band,
    reasons,
    evidenceStrength,
    usable,
    flags,
    context,
    tierCounts,
    families: familySummary(flags, context, usable, ctx),
  };
}

function makeFlag(ruleId, name, family, tier, severity, events, extra) {
  return {
    id: `${ruleId}@${events[0].id}`,
    ruleId,
    name,
    family,
    tier,
    severity,
    eventIds: events.map((e) => e.id),
    t: events[0].t,
    viewableMedia: false,
    untrustedInput: false,
    stillId: null,
    ...extra,
  };
}

function makeContext(ruleId, name, family, events, stillId = null) {
  return {
    id: `${ruleId}@${events[0].id}`,
    ruleId,
    name,
    family,
    eventIds: events.map((e) => e.id),
    t: events[0].t,
    stillId,
  };
}

function familySummary(flags, context, usable, ctx) {
  const rows = [];
  const status = (family) => {
    const f = flags.filter((x) => x.family === family);
    const c = context.filter((x) => x.family === family);
    if (f.length)
      return {
        status: 'Flag',
        tone: f.some((x) => x.tier !== 'T3' || x.viewableMedia || x.untrustedInput)
          ? 'concern'
          : 'review',
        observed: f.map((x) => x.observed).join('; '),
      };
    if (c.length)
      return { status: 'Context', tone: 'neutral', observed: `${c.length} event(s), context only` };
    return { status: 'Not found', tone: 'clear', observed: 'Nothing observed' };
  };
  rows.push({
    family: 'typing',
    status: 'Not in prototype',
    tone: 'neutral',
    observed: 'Typing provenance needs the warm-up baseline; not simulated here',
  });
  rows.push({
    family: 'focus',
    ...(usable.focus
      ? status('focus')
      : { status: 'Low coverage', tone: 'insufficient', observed: 'Connectivity gaps' }),
  });
  rows.push({ family: 'paste', ...status('paste') });
  rows.push({
    family: 'camera',
    ...(ctx.camera === 'allowed'
      ? status('camera')
      : {
          status: 'Not available',
          tone: 'insufficient',
          observed: 'Camera declined: lowers coverage, never blocks',
        }),
  });
  rows.push({
    family: 'mic',
    status: 'Off',
    tone: 'neutral',
    observed: 'Off outside voice questions (Standard preset)',
  });
  rows.push({ family: 'environment', ...status('environment') });
  rows.push({
    family: 'identity',
    status: 'Not enabled',
    tone: 'neutral',
    observed: 'ID check off for this assessment',
  });
  rows.push({ family: 'server', ...status('server') });
  return rows;
}
