export function toCsv(rows, columns) {
  const header = columns.map(escapeCell).join(',');
  const body = rows
    .map((row) => columns.map((col) => escapeCell(row[col])).join(','))
    .join('\r\n');
  return '﻿' + header + '\r\n' + body + '\r\n';
}

function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}
