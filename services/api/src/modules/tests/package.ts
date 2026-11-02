// The key-free TestPackage (spec §4.4; written to R2 `packages/{test_version_id}.json` at publish, §6.2). Built only
// from the version, its sections and its items: the answer keys and rubrics are read for the publish checks and never
// copied, and the schema has no key, rubric, weight, cutoff or score field. The bytes are the canonical JSON
// (@trace/shared/canonical-json) of the parsed package, and `content_sha256` is the SHA-256 hex of those exact bytes,
// supplied by the api (OPEN-7); the edge's SessionDO verifies the same hash when it loads the package.
import { canonicalJson } from '@trace/shared/canonical-json';
import { TestPackage } from '@trace/shared/contracts/candidate';
import { SIGNAL_CATALOG_VERSION } from '@trace/shared/signal-catalog';
import { sha256Hex } from '../candidate/encoding.js';
import { itemsOf, type Content, type TestRow, type VersionRow } from './authoring.js';

export const packageKey = (testVersionId: string): string => `packages/${testVersionId}.json`;

/** Why a draft cannot be published (the guard trigger refuses the same cases). */
export type PackageProblem =
  | 'no_sections'
  | 'empty_section'
  | 'mcq_without_key'
  | 'written_without_rubric'
  | 'no_ruleset'
  | 'bad_duration'
  | 'invalid';

export type BuiltPackage = { ok: true; pkg: TestPackage } | { ok: false; problem: PackageProblem };

export const buildPackage = (
  test: TestRow,
  version: VersionRow,
  content: Content,
): BuiltPackage => {
  if (version.ruleset_version_id === null) return { ok: false, problem: 'no_ruleset' };
  if (version.total_time_seconds < 60 || version.total_time_seconds > 7200)
    return { ok: false, problem: 'bad_duration' };
  const sections = [...content.sections].sort((a, b) => a.position - b.position);
  if (sections.length === 0) return { ok: false, problem: 'no_sections' };
  const ordered = sections.map((s) => ({ section: s, items: itemsOf(content, s.id) }));
  if (ordered.some((s) => s.items.length === 0)) return { ok: false, problem: 'empty_section' };
  for (const { items } of ordered) {
    for (const item of items) {
      if (item.format === 'mcq') {
        const key = content.keys.get(item.id);
        if (key === undefined || !(item.options ?? []).some((o) => o.id === key))
          return { ok: false, problem: 'mcq_without_key' };
      } else if (item.rubric_version_id === null || !content.rubrics.has(item.rubric_version_id)) {
        return { ok: false, problem: 'written_without_rubric' };
      }
    }
  }
  let position = 0;
  const candidate = {
    v: 1,
    testVersionId: version.id,
    rulesetVersionId: version.ruleset_version_id,
    title: test.name,
    language: 'en',
    durationSeconds: version.total_time_seconds,
    pasteBlocked: true,
    heartbeatSeconds: 10,
    signalCatalogVersion: SIGNAL_CATALOG_VERSION,
    sections: ordered.map(({ section }) => ({
      id: section.id,
      title: section.name,
      position: section.position,
    })),
    items: ordered.flatMap(({ section, items }) =>
      items.map((item) => {
        position += 1;
        return item.format === 'mcq'
          ? {
              position,
              sectionId: section.id,
              itemVersionId: item.id,
              kind: 'mcq' as const,
              prompt: item.stem,
              options: (item.options ?? []).map((o) => ({ id: o.id, label: o.text })),
            }
          : {
              position,
              sectionId: section.id,
              itemVersionId: item.id,
              kind: 'written' as const,
              prompt: item.stem,
            };
      }),
    ),
  };
  const parsed = TestPackage.safeParse(candidate);
  return parsed.success ? { ok: true, pkg: parsed.data } : { ok: false, problem: 'invalid' };
};

export interface EncodedPackage {
  text: string;
  sha256: string;
}

export const encodePackage = async (pkg: TestPackage): Promise<EncodedPackage> => {
  const text = canonicalJson(pkg);
  return { text, sha256: await sha256Hex(text) };
};
