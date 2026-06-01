const test = require('node:test');
const assert = require('node:assert/strict');

const { serializeCsv, SEPARATOR, UTF8_BOM, __test } = require('../utils/csv');
const { escapeCell, formatNumber } = __test;

// French-Excel CSV: `;` separator, UTF-8 BOM, comma decimals on numbers, `""` escaping for strings
// carrying special characters.

test('serializeCsv starts with the UTF-8 BOM', () => {
  const out = serializeCsv(['a', 'b'], [['x', 'y']]);
  assert.ok(out.startsWith(UTF8_BOM));
});

test('rows are separated by CRLF; cells by ";"', () => {
  const out = serializeCsv(['a', 'b'], [['1', '2'], ['3', '4']]);
  const body = out.slice(UTF8_BOM.length).replace(/\r\n$/, '');
  assert.equal(body, 'a;b\r\n1;2\r\n3;4');
  assert.equal(SEPARATOR, ';');
});

test('numbers: integers render bare, non-integers use comma decimal at 2 places', () => {
  // French accountant CSV convention (Adrien's `Exemple export ventes SOLIO.csv`):
  // whole numbers like `144` or `0` carry no `,00` tail; only fractional values do.
  assert.equal(formatNumber(12.3), '12,30');
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(144), '144');
  assert.equal(formatNumber(-1.234), '-1,23');
  assert.equal(formatNumber(519.17), '519,17');
});

test('null / undefined / empty string render as empty cells', () => {
  assert.equal(escapeCell(null), '');
  assert.equal(escapeCell(undefined), '');
  assert.equal(escapeCell(''), '');
});

test('cells with separator, quote, or newline are double-quoted and escaped', () => {
  assert.equal(escapeCell('a;b'), '"a;b"');
  assert.equal(escapeCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCell('line\nbreak'), '"line\nbreak"');
});

test('empty input → just the BOM (no body)', () => {
  const out = serializeCsv([], []);
  assert.equal(out, UTF8_BOM);
});
