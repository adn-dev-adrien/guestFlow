// specs/reservation-payment-ledger.md rules 16 + 49 (spec review of 2026-10-27, agent 3 F7) — the acompte row of
// the STORED ledger (`GET /api/reservations/:id`) names the ceiling the server enforces: the
// accommodation of the pre-arrival schedule. It read `max: null` without a live quote, while a save above
// the accommodation is refused.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

// The stays hang on today: a literal date becomes a stay in the past.
const inDays = (days) => addDaysToIsoDate(todayIso(), days);

const db = require('../database');
const controller = require('../controllers/reservationsController');

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('rule 16 — the stored acompte row carries max = the accommodation (500 € of a 515 € stay)', () => {
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled, depositPercent)
              VALUES (1, 'Gîte Revue', 4, 'per_day_per_person', 1.5, 1, 30)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Revue')").run();
  const created = fakeRes();
  controller.create({
    body: {
      propertyId: 1, clientId: 1, startDate: inDays(130), endDate: inDays(135), checkInTime: '15:00', checkOutTime: '10:00',
      platform: 'direct', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    },
    user: { role: 'admin' },
  }, created);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = created.body.id;
  const row = db.prepare('SELECT depositAmount, balanceAmount, touristTaxTotal FROM reservations WHERE id = ?').get(id);
  assert.deepEqual([row.depositAmount, row.balanceAmount, row.touristTaxTotal], [150, 365, 15]);

  const res = fakeRes();
  controller.getById({ params: { id: String(id) }, user: { role: 'admin' }, query: {} }, res);
  const deposit = res.body.ledger.rows.find((r) => r.key === 'deposit');
  assert.equal(deposit.amountEdit.mode, 'amount');
  assert.equal(deposit.amountEdit.max, 500);
  assert.match(deposit.amountEdit.help, /^Entre 0 et 500,00/);
});
