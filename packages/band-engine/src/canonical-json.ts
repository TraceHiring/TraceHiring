// Canonical JSON (specs/d1-demo-slice.md §5.2): object keys sorted by UTF-16 code unit order, no whitespace, arrays in
// order, primitives as JSON.stringify writes them. The engine's own copy of packages/shared/src/canonical-json.ts (the
// engine imports nothing); canonical-json.test.ts pins both to the same vectors. The integrity job hashes this text
// (SHA-256) into integrity.results.input_hash.

/** Canonical JSON text of `value`. Throws on undefined, functions, symbols, bigints and non-finite numbers. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      const record = value as Record<string, unknown>;
      const parts = Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
      return `{${parts.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: cannot serialise ${typeof value}`);
  }
}
