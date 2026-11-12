// specs/pricing-components.md §3 rules 19, 21, 29, 74 — a sale collected at once (cash, terminal, card) is written, then settled as one
// mid-stay note naming its lines: the line reads « Payée », the allocations follow, the departure complement owes nothing for it.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9211, 'Caisse', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9211, 'Camille', 'Caisse')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9211, 'Standard', 100)").run();
const optionId = (title, price) => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES (?, ?, 'per_stay')").run(title, price).lastInsertRowid);
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9211, ?)').run(id);
  return id;
};
const bath = optionId('Bain nordique', 40);

// The arrival day, 17:00 Paris: the check-in hour (15:00) has passed, the stay has started (rule 20). `startOffset` > 0 is a later arrival.
const at = (hour) => new Date(`${todayIso()}T${hour}:00+01:00`);
function stay(startOffset) {
  const startDate = addDaysToIsoDate(todayIso(), Math.max(0, startOffset));
  const endDate = addDaysToIsoDate(startDate, 3);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9211, 9211, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00', ?)`).run(startDate, endDate, startDate).lastInsertRowid);
}
test.beforeEach((t) => { t.mock.timers.enable({ apis: ['Date'], now: at('17:00').getTime() }); });
const request = [{ articleRef: `option:${bath}`, quantity: 1 }];

test('rule 29 — a cash sale on a started stay is written paid: the line is « Payée », the note is off the books, the departure owes nothing', () => {
  const id = stay(0);
  const result = extraSale.sell(id, request, { source: 'sas', payment: 'cash', now: at('17:00') });
  assert.equal(result.status, 200);
  const line = result.saleDetail.lines.find((l) => l.label === 'Bain nordique');
  assert.deepEqual([line.status, line.settledCents, line.totalCents, line.source], ['paid', 4000, 4000, 'sas']);
  assert.equal(result.saleDetail.buckets.departure, 0);
  const note = JSON.parse(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id).midStaySettledNotes)[0];
  assert.deepEqual([note.paidCash, note.method, note.source, note.total], [1, 'cash', 'sas', 40]);
  const rows = db.prepare("SELECT amountCents, books FROM payment_allocations WHERE documentRef = ? AND kind = 'payment' AND lineRef LIKE 'line:reservation_options:%'").all(`reservation:${id}`);
  assert.deepEqual(rows.map((r) => [r.amountCents, r.books]), [[4000, 0]]);
});

test('rule 29 — a terminal sale and a card sale are on the books', () => {
  for (const payment of ['card-terminal', 'card']) {
    const id = stay(0);
    const result = extraSale.sell(id, request, { source: 'fiche', payment, now: at('17:00') });
    assert.equal(result.status, 200, payment);
    assert.equal(result.saleDetail.lines.find((l) => l.label === 'Bain nordique').status, 'paid');
    const note = JSON.parse(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(id).midStaySettledNotes)[0];
    assert.deepEqual([note.paidCash, note.method], [0, payment]);
    assert.deepEqual(db.prepare("SELECT books FROM payment_allocations WHERE documentRef = ? AND kind = 'payment' AND lineRef LIKE 'line:reservation_options:%'").all(`reservation:${id}`).map((r) => r.books), [1]);
  }
});

test('rule 19 — before the arrival the payment is the SAS\'s: 409 PAYMENT_BEFORE_ARRIVAL, nothing written', () => {
  const id = stay(10);
  const result = extraSale.sell(id, request, { payment: 'cash', now: at('17:00') });
  assert.equal(result.body.code, 'PAYMENT_BEFORE_ARRIVAL');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
});

test('rule 19 — a stay whose departure complement is collected refuses the sale paid now (« Séjour soldé »)', () => {
  const id = stay(0);
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1 WHERE id = ?').run(id);
  const result = extraSale.sell(id, request, { payment: 'card-terminal', now: at('17:00') });
  assert.equal(result.body.code, 'STAY_SETTLED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
});

test('rule 30 — the quote accepts a payment mode and writes nothing', () => {
  const id = stay(0);
  assert.equal(extraSale.quote(id, request, { payment: 'cash', now: at('17:00') }).totalCents, 4000);
  assert.equal(extraSale.quote(id, request, { payment: 'barter' }).body.code, 'PAYMENT_MODE_UNSUPPORTED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
});
