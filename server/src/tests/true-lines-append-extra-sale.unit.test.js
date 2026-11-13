// specs/pricing-components.md §3 rules 13, 74 and 85 — selling an article the stay already sells appends a NEW line: its own price (frozen once
// written), source, moment and status; the lines already sold are not touched, whatever their state.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, bath, stayWithTwoSales } = require('./trueLinesFixture');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const lines = (id) => db.prepare('SELECT lineId, optionId, quantity, unitPrice, totalPrice, source, collectAt, soldAt FROM reservation_options WHERE reservationId = ? ORDER BY lineId').all(id);
const sale = (quantity = 2) => [{ articleRef: `option:${bath}`, quantity }];

function singleLineStay(startOffset) {
  const startDate = addDaysToIsoDate(todayIso(), startOffset);
  const endDate = addDaysToIsoDate(startDate, 3);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9301, 9301, ?, ?, 'direct', 2, 300, 340, 'reservation', '15:00', ?)`).run(startDate, endDate, startDate).lastInsertRowid);
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, source) VALUES (?, ?, 1, 40, 1, 'per_stay', 40, 'fiche')").run(id, bath);
  return id;
}

test('rules 13, 85 — a second sale of an article is a second line: the first one is untouched, the new one carries its source, moment and status', () => {
  const id = singleLineStay(20);
  const before = lines(id)[0];
  const result = extraSale.sell(id, sale(2), { source: 'fiche' });
  assert.equal(result.status, 200);
  const after = lines(id);
  assert.equal(after.length, 2, 'two lines for one article');
  assert.deepEqual(after[0], before, 'the first line is exactly what it was');
  assert.deepEqual([after[1].quantity, after[1].unitPrice, after[1].totalPrice, after[1].source, after[1].collectAt], [2, 40, 80, 'fiche', 'arrival']);
  assert.ok(after[1].soldAt);
  const sold = result.saleDetail.lines.filter((l) => l.label === 'Bain nordique');
  assert.deepEqual(sold.map((l) => [l.quantity, l.totalCents, l.status]), [[1, 4000, 'inPlan'], [2, 8000, 'dueAtArrival']]);
  assert.deepEqual(sold.map((l) => l.key), ['opt:' + bath, `line:reservation_options:${after[1].lineId}`], 'the first line keeps the legacy key, the later one is named by its line');
});

test('rules 74, 85 — each sale freezes its own price: a catalogue price moved between two sales moves neither line', () => {
  const id = singleLineStay(21);
  db.prepare('UPDATE options SET price = 42 WHERE id = ?').run(bath);
  try {
    assert.equal(extraSale.sell(id, sale(1), { source: 'fiche' }).status, 200);
    db.prepare('UPDATE options SET price = 45 WHERE id = ?').run(bath);
    assert.equal(extraSale.sell(id, sale(1), { source: 'shop' }).status, 200);
  } finally {
    db.prepare('UPDATE options SET price = 40 WHERE id = ?').run(bath);
  }
  assert.deepEqual(lines(id).map((l) => [l.unitPrice, l.totalPrice, l.source]), [[40, 40, 'fiche'], [42, 42, 'fiche'], [45, 45, 'shop']]);
});

test('rule 85 — a quote writes nothing, not even a line number it would use', () => {
  const id = singleLineStay(22);
  const sequence = () => db.prepare("SELECT last FROM line_id_sequence WHERE tbl = 'reservation_options'").get().last;
  const before = [lines(id), sequence()];
  const quoted = extraSale.quote(id, sale(2));
  assert.equal(quoted.status, 200);
  assert.deepEqual([quoted.lines[0].merged, quoted.lines[0].totalCents], [false, 8000]);
  assert.deepEqual([lines(id), sequence()], before);
});

test('rule 85 — a stay already holding two lines of the article takes a third; an accepted price that moved is refused and nothing is written', () => {
  const id = stayWithTwoSales({ startOffset: 23 });
  const refused = extraSale.sell(id, sale(1), { acceptedTotalCents: 1 });
  assert.equal(refused.body.code, 'PRICE_CHANGED');
  assert.equal(lines(id).length, 3);
  assert.equal(extraSale.sell(id, sale(1), { source: 'sas' }).status, 200);
  const after = lines(id).filter((l) => l.optionId === bath);
  assert.deepEqual(after.map((l) => [l.quantity, l.totalPrice]), [[1, 40], [2, 90], [1, 40]]);
});

test('rules 13, 29 — a started stay routes the new line to the departure and a card sale settles that line alone', (t) => {
  const at = new Date(`${todayIso()}T17:00:00+01:00`);
  t.mock.timers.enable({ apis: ['Date'], now: at.getTime() });
  const id = singleLineStay(0);
  const result = extraSale.sell(id, sale(1), { source: 'fiche', payment: 'cash', now: at });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const detail = result.saleDetail.lines.filter((l) => l.label === 'Bain nordique');
  assert.equal(detail.length, 2);
  const [first, second] = detail;
  assert.deepEqual([first.settledCents, second.settledCents, second.status, second.collectAt], [0, 4000, 'paid', 'departure'], 'only the new line is paid');
  assert.equal(result.saleDetail.buckets.departure, 0);
});

test('rules 13, 85 — selling again on a started stay after the first line was paid leaves the paid line paid', (t) => {
  const at = new Date(`${todayIso()}T17:00:00+01:00`);
  t.mock.timers.enable({ apis: ['Date'], now: at.getTime() });
  const id = singleLineStay(0);
  assert.equal(extraSale.sell(id, sale(1), { source: 'sas', payment: 'cash', now: at }).status, 200);
  const again = extraSale.sell(id, sale(2), { source: 'fiche', now: at });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const detail = again.saleDetail.lines.filter((l) => l.label === 'Bain nordique');
  assert.deepEqual(detail.map((l) => [l.quantity, l.status, l.settledCents]), [[1, 'inPlan', 0], [1, 'paid', 4000], [2, 'dueAtDeparture', 0]]);
  assert.equal(again.saleDetail.buckets.departure, 8000);
});
