// The hand-written RFC 4180 reader (M2-7, R5-20): quotes, escaped quotes, CRLF / LF, a byte order mark, newlines inside
// quotes, and the limits. No dependency. Synthetic text only.
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

const ok = (text: string, max?: number, options?: { skipBlank?: boolean }): string[][] => {
  const result = parseCsv(text, max, options);
  if (!result.ok) throw new Error(`expected a parse, got ${result.reason}`);
  return result.records;
};

describe('parseCsv: RFC 4180 vectors', () => {
  it('reads plain records, with CRLF, LF and a bare CR as record ends', () => {
    expect(ok('a,b,c\r\n1,2,3\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(ok('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(ok('a,b\r1,2\r')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not need a final line break, and a final break does not add an empty record', () => {
    expect(ok('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(ok('a,b\n1,2\n')).toHaveLength(2);
    expect(ok('')).toEqual([]);
  });

  it('keeps empty fields, including trailing ones', () => {
    expect(ok('a,,c,\n,,\n')).toEqual([
      ['a', '', 'c', ''],
      ['', '', ''],
    ]);
  });

  it('reads quoted fields with commas, escaped quotes and line breaks inside', () => {
    expect(ok('"Doe, Jane","say ""hi""","line1\r\nline2"\r\nx,y,z\r\n')).toEqual([
      ['Doe, Jane', 'say "hi"', 'line1\r\nline2'],
      ['x', 'y', 'z'],
    ]);
    expect(ok('""\n""""\n')).toEqual([[''], ['"']]);
  });

  it('strips one leading byte order mark and keeps any other', () => {
    expect(ok('\u{FEFF}a,b\n1,2\n')[0]).toEqual(['a', 'b']);
    expect(ok('\u{FEFF}\u{FEFF}a\n')[0]).toEqual(['\u{FEFF}a']);
  });

  it('keeps Unicode text as it is (E22)', () => {
    expect(ok('नाम,பெயர்\n')).toEqual([['नाम', 'பெயர்']]);
  });

  it('treats a quote inside an unquoted field as a literal character', () => {
    expect(ok('5" pipe,b\n')).toEqual([['5" pipe', 'b']]);
  });

  it('keeps spaces around fields untouched (trimming is the caller’s job)', () => {
    expect(ok(' a , b \n')).toEqual([[' a ', ' b ']]);
  });
});

describe('parseCsv: malformed input and limits', () => {
  it('refuses an unterminated quote', () => {
    expect(parseCsv('a,"b\n1,2\n')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses text after a closing quote', () => {
    expect(parseCsv('"a"b,c\n')).toEqual({ ok: false, reason: 'malformed' });
    expect(parseCsv('"a" ,c\n')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a NUL character', () => {
    expect(parseCsv('a,b\u0000\n')).toEqual({ ok: false, reason: 'malformed' });
  });

  it('stops at the record limit instead of reading on', () => {
    const text = `${Array.from({ length: 11 }, (_, i) => String(i)).join('\n')}\n`;
    expect(ok(text, 11)).toHaveLength(11);
    expect(parseCsv(text, 10)).toEqual({ ok: false, reason: 'too_many_records' });
  });

  it('can skip blank records, which then neither count towards the limit nor come back', () => {
    const text = `a\n\n , \n\nb\n,\nc\n`;
    expect(parseCsv(text, 3, { skipBlank: true })).toEqual({
      ok: true,
      records: [['a'], ['b'], ['c']],
    });
    expect(parseCsv(text, 2, { skipBlank: true })).toEqual({
      ok: false,
      reason: 'too_many_records',
    });
    // A quoted field that holds only spaces is still blank; one with text is not.
    expect(ok('a\n" "\n"x"\n', 5, { skipBlank: true })).toEqual([['a'], ['x']]);
  });

  it('handles a large file quickly and exactly', () => {
    const lines = Array.from({ length: 5001 }, (_, i) => `n${String(i)},"q ""${String(i)}""",x`);
    const records = ok(lines.join('\r\n'));
    expect(records).toHaveLength(5001);
    expect(records[5000]).toEqual(['n5000', 'q "5000"', 'x']);
  });
});
