// specs/single-vat-rate.md rule 14 — the single rate is the rate of the period in force, and rule 12's
// retroactivity holds inside a period only: editing the rate re-rates the reservations of that period,
// never those of an earlier one. With a single period nothing moves.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const vatRegimeModel = require('../models/vatRegimeModel');

const quote = (id) => calculateReservationQuote(buildReservationEngineInput(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(id)));

test('rule 14: with a single period, editing the rate re-rates every reservation (rule 12 intact)', () => {
  const before = quote(104);
  vatRegimeModel.setRateInForce(db, 20);
  const after = quote(104);
  assert.equal(before.vatPercentageAccommodation, 10);
  assert.equal(after.vatPercentageAccommodation, 20);
  assert.equal(after.finalPrice, before.finalPrice, 'the VAT is extracted, no price moves');
  vatRegimeModel.setRateInForce(db, 10);
  assert.deepEqual(quote(104).totalVatAmount, before.totalVatAmount);
});

test('rule 14: the retroactivity stops at the period: an earlier period keeps its own rate', () => {
  db.prepare("INSERT INTO vat_periods (regime, rate, basis, effectiveFrom) VALUES ('subject', 10, 'arrival', '2027-08-01')").run();
  db.prepare("UPDATE reservations SET vatPeriodId = 2 WHERE startDate >= '2027-08-01' AND kind != 'devis'").run();
  vatRegimeModel.setRateInForce(db, 20);
  assert.equal(quote(101).vatPercentageAccommodation, 10);
  assert.equal(quote(104).vatPercentageAccommodation, 20);
  assert.equal(db.prepare('SELECT rate FROM vat_periods WHERE id = 1').get().rate, 10);
});
