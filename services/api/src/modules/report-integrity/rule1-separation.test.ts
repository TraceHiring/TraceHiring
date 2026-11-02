// Rule 1 (spec §6.2 L-19, AT-D3) and rule 6 (§6.3), real files of report-integrity: it imports neither report-quality
// nor any neutral module, imports from the d1 contracts only the integrity card types (so it shares no card type with
// report-quality, whose own test pins its quality-only set), and its only quality read is `meets_cutoff`: no select
// names a score, a cutoff number or a quality pointer.
import { describe, expect, it } from 'vitest';

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: '?raw'; import: 'default'; eager: true },
    ): Record<string, string>;
  }
}

const files = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true });
const isTest = (path: string) => /\.test(-helpers)?\.ts$/.test(path);
const production = Object.fromEntries(Object.entries(files).filter(([path]) => !isTest(path)));

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const CONTRACT_NAMES =
  /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@trace\/shared\/contracts\/d1['"]/g;
const SELECT = /select:\s*'([^']*)'/g;

describe('rule 1: report-integrity stays on its side (static, real files)', () => {
  it('found the module sources', () => {
    expect(Object.keys(production).sort()).toEqual([
      './errors.ts',
      './projection.ts',
      './reasons.ts',
      './routes.ts',
    ]);
  });

  it('imports only its own files, the shared packages and npm packages', () => {
    for (const [path, src] of Object.entries(files)) {
      for (const m of src.matchAll(SPECIFIER)) {
        const spec = m[1] ?? '';
        expect(spec, path).not.toMatch(/quality/);
        expect(spec.startsWith('./') || !spec.startsWith('.'), `${path}: ${spec}`).toBe(true);
      }
    }
  });

  it('imports only the integrity card types from the d1 contracts (no shared card type)', () => {
    const names = new Set(
      Object.values(files).flatMap((src) =>
        [...src.matchAll(CONTRACT_NAMES)].flatMap((m) =>
          (m[1] ?? '')
            .split(',')
            .map((n) => n.replace(/^\s*type\s+/, '').trim())
            .filter((n) => n !== ''),
        ),
      ),
    );
    expect([...names].sort()).toEqual([
      'IntegrityCard',
      'IntegrityCardRow',
      'IntegrityTimelineEntryRow',
    ]);
  });

  it('selects meets_cutoff alone from quality data: no score, cutoff number or quality pointer', () => {
    const cols = Object.values(production).flatMap((src) =>
      [...src.matchAll(SELECT)].map((m) => m[1] ?? ''),
    );
    expect(cols).toContain('meets_cutoff');
    for (const c of cols) expect(c).not.toMatch(/score|quality_cutoff|quality_card_id/);
    expect(Object.values(production).join('\n')).not.toMatch(
      /['"]sections['"]|['"`](integrity|quality)\./,
    );
  });
});
