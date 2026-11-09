// specs/mixed-method-payments.md rules 1, 10-11, 32 — « Plusieurs moyens » at the check-out SAS: the day's cleaning,
// 122 € = 50 € cash in the caisse + 72 € card, recorded on a real (in-memory) database.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
require('../../sdk/registry').configure({ isActive: () => true, allows: () => true });
const sas = require('../controller');
const settlements = require('../../../models/paymentSettlementsModel');
const { getTodayIsoDate } = require('../../../utils/reservationHelpers');

const TODAY = getTodayIsoDate();
db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

function leavingToday() {
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      balanceAmount, balancePaid, balancePaidDate, endOfStayComplementAmount, endOfStayComplementDetail, checkInDone, arrivalSasDoneAt)
    VALUES (1, 1, date(?, '-4 day'), ?, 'direct', 2, 500, 500, 1, date(?, '-10 day'), 122, ?, 1, date(?, '-4 day'))`)
    .run(TODAY, TODAY, TODAY, JSON.stringify([{ key: 'custom:menage', label: 'Ménage', amount: 122 }]), TODAY).lastInsertRowid);
}

const commit = (id, body, user = { role: 'admin' }) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  sas.commitDeparture({ params: { id: String(id) }, body: { complementsSettled: true, displayedDepartureTotal: 122, ...body }, user }, res);
  return res;
};
const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });
const card = (amountCents) => ({ method: 'card', amountCents });

test('rules 10-11 — the check-out records the cleaning as paid with its two lines', () => {
  const id = leavingToday();
  const res = commit(id, { complementsTenders: [cashIn(5000), card(7200)] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.warning, null);
  const r = row(id);
  assert.equal(r.endOfStayComplementPaid, 1);
  assert.equal(r.endOfStayComplementPaidCash, 0);
  assert.equal(r.splitOffBooksAmount, 50);
  const [s] = settlements.listFor(id);
  assert.deepEqual(s.tenders.map((t) => [t.method, t.amountCents, t.internal]), [['cash', 5000, 1], ['card', 7200, 0]]);
});

test('rule 11 — every line in the caisse: « payé en liquide », as before', () => {
  const id = leavingToday();
  assert.equal(commit(id, { complementsTenders: [cashIn(12200)] }).statusCode, 200);
  assert.equal(row(id).endOfStayComplementPaidCash, 1);
});

test('rule 6 — lines over the recap\'s total write nothing', () => {
  const id = leavingToday();
  const res = commit(id, { complementsTenders: [cashIn(5000), card(8000)] });
  assert.equal(res.statusCode, 400);
  assert.equal(row(id).endOfStayComplementPaid, 0);
  assert.equal(settlements.listFor(id).length, 0);
});

test('rule 16 — a reste à percevoir leaves the stay to collect', () => {
  const id = leavingToday();
  const res = commit(id, { complementsTenders: [cashIn(5000), card(6400)], complementsShortfall: { kind: 'due' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(row(id).splitShortfallDue, 8);
});

test('rule 1 — lines without « compléments encaissés » are refused', () => {
  const id = leavingToday();
  assert.equal(commit(id, { complementsSettled: false, complementsTenders: [card(12200)] }).statusCode, 400);
});
