import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('splits rows and fields', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quotes, embedded commas, escaped quotes and newlines in fields', () => {
    expect(parseCsv('"2026-03-24, 22:15:00","say ""hi""","line1\nline2"')).toEqual([
      ['2026-03-24, 22:15:00', 'say "hi"', 'line1\nline2'],
    ]);
  });

  it('handles CRLF, a BOM, empty fields and a missing final newline', () => {
    expect(parseCsv('﻿a,,c\r\n,2,\r\nx')).toEqual([['a', '', 'c'], ['', '2', ''], ['x']]);
  });

  it('skips completely empty lines', () => {
    expect(parseCsv('a\n\n\nb\n')).toEqual([['a'], ['b']]);
  });

  it('supports other delimiters', () => {
    expect(parseCsv('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
