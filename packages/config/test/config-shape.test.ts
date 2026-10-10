// The shared config's public shape: the root eslint.config.js imports the default export.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import traceConfig, {
  createTraceConfig,
  ignores,
  repoRoot,
  traceConfig as named,
} from '../eslint/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('@trace/config/eslint', () => {
  it('default export is traceConfig', () => {
    expect(traceConfig).toBe(named);
    expect(Array.isArray(traceConfig)).toBe(true);
  });

  it('exports the shared ignores and applies them first', () => {
    expect(ignores).toContain('**/node_modules/**');
    expect(traceConfig[0]).toEqual({ ignores });
  });

  it('anchors element patterns at the repo root', () => {
    expect(repoRoot).toBe(path.resolve(here, '..', '..', '..'));
  });

  it('builds a config for another root without changing the default', () => {
    const other = createTraceConfig({ rootPath: path.join(here, 'fixtures', 'elsewhere') });
    expect(other).not.toBe(traceConfig);
    expect(other.length).toBe(traceConfig.length);
  });
});
