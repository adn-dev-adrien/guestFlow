// specs/reservation-save-keeps-pricing.md rule 3 (with specs/direct-installments.md rule 5). Money audit 2026-10-28
// (finding 2): the replay of a stored stay left out half of what the save passes, so an installment plan
// was split over 1000,80 € while the fiche read « Total du séjour 928,80 » and « Total perçu 1000,80 » —
// and removing the plan restamped the solde at the wrong total.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

function seed() {
  const db = require('../database');
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled,
                basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
              VALUES (1, 'Granja', 14, 'per_day_per_person', 1.2, 1, 2, 25, 'per_night')`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  return db;
}

const call = (fn, req) => new Promise((resolve) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; } };
  fn(req, res);
});

test('rule 3 — the replay of a stored stay prices it like its fiche after the catalogue moved: plan, restamp and quote agree', async () => {
  const db = seed();
  const reservations = require('../controllers/reservationsController');
  const installments = require('../controllers/installmentsController');
  const { quoteStoredReservation } = require('../utils/storedReservationQuote');

  const created = await call(reservations.create, { user: { role: 'admin' }, body: {
    propertyId: 1, clientId: 1, startDate: '2099-03-08', endDate: '2099-03-11', checkInTime: '16:00', checkOutTime: '10:00',
    platform: 'direct', adults: 12, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, options: [],
  } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.id;
  const stored = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const total = Math.round((stored.finalPrice + stored.touristTaxTotal) * 100) / 100;

  db.prepare('UPDATE properties SET extraGuestPrice = 40 WHERE id = 1').run();

  const quote = quoteStoredReservation(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(id));
  assert.equal(quote.finalPrice, stored.finalPrice, 'the tariff the stay was sold under is replayed');
  assert.equal(Math.round((quote.finalPrice + quote.touristTaxTotal) * 100) / 100, total);

  const planned = await call(installments.put, { params: { id }, body: { count: 3 } });
  assert.equal(planned.status, 200, JSON.stringify(planned.body));
  const sum = db.prepare('SELECT SUM(amountCents) AS cents FROM reservation_installments WHERE reservationId = ?').get(id).cents;
  assert.equal(sum / 100, total, 'the plan splits the stay total, not today\'s catalogue');

  const removed = await call(installments.remove, { params: { id } });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  const restamped = db.prepare('SELECT depositAmount, balanceAmount FROM reservations WHERE id = ?').get(id);
  assert.equal(Math.round((restamped.depositAmount + restamped.balanceAmount) * 100) / 100, total, 'the buckets go back to the stay total');
});
