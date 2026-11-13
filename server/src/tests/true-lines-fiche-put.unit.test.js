// specs/pricing-components.md §3 rule 85 (the fiche PUT contract) — a posted line that names its `lineId` updates THAT row and never merges
// with another line of the article; a posted line without a name is the article's first line; a line the save appends (`newLine`) is a new
// row; a client that posts fewer lines deletes only the lines it dropped. Same for the resource lines (and rule 13: one row per sale).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, bath, stayWithTwoSales, rowsOf,
} = require('./trueLinesFixture');
const controller = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const bathRows = (id) => rowsOf(id).filter((r) => r.optionId === bath);
// The two bath lines of a stay (the line numbers are global to the database).
const twoLines = (id) => bathRows(id).map((r) => r.lineId);
const put = (id, body) => {
  const result = controller.performUpdate(id, body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
};

test('rule 85 — the stored body names every line: lineId and its own offered flag', () => {
  const id = stayWithTwoSales({ startOffset: 25 });
  const [a, b] = twoLines(id);
  const body = storedBody(id);
  assert.deepEqual(body.options.filter((o) => o.optionId === bath).map((o) => [o.lineId, o.offered, o.quantity]), [[a, false, 1], [b, false, 2]]);
});

test('rule 85 — a posted line that names its lineId updates that row only: two lines are never merged, even at one price', () => {
  const id = stayWithTwoSales({ startOffset: 26 });
  const [a, b] = twoLines(id);
  const body = storedBody(id);
  body.options = body.options.map((o) => (o.lineId === b ? { ...o, quantity: 3 } : o));
  put(id, body);
  assert.deepEqual(bathRows(id).map((r) => [r.lineId, r.quantity]), [[a, 1], [b, 3]]);
  const same = storedBody(id);
  same.options = same.options.map((o) => (o.lineId === b ? { ...o, quantity: 1 } : o));
  put(id, same);
  assert.deepEqual(bathRows(id).map((r) => [r.lineId, r.quantity]), [[a, 1], [b, 1]], 'two lines of one quantity stay two lines');
});

test('rule 85 — a client that sends fewer lines deletes only the lines it dropped', () => {
  const id = stayWithTwoSales({ startOffset: 27 });
  const [a, b] = twoLines(id);
  db.prepare("UPDATE reservation_options SET source = 'shop', collectAt = 'departure' WHERE lineId = ?").run(b);
  const body = storedBody(id);
  body.options = body.options.filter((o) => o.lineId !== a);
  put(id, body);
  assert.deepEqual(twoLines(id), [b], 'the dropped line is gone, the other one kept its number');
  assert.equal(db.prepare('SELECT source FROM reservation_options WHERE lineId = ?').get(b).source, 'shop', 'and every column the save does not write');
});

test('rule 85 — a posted line without a lineId is the first line of its article; a line the save appends (newLine) is a new row with the number it was priced under', () => {
  const id = stayWithTwoSales({ startOffset: 28 });
  const [a, b] = twoLines(id);
  const body = storedBody(id);
  body.options = body.options.map((o) => (o.lineId === a ? { optionId: o.optionId, quantity: 1 } : o));
  put(id, body);
  assert.deepEqual(twoLines(id), [a, b], 'an unnamed line takes the first stored line that no other posted line names');
  const appended = storedBody(id);
  appended.options.push({ optionId: bath, quantity: 4, newLine: true });
  put(id, appended);
  const rows = bathRows(id);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.quantity), [1, 2, 4]);
  assert.ok(rows[2].lineId > b, 'a number that was never given before');
});

test('rule 85 — a line the save appends takes no column of a stored line, and the stored lines keep theirs', () => {
  const id = stayWithTwoSales({ startOffset: 29 });
  const [a] = twoLines(id);
  db.prepare("UPDATE reservation_options SET source = 'shop', collectAt = 'arrival', soldAt = '2030-01-01' WHERE lineId = ?").run(a);
  const body = storedBody(id);
  body.options.push({ optionId: bath, quantity: 1, newLine: true });
  put(id, body);
  const [first, , added] = db.prepare('SELECT lineId, source, collectAt, soldAt FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, bath);
  assert.deepEqual([first.source, first.collectAt, first.soldAt], ['shop', 'arrival', '2030-01-01']);
  assert.deepEqual([added.collectAt, added.soldAt], [null, null], 'nothing of the first line’s sale columns');
});

test('rule 85 — offering one line leaves the other billed (the line’s own flag wins over the article’s)', () => {
  const id = stayWithTwoSales({ startOffset: 30 });
  const [a, b] = twoLines(id);
  const body = storedBody(id);
  body.options = body.options.map((o) => (o.lineId === b ? { ...o, offered: true } : o));
  body.offeredOptionIds = [bath];
  put(id, body);
  assert.deepEqual(db.prepare('SELECT lineId, offered FROM reservation_options WHERE optionId = ? AND reservationId = ? ORDER BY lineId').all(bath, id).map((r) => [r.lineId, r.offered]), [[a, 0], [b, 1]]);
});
