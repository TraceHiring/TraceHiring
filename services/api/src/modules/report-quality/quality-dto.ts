// QualityCard from a public.quality_cards row (spec §6.2, rule 1). Answer Quality only: no integrity value is read or
// written here. The section names come from `sections` (the card row holds ids, weights and scores only); a section
// the card names but the caller cannot read is a failure, never a blank name.
import type { QualityCard, QualityCardRow } from '@trace/shared/contracts/d1';

type Ready = Extract<QualityCard, { state: 'ready' }>;

/**
 * The rubric version label: the card records the rubric set by its SHA-256 (`rubric_set_sha256`, L-23), so the label
 * is a short prefix of it. The same derivation is used by the report metadata endpoint.
 */
export const rubricVersionLabel = (rubricSetSha256: string): string =>
  `rubric-set-${rubricSetSha256.slice(0, 12)}`;

/** The ready card, or null when a section name is missing (the caller answers `unavailable`). */
export const qualityCardFromRow = (
  row: QualityCardRow,
  sectionNames: ReadonlyMap<string, string>,
): Ready | null => {
  const sections: Ready['sections'] = [];
  for (const s of row.section_scores) {
    const name = sectionNames.get(s.sectionId);
    if (name === undefined) return null;
    sections.push({
      sectionId: s.sectionId,
      name,
      weight: s.weight,
      scoreHundredths: s.scoreHundredths,
    });
  }
  return {
    state: 'ready',
    score: row.score,
    sections,
    graderModelId: row.grader_model_id,
    rubricVersion: rubricVersionLabel(row.rubric_set_sha256),
    scoringVersion: row.scoring_version,
  };
};
