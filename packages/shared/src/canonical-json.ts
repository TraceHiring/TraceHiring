// One canonicalisation for hashes (specs/d1-demo-slice.md §5.1, §5.2): object keys sorted by UTF-16 code unit
// order, no whitespace, arrays in order, primitives as JSON.stringify writes them. Values JSON cannot carry throw.

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
