// specs/pricing-components.md §3 rule 85 (line key scheme) — the resolver of utils/pricing/lineKeys.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lineRef, parseLineRef, keyLines, lineIdentityOf, resolveLineKey, articleKeyOf } = require('../utils/pricing/lineKeys');
const { extraLineKey } = require('../utils/pricing/storedLines');

const O = 'reservation_options';
const R = 'reservation_resources';
const rows = [
  { table: O, lineId: 30, optionId: 5 },
  { table: O, lineId: 12, optionId: 5 },
  { table: O, lineId: 20, optionId: 7 },
  { table: R, lineId: 40, resourceId: 5 },
];

test('rule 85 — a line ref names ONE stored line and parses back', () => {
  assert.equal(lineRef(O, 12), 'line:reservation_options:12');
  assert.deepEqual(parseLineRef('line:reservation_resources:40'), { table: R, lineId: 40 });
  assert.equal(parseLineRef('opt:5'), null);
  assert.equal(parseLineRef(null), null);
});

test('rule 85 — the FIRST line of an article (lowest lineId) keeps the legacy key, every later one is named by its ref', () => {
  const keyed = keyLines(O, rows.filter((r) => r.table === O));
  assert.deepEqual(keyed.map((e) => [e.row.lineId, e.key, e.first]), [
    [30, 'line:reservation_options:30', false], [12, 'opt:5', true], [20, 'opt:7', true],
  ]);
});

test('rule 85 — a stay with one row per article is keyed exactly as before (0 diff)', () => {
  const keyed = keyLines(O, [{ lineId: 1, optionId: 3 }, { lineId: 2, optionId: 4 }]);
  assert.deepEqual(keyed.map((e) => e.key), ['opt:3', 'opt:4']);
  assert.deepEqual(keyLines(R, [{ resourceId: 9 }]).map((e) => e.key), ['res:9']);
});

test('rule 85 — the identity an engine line carries is empty for a first line and lineId + lineKey for a later one', () => {
  const options = rows.filter((r) => r.table === O);
  assert.deepEqual(lineIdentityOf(O, options[1], options), {});
  assert.deepEqual(lineIdentityOf(O, options[0], options), { lineId: 30, lineKey: 'line:reservation_options:30' });
});

test('rule 85 — extraLineKey reads the line key of a later sale, and the legacy key of anything else', () => {
  assert.equal(extraLineKey({ optionId: 5, lineKey: 'line:reservation_options:30' }), 'line:reservation_options:30');
  assert.equal(extraLineKey({ optionId: 5 }), 'opt:5');
});

test('rule 85 — resolveLineKey: legacy → the first line, a line ref → itself, an unknown article or ref → null', () => {
  assert.equal(resolveLineKey(rows, 'opt:5'), 'line:reservation_options:12');
  assert.equal(resolveLineKey(rows, 'res:5'), 'line:reservation_resources:40');
  assert.equal(resolveLineKey(rows, 'line:reservation_options:30'), 'line:reservation_options:30');
  assert.equal(resolveLineKey(rows, 'opt:99'), null);
  assert.equal(resolveLineKey(rows, 'line:reservation_options:999'), null);
  assert.equal(resolveLineKey(rows, 'custom:ménage'), null);
});

test('rule 85 — articleKeyOf is the reverse used by the readers that aggregate per article', () => {
  assert.equal(articleKeyOf(rows, 'line:reservation_options:30'), 'opt:5');
  assert.equal(articleKeyOf(rows, 'opt:5'), 'opt:5');
  assert.equal(articleKeyOf(rows, 'line:reservation_options:999'), null);
});
