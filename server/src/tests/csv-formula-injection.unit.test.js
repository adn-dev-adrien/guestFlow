/**
 * CSV formula-injection neutralisation — 2026-10-08 infrastructure audit, finding DATA-3.
 * Guest-controlled names reach the accountant export; a cell a spreadsheet evaluates as a formula
 * must be rendered as text instead.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { serializeCsv, __test } = require('../utils/csv');
const { escapeCell } = __test;

test('escapeCell neutralises every spreadsheet formula lead with a leading apostrophe', () => {
  assert.equal(escapeCell('=1+1'), "'=1+1");
  // Contains a double quote → prefixed with ' AND wrapped, with "" escaping.
  assert.equal(escapeCell('=HYPERLINK("http://evil")'), '"\'=HYPERLINK(""http://evil"")"');
  assert.equal(escapeCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(escapeCell('+1'), "'+1");
  assert.equal(escapeCell('-cmd'), "'-cmd");
  assert.equal(escapeCell('\tTAB'), "'\tTAB");
  assert.equal(escapeCell('\rCR'), '"\'\rCR"'); // CR also triggers quoting
});

test('a formula cell that also contains a separator is both prefixed and quoted', () => {
  // =cmd|'/C calc'!A0 has no separator; use one that does to prove the two layers compose.
  assert.equal(escapeCell('=A1;B1'), '"\'=A1;B1"');
});

test('legitimate values are untouched', () => {
  assert.equal(escapeCell('Jean Dupont'), 'Jean Dupont');
  assert.equal(escapeCell('Chambre 12'), 'Chambre 12');
  // Numbers never reach the formula guard — a real negative amount stays a bare number.
  assert.equal(escapeCell(-5), '-5');
  assert.equal(escapeCell(519.17), '519,17');
  assert.equal(escapeCell(144), '144');
  assert.equal(escapeCell(0), '0');
  assert.equal(escapeCell(null), '');
});

test('serializeCsv neutralises a malicious guest name in a full row', () => {
  const out = serializeCsv(
    ['Libellé', 'Débit'],
    [['=cmd|\'/C calc\'!A0', 120]],
    { bom: false },
  );
  const dataLine = out.trim().split('\r\n')[1];
  assert.ok(dataLine.startsWith("'=cmd"), `expected the cell neutralised, got: ${dataLine}`);
  assert.ok(dataLine.endsWith(';120'));
});
