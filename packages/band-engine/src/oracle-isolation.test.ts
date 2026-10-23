// The band-engine-1 oracle (src/oracle/) is test-only (R5-52 e): no production file of the package imports it and
// the public surface does not export it, so a report can never be computed by the frozen engine.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as engine from './index.js';

const SRC = fileURLToPath(new URL('.', import.meta.url));

const productionFiles = (): string[] =>
  (readdirSync(SRC, { recursive: true }) as string[])
    .map((p) => relative(SRC, join(SRC, p)).split(sep).join('/'))
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.startsWith('oracle/'));

describe('band-engine-1 oracle isolation', () => {
  it('no production file mentions the oracle directory', () => {
    const files = productionFiles();
    expect(files).toContain('band.ts');
    expect(files).toContain('index.ts');
    const offenders = files.filter((p) => /oracle/i.test(readFileSync(join(SRC, p), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('the public surface exports one computeBand, the band-engine-2 one', () => {
    expect(engine.BAND_ENGINE_VERSION).toBe('band-engine-2');
    expect(Object.keys(engine)).not.toContain('computeBandV1');
  });
});
