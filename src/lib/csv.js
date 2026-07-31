// Europäisches CSV-Format: Semikolon als Feldtrenner, Komma als
// Dezimaltrennzeichen (nur für Spalten, die als numerisch markiert sind).
const SEP = ';';
const NEEDS_QUOTE = /[";\r\n]/;

export function toCsv(rows, columns, numericColumns = new Set()) {
  const header = columns.map(escapeCell).join(SEP);
  const body = rows
    .map((row) => columns
      .map((col) => renderCell(row[col], numericColumns.has(col)))
      .join(SEP))
    .join('\r\n');
  return '﻿' + header + '\r\n' + body + '\r\n';
}

function renderCell(value, isNumeric) {
  if (value == null) return '';
  if (isNumeric && typeof value === 'number') {
    return String(value).replace('.', ',');
  }
  return escapeCell(value);
}

function escapeCell(value) {
  if (value == null) return '';
  const str = String(value);
  if (NEEDS_QUOTE.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
