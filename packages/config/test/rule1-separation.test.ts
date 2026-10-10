// Product rule 1: quality and integrity code never import each other (spec §10.1).
// The directories do not exist yet, so this runs on virtual files.
import { describe, expect, it } from 'vitest';
import { ruleMessages } from './helpers.js';

const RULE = 'boundaries/dependencies';

const importOf = (source: string): string => `import { x } from '${source}';\nexport { x };\n`;

function violations(from: string, source: string): number {
  return ruleMessages(from, importOf(source), RULE).length;
}

describe('rule 1: quality and integrity stay apart', () => {
  it.each([
    // services/api modules
    ['services/api/src/modules/quality/score.ts', '../integrity/band'],
    ['services/api/src/modules/quality/score.ts', '../integrity'],
    ['services/api/src/modules/quality/score.ts', './../integrity/index'],
    ['services/api/src/modules/quality/score.ts', '../../modules/integrity/band'],
    ['services/api/src/modules/quality/deep/nested/score.ts', '../../../integrity/band'],
    ['services/api/src/modules/integrity/band.ts', '../quality/score'],
    ['services/api/src/modules/integrity/review/flags.ts', '../../quality/rubric/grade'],
    // workers/jobs
    ['workers/jobs/src/quality/grade.ts', '../integrity/detect'],
    ['workers/jobs/src/integrity/detect.ts', '../quality/grade'],
    ['workers/jobs/src/integrity/a/b.ts', '../../quality/c/d'],
  ])('%s may not import %s', (from, source) => {
    expect(violations(from, source)).toBe(1);
  });

  it('applies to type-only imports too', () => {
    const code = "import type { Band } from '../integrity/band';\nexport type { Band };\n";
    expect(ruleMessages('services/api/src/modules/quality/score.ts', code, RULE).length).toBe(1);
  });

  it.each([
    // each side may use its own files
    ['services/api/src/modules/quality/score.ts', './rubric'],
    ['services/api/src/modules/integrity/band.ts', './rules/v1'],
    ['workers/jobs/src/quality/grade.ts', './llm/prompt'],
    // and neutral code in the same service or Worker
    ['services/api/src/modules/quality/score.ts', '../../lib/http'],
    ['services/api/src/modules/integrity/band.ts', '../sessions/state'],
    ['workers/jobs/src/integrity/detect.ts', '../queue/consumer'],
    // and the shared packages
    ['services/api/src/modules/quality/score.ts', '@trace/shared'],
    ['workers/jobs/src/integrity/detect.ts', '@trace/vendors'],
    // neutral code may import either side (a router wires both)
    ['services/api/src/modules/router.ts', './quality/score'],
    ['services/api/src/modules/router.ts', './integrity/band'],
  ])('%s may import %s', (from, source) => {
    expect(violations(from, source)).toBe(0);
  });
});
