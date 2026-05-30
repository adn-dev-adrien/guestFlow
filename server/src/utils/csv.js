/**
 * Pure CSV serializer tuned for French Excel — `;` separator, UTF-8 BOM, comma decimals when the cell
 * is a Number. Strings carrying `;`, `"`, `\n` or `\r` are quoted with `""` escaping. All inputs are
 * coerced to strings before joining, so callers can pass numbers, booleans, etc. directly.
 *
 * Usage:
 *   serializeCsv(['Jour','Mois','Année','Compte','Libellé','Débit','Crédit'], rows)
 */

const SEPARATOR = ';';
const UTF8_BOM = '﻿';

function formatNumber(value) {
  // Two-decimal fixed for money cells. Comma decimal (French). Keep '' for null/undefined.
  if (value == null) return '';
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return '';
  return value.toFixed(2).replace('.', ',');
}

function escapeCell(value) {
  if (value == null) return '';
  if (typeof value === 'number') return formatNumber(value);
  const str = String(value);
  if (/[;"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function serializeCsv(headers, rows) {
  const lines = [];
  if (headers && headers.length) {
    lines.push(headers.map(escapeCell).join(SEPARATOR));
  }
  for (const row of rows || []) {
    lines.push(row.map(escapeCell).join(SEPARATOR));
  }
  // Excel wants CRLF on Windows; both work on macOS. Use \r\n for max compatibility.
  return UTF8_BOM + lines.join('\r\n') + (lines.length ? '\r\n' : '');
}

module.exports = {
  serializeCsv,
  SEPARATOR,
  UTF8_BOM,
  __test: { escapeCell, formatNumber },
};
