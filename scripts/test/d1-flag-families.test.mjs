// The e2e allow-list D1_FLAG_FAMILIES (e2e/support/report.ts) is an independent copy of the d1-v1 rule table's
// families (e2e may import no other element, packages/config/eslint/boundaries.js). This pins the copy to
// packages/band-engine/src/rules/d1-v1.json so a family change updates both (D1 review carried item, D1 FIX).
// Read as text only: no import crosses the e2e boundary.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

/** The string elements of `export const <name>: readonly string[] = [...]` in a TS source, or null. */
export function literalList(source, name) {
  const m = new RegExp(`export const ${name}: readonly string\\[\\] = \\[([^\\]]*)\\];`).exec(
    source,
  );
  if (m === null) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

describe('D1_FLAG_FAMILIES (e2e) equals the d1-v1 rule table families', () => {
  it('lists exactly the families of packages/band-engine/src/rules/d1-v1.json, in order', () => {
    const table = JSON.parse(read('packages/band-engine/src/rules/d1-v1.json'));
    const copy = literalList(read('e2e/support/report.ts'), 'D1_FLAG_FAMILIES');
    expect(copy).not.toBeNull();
    expect(copy).toEqual(table.families);
  });

  it('literalList reads the literal and detects drift', () => {
    const src = "export const D1_FLAG_FAMILIES: readonly string[] = ['paste', 'gaze'];";
    expect(literalList(src, 'D1_FLAG_FAMILIES')).toEqual(['paste', 'gaze']);
    expect(literalList(src, 'OTHER')).toBeNull();
    expect(literalList(src, 'D1_FLAG_FAMILIES')).not.toEqual(['paste', 'input_origin', 'focus']);
  });
});
