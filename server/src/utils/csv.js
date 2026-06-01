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
  // French CSV convention (matches Adrien's accountant `Exemple export ventes SOLIO.csv`):
  //   - Whole numbers render bare (`144`, `0`, `17`) — no `,00` tail.
  //   - Fractional numbers render with 2 decimals and a comma (`519,17`).
  //   - Keep `''` for null / undefined / non-finite.
  if (value == null) return '';
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
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

/**
 * @param {Array<string>} headers
 * @param {Array<Array<any>>} rows
 * @param {object} [opts]
 * @param {boolean} [opts.bom=true]  prepend the UTF-8 BOM. Set false when the caller will
 *                                    re-encode the string into a non-UTF-8 buffer (e.g.
 *                                    ISO-8859-1 for French accounting software that doesn't
 *                                    understand BOMs).
 */
function serializeCsv(headers, rows, opts = {}) {
  const { bom = true } = opts;
  const lines = [];
  if (headers && headers.length) {
    lines.push(headers.map(escapeCell).join(SEPARATOR));
  }
  for (const row of rows || []) {
    lines.push(row.map(escapeCell).join(SEPARATOR));
  }
  // Excel wants CRLF on Windows; both work on macOS. Use \r\n for max compatibility.
  const body = lines.join('\r\n') + (lines.length ? '\r\n' : '');
  return bom ? UTF8_BOM + body : body;
}

module.exports = {
  serializeCsv,
  SEPARATOR,
  UTF8_BOM,
  __test: { escapeCell, formatNumber },
};
