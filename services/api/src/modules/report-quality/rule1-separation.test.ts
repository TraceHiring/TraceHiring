// Rule 1 (spec §6.2 L-19, AT-D3), real files of report-quality: it imports neither report-integrity nor any neutral
// module nor the band engine, imports from the d1 contracts only the quality card types (so it shares no card type
// with report-integrity, whose own test pins its integrity-only set), and reads no integrity table.
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

describe('rule 1: report-quality stays on its side (static, real files)', () => {
  it('found the module sources', () => {
    expect(Object.keys(production).sort()).toEqual([
      './errors.ts',
      './quality-dto.ts',
      './routes.ts',
    ]);
  });

  it('imports only its own files, the shared packages and npm packages', () => {
    for (const [path, src] of Object.entries(files)) {
      for (const m of src.matchAll(SPECIFIER)) {
        const spec = m[1] ?? '';
        expect(spec, path).not.toMatch(/integrity|band-engine/);
        expect(spec.startsWith('./') || !spec.startsWith('.'), `${path}: ${spec}`).toBe(true);
      }
    }
  });

  it('imports only the quality card types from the d1 contracts (no shared card type)', () => {
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
    expect([...names].sort()).toEqual(['QualityCard', 'QualityCardRow']);
  });

  it('reads no integrity table and no internal schema', () => {
    for (const src of Object.values(production)) {
      expect(src).not.toMatch(/integrity_cards|integrity_timeline_entries|integrity_card_id/);
      expect(src).not.toMatch(/['"`](integrity|quality)\./);
    }
  });
});
