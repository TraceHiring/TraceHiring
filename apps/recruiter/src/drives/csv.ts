// A small RFC 4180 reader for the invite file (specs/m2-scheduling-invites.md M2-7, R5-20). Hand-written so that no
// dependency is added: quoted fields (commas, line breaks and doubled quotes inside), CRLF, LF or a bare CR between
// records, one leading byte order mark. Text it cannot read is refused, never guessed at. It keeps nothing: the caller
// owns the records, and nothing here logs or stores a value.

export type CsvResult =
  { ok: true; records: string[][] } | { ok: false; reason: 'malformed' | 'too_many_records' };

const BOM = String.fromCodePoint(0xfeff);

/**
 * Splits `input` into records of fields. A final line break does not add an empty record; a blank line inside the text
 * is a record with one empty field (the caller decides to skip it). More than `maxRecords` records stop the read.
 */
export function parseCsv(input: string, maxRecords = Number.POSITIVE_INFINITY): CsvResult {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  if (text.includes('\u0000')) return { ok: false, reason: 'malformed' };
  const n = text.length;
  const records: string[][] = [];
  let record: string[] = [];
  let i = 0;

  while (i < n) {
    let field = '';
    if (text[i] === '"') {
      i += 1;
      let closed = false;
      while (i < n) {
        const quote = text.indexOf('"', i);
        if (quote === -1) break;
        field += text.slice(i, quote);
        if (text[quote + 1] === '"') {
          field += '"';
          i = quote + 2;
          continue;
        }
        i = quote + 1;
        closed = true;
        break;
      }
      if (!closed) return { ok: false, reason: 'malformed' };
      const after = text[i];
      if (i < n && after !== ',' && after !== '\n' && after !== '\r') {
        return { ok: false, reason: 'malformed' };
      }
    } else {
      const start = i;
      while (i < n) {
        const ch = text[i];
        if (ch === ',' || ch === '\n' || ch === '\r') break;
        i += 1;
      }
      field = text.slice(start, i);
    }
    record.push(field);

    if (i >= n) break;
    if (text[i] === ',') {
      i += 1;
      if (i >= n) record.push('');
      else continue;
    } else if (text[i] === '\r' && text[i + 1] === '\n') {
      i += 2;
    } else {
      i += 1;
    }
    records.push(record);
    record = [];
    if (records.length > maxRecords) return { ok: false, reason: 'too_many_records' };
  }
  if (record.length > 0) {
    records.push(record);
    if (records.length > maxRecords) return { ok: false, reason: 'too_many_records' };
  }
  return { ok: true, records };
}
