// Report data. The organisation report and the candidate projection are built separately.
// The candidate projection is an allow-list (like `report_candidate_view` in the product):
// it copies only fields that are the candidate's own, so another candidate's identity or
// answer can never leak through a field someone forgot to delete (rule 5).
import * as server from './server.js';
import { actorRoleOnly } from './util.js';

export function buildOrgReport(a) {
  const test = server.getTest(a.testId);
  const invite = server.getInvite(a.inviteToken);
  const aq = a.results.aq;
  const integ = a.results.integrity;
  const editsPerItem = {};
  for (const e of a.editEvents) editsPerItem[e.itemId] = (editsPerItem[e.itemId] ?? 0) + 1;
  return {
    kind: 'org',
    attemptId: a.id,
    candidateLabel: a.candidateLabel,
    email: invite?.email ?? '',
    testTitle: test.title,
    durationMin: test.durationMin,
    pastePolicy: test.pastePolicy,
    startedAt: a.startedAt,
    submittedAt: a.submittedAt,
    autoSubmitted: a.autoSubmitted,
    receipt: a.receipt,
    device: a.device?.kind ?? '—',
    camera: a.camera,
    versions: {
      ruleset: integ.rulesetVersion,
      rulesetFrozenAt: test.ruleset.frozenAt,
      grader: aq.graderVersion,
      consent: a.consent?.version ?? '—',
    },
    aq: {
      score: aq.score,
      sections: aq.sections,
      items: test.items.map((item, i) => ({
        n: i + 1,
        id: item.id,
        type: item.type,
        prompt: item.prompt,
        options: item.options ?? null,
        correct: item.type === 'mcq' ? item.correct : null,
        answer: a.finalAnswers?.[item.id],
        edits: editsPerItem[item.id] ?? 0,
        grade: aq.items[i],
      })),
    },
    shortlisted: Boolean(a.shortlist),
    shortlist: a.shortlist,
    scoreDecision: a.scoreDecision,
    integrity: a.shortlist
      ? {
          notUsed: false,
          band: integ.band,
          reasons: integ.reasons,
          evidenceStrength: integ.evidenceStrength,
          tierCounts: integ.tierCounts,
          families: integ.families,
          flags: integ.flags.map((f) => ({ ...f, review: server.flagState(a, f.id) })),
          context: integ.context,
          events: a.events,
        }
      : { notUsed: true, eventCount: a.events.length },
    review: a.review,
    status: server.triageStatus(a),
    audit: a.audit,
  };
}

export function projectForCandidate(org) {
  const integ = org.integrity;
  return {
    kind: 'candidate',
    attemptId: org.attemptId,
    candidateLabel: org.candidateLabel,
    testTitle: org.testTitle,
    durationMin: org.durationMin,
    pastePolicy: org.pastePolicy,
    startedAt: org.startedAt,
    submittedAt: org.submittedAt,
    autoSubmitted: org.autoSubmitted,
    receipt: org.receipt,
    device: org.device,
    camera: org.camera,
    versions: { ...org.versions },
    aq: {
      score: org.aq.score,
      sections: org.aq.sections,
      items: org.aq.items.map((it) => ({
        n: it.n,
        id: it.id,
        type: it.type,
        prompt: it.prompt,
        options: it.options,
        correct: null, // the answer key is not shown, so items stay usable
        answer: it.answer,
        edits: it.edits,
        grade: {
          earned: it.grade.earned,
          points: it.grade.points,
          correct: it.grade.correct,
          answered: it.grade.answered,
          detail: it.grade.detail,
          matched: it.grade.matched,
          missing: it.grade.missing,
          words: it.grade.words,
          minWords: it.grade.minWords,
          criteria: it.grade.criteria,
        },
      })),
    },
    shortlisted: org.shortlisted,
    shortlist: null,
    scoreDecision: org.scoreDecision
      ? { outcome: org.scoreDecision.outcome, basis: 'answer_quality' }
      : null,
    integrity: integ.notUsed
      ? { notUsed: true }
      : {
          notUsed: false,
          band: integ.band,
          reasons: [],
          evidenceStrength: integ.evidenceStrength,
          tierCounts: integ.tierCounts,
          families: integ.families.map((f) => ({
            family: f.family,
            status: f.status,
            tone: f.tone,
            observed: f.observed,
          })),
          flags: integ.flags.map((f) => ({
            id: f.id,
            ruleId: f.ruleId,
            name: f.name,
            family: f.family,
            tier: f.tier,
            severity: f.severity,
            t: f.t,
            eventIds: f.eventIds,
            stillId: f.stillId, // the candidate's own still
            viewableMedia: f.viewableMedia,
            untrustedInput: f.untrustedInput,
            oftenInnocent: f.oftenInnocent,
            observed:
              f.ruleId === 'S-01'
                ? 'Your answer closely matched another submission in this test. The other person and their answer are not shown to you.'
                : f.observed,
            threshold: null, // exact thresholds are shared on appeal, not in the report
            counterpart: null,
            review: {
              state: f.review.state,
              rationale: f.review.rationale ?? null,
              at: f.review.at ?? null,
            },
          })),
          context: integ.context.map((c) => ({ ...c })),
          events: integ.events.map(candidateEvent),
        },
    review: {
      flags: {},
      notice: org.review.notice
        ? {
            sentAt: org.review.notice.sentAt,
            skipMs: org.review.notice.skipMs,
            response: org.review.notice.response,
            by: null,
          }
        : null,
      final: org.review.final
        ? {
            outcome: org.review.final.outcome,
            rationale: org.review.final.rationale,
            at: org.review.final.at,
            by: null,
          }
        : null,
    },
    status: org.status,
    audit: org.audit.map((x) => ({ t: x.t, actor: actorRoleOnly(x.actor), action: x.action })),
  };
}

const EVENT_FIELDS = [
  'id',
  't',
  'at',
  'type',
  'itemId',
  'length',
  'blocked',
  'internal',
  'awayMs',
  'reason',
  'stillId',
  'durationS',
  'durationMs',
  'note',
  'similarity',
  'itemLabel',
];

/** The candidate's own events, minus anything about another person. */
function candidateEvent(e) {
  const out = {};
  for (const k of EVENT_FIELDS) if (k in e) out[k] = e[k];
  return out;
}
