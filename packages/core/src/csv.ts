/**
 * Minimal RFC 4180 CSV parser: quoted fields, "" escapes, embedded delimiters and
 * newlines, CRLF/LF, a leading BOM. Completely empty lines are skipped.
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = () => {
    row.push(field);
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
    field = '';
  };

  for (; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

export type CsvCell = string | number | null | undefined;

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Formula injection guard: text starting with = + - @ (and not a plain number) is prefixed with '.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV with CRLF line endings, safe to open in a spreadsheet. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + (rows.length ? '\r\n' : '');
}
