// specs/reservation-refunds.md rule 39 — money kept on a direct stay stays in the sale: priced as a free
// line, it leaves the trop-perçu at what is still owed back. Second pass of the final review
// (2026-10-19, minor 1): a reduction kept without refund showed a trop-perçu with no way to close it.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

// The stays hang on today: a literal date becomes a stay in the past.
const inDays = (days) => addDaysToIsoDate(todayIso(), days);

test('rule 39 — 465,60 € paid, 6 → 2 adults, breakfasts kept as a free line: only the tax is owed back', () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');

  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 1.2, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  const optionId = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Petit déjeuner', 'per_person_per_night', 8)").run().lastInsertRowid;
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(optionId);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Garde')").run();
  const body = (adults, customOptions = []) => ({
    propertyId: 1, clientId: 1, startDate: inDays(90), endDate: inDays(93),
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    depositDisabled: 1, options: [{ optionId, quantity: 1 }], selectedOptions: [{ optionId, quantity: 1 }], customOptions,
  });

  const created = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: body(6), user: { role: 'admin' } }, created);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = created.body.id;
  recordStayPayment(depsFor(db), { reservationId: id, bucket: 'balance', paidDate: '2026-10-18' });

  assert.equal(controller.performUpdate(id, body(2)).body.overpaymentTtc, 110.4);

  const kept = [{ description: 'Petits déjeuners non remboursables', amount: 96 }];
  const refused = controller.performUpdate(id, body(2, kept));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.overpaymentTtc, 14.4, 'the tax of the 4 absent adults only');
  assert.deepEqual(refused.body.overpaymentLines.map((l) => [l.bucket, l.amountTtc]), [['touristTax', 14.4]]);
});
