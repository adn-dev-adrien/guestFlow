// specs/reservation-refunds.md rule 38 — a platform stay has no trop-perçu: its guest paid the platform,
// which refunds them itself, so a paid solde follows the platform amount the operator corrects. Final
// review 2026-10-18 (minor 1): an Abracadaroom stay ticked « payé » at 600 € then corrected to 450 € kept
// a 600 € solde and a 150 € trop-perçu nobody could give back. A direct stay still keeps what it
// collected (rule 36).

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

// The stays hang on today: a literal date becomes a stay in the past.
const inDays = (days) => addDaysToIsoDate(todayIso(), days);

const { overpaymentOf } = require('../utils/overpayment');

test('rule 38 — Abracadaroom 600 € paid, corrected to 450 €: solde 450 €, no trop-perçu', () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  const { recordStayPayment, depsFor } = require('../utils/stayPaymentRecorder');

  db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Tente', 4, 0)").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Lou', 'Plateforme')").run();
  const body = (customPrice) => ({
    propertyId: 1, clientId: 1, startDate: inDays(100), endDate: inDays(103),
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'Abracadaroom',
    adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    depositDisabled: 1, customPrice,
  });

  const created = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: body(600), user: { role: 'admin' } }, created);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = created.body.id;
  assert.equal(db.prepare('SELECT balanceAmount FROM reservations WHERE id = ?').get(id).balanceAmount, 600);
  recordStayPayment(depsFor(db), { reservationId: id, bucket: 'balance', paidDate: '2026-10-18' });

  const saved = controller.performUpdate(id, body(450));
  assert.equal(saved.status, 200, 'no 409 OVERPAID on a platform stay');
  assert.equal(db.prepare('SELECT balanceAmount FROM reservations WHERE id = ?').get(id).balanceAmount, 450);
});

test('rule 38 — overpaymentOf: 0 on a platform row, the excess on a direct one', () => {
  const row = { balancePaid: 1, balanceAmount: 450 };
  const captured = { deposit: null, balance: 600 };
  assert.equal(overpaymentOf({ row: { ...row, platform: 'Abracadaroom' }, captured }), 0);
  assert.equal(overpaymentOf({ row: { ...row, platform: 'direct' }, captured }), 150);
});

test('rule 38 — the engine keeps a direct paid solde, never a platform one', () => {
  const { calculateReservationQuote } = require('../utils/pricing');
  const db = require('../database');
  const quote = (platform) => calculateReservationQuote({
    db, propertyId: 1, startDate: inDays(128), endDate: inDays(131), adults: 2, children: 0, teens: 0, babies: 0,
    platform, depositDisabled: true, customPrice: 450, balancePaid: true, balanceAmount: 600,
  });
  const direct = quote('direct');
  assert.equal(direct.balanceAmount, 600);
  assert.equal(direct.overCollectedTtc, 150);
  const platform = quote('Abracadaroom');
  assert.equal(platform.balanceAmount, 450);
});
