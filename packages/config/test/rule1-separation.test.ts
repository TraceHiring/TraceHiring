// Product rule 1: quality and integrity code never import each other (spec §10.1).
// The directories do not exist yet, so this runs on virtual files.
import { describe, expect, it } from 'vitest';
import { boundaryMessages } from './helpers.js';

const importOf = (source: string): string => `import { x } from '${source}';\nexport { x };\n`;

function violations(from: string, source: string): number {
  return boundaryMessages(from, importOf(source)).length;
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
    // neutral local files are a bridge, so each side may not import them either
    ['services/api/src/modules/quality/score.ts', '../bridge'],
    ['services/api/src/modules/quality/score.ts', '../../lib/http'],
    ['services/api/src/modules/integrity/band.ts', '../sessions/state'],
    ['services/api/src/modules/integrity/band.ts', '../../index'],
    ['workers/jobs/src/integrity/detect.ts', '../queue/consumer'],
    ['workers/jobs/src/quality/grade.ts', '../index'],
    // and never the other host's code
    ['workers/jobs/src/quality/grade.ts', '../../../../services/api/src/modules/quality/score'],
    // the band engine is integrity-only: quality code may not import it (specs/d1-demo-slice.md §5.1)
    ['workers/jobs/src/quality/score.ts', '@trace/band-engine'],
    ['workers/jobs/src/quality/score.ts', '@trace/band-engine/rules/d1-v1.json'],
    ['services/api/src/modules/quality/score.ts', '@trace/band-engine'],
    ['services/api/src/modules/report-quality/quality/dto.ts', '@trace/band-engine'],
    // a neutral jobs file is not an integrity file
    ['workers/jobs/src/queue/consumer.ts', '@trace/band-engine'],
    // the two report card modules are the two sides (d1 §6.2, L-19, AT-D3): neither imports the other,
    // and the quality card module never reaches the band engine
    ['services/api/src/modules/report-quality/dto.ts', '../report-integrity/dto'],
    ['services/api/src/modules/report-quality/routes.ts', '../report-integrity'],
    ['services/api/src/modules/report-integrity/projection.ts', '../report-quality/dto'],
    ['services/api/src/modules/report-integrity/projection.ts', '../reports/meta'],
    ['services/api/src/modules/report-quality/dto.ts', '@trace/band-engine'],
  ])('%s may not import %s', (from, source) => {
    expect(violations(from, source)).toBeGreaterThan(0);
  });

  it('the bridge case: quality -> neutral re-export of integrity is denied', () => {
    // modules/bridge.ts may re-export integrity (neutral code may import either side) ...
    expect(violations('services/api/src/modules/bridge.ts', '../modules/integrity/band')).toBe(0);
    // ... but quality may not import the bridge.
    expect(violations('services/api/src/modules/quality/score.ts', '../bridge')).toBeGreaterThan(0);
  });

  it('applies to type-only imports too', () => {
    const code = "import type { Band } from '../integrity/band';\nexport type { Band };\n";
    expect(
      boundaryMessages('services/api/src/modules/quality/score.ts', code).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    // each side may use its own files
    ['services/api/src/modules/quality/score.ts', './rubric'],
    ['services/api/src/modules/integrity/band.ts', './rules/v1'],
    ['workers/jobs/src/quality/grade.ts', './llm/prompt'],
    ['services/api/src/modules/a/quality/x.ts', '../../b/quality/y'],
    ['services/api/src/modules/report-quality/routes.ts', './dto'],
    ['services/api/src/modules/report-integrity/routes.ts', './projection'],
    ['services/api/src/modules/report-integrity/projection.ts', '@trace/band-engine'],
    ['services/api/src/modules/report-integrity/projection.ts', '@trace/shared/contracts/d1'],
    // and the shared packages, npm packages and Node built-ins
    ['services/api/src/modules/quality/score.ts', '@trace/shared'],
    ['services/api/src/modules/quality/score.ts', '@trace/db-types'],
    ['workers/jobs/src/integrity/detect.ts', '@trace/vendors'],
    ['workers/jobs/src/quality/grade.ts', 'zod'],
    ['workers/jobs/src/integrity/detect.ts', 'node:crypto'],
    // the band engine: integrity code may import it (workers/jobs and services/api), quality never
    ['workers/jobs/src/integrity/band.ts', '@trace/band-engine'],
    ['workers/jobs/src/integrity/band.ts', '@trace/band-engine/rules/d1-v1.json'],
    ['services/api/src/modules/report-integrity/integrity/dto.ts', '@trace/band-engine'],
    // neutral code may import either side (a router wires both)
    ['services/api/src/modules/router.ts', './quality/score'],
    ['services/api/src/modules/router.ts', './integrity/band'],
  ])('%s may import %s', (from, source) => {
    expect(violations(from, source)).toBe(0);
  });
});
