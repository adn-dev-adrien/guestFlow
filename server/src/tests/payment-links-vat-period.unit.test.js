// specs/payment-links-vat.md rule 11 — the basket rate is the reservation's period rate; a devis not
// converted takes the regime in force; a link already open keeps the basket it was created with.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
db.prepare("INSERT INTO vat_periods (regime, rate, basis, effectiveFrom) VALUES ('subject', 20, 'arrival', '2027-08-01')").run();
db.prepare("UPDATE reservations SET vatPeriodId = 2 WHERE startDate >= '2027-08-01' AND kind != 'devis'").run();

const payments = require('../controllers/paymentsController').__test;
const devisQuote = require('../utils/devisQuote');
const devisModel = require('../models/devisModel');
const { calculateReservationQuote } = require('../utils/pricing');
const { buildVatItems } = require('../utils/paymentLinkItems');

test('rule 11: the stay part of a basket goes at the rate of the reservation, the tourist tax at 0 %', () => {
  const old = buildVatItems(payments.storedReservationComponents(101, 'balance'));
  const next = buildVatItems(payments.storedReservationComponents(104, 'balance'));
  assert.deepEqual(old.items.filter((i) => i.title.startsWith('Solde')).map((i) => i.vatRate), [10]);
  assert.deepEqual(next.items.filter((i) => i.title.startsWith('Solde')).map((i) => i.vatRate), [20]);
  assert.ok(next.items.filter((i) => i.title === 'Taxe de séjour').every((i) => i.vatRate === 0));
});

test('rule 11: the charged total does not move with the rate, to the cent', () => {
  const total = (basket) => buildVatItems(basket).expectedTotalCents;
  const basket = payments.storedReservationComponents(104, 'balance');
  assert.equal(total(basket), basket.components.reduce((s, c) => s + c.grossCents, 0));
  assert.equal(total({ ...basket, vatRatePercent: 10 }), total(basket));
});

test('rule 11: a devis not converted is quoted under the regime in force for its arrival', () => {
  const basket = devisQuote.fullPaymentComponents({ database: db, devisModel, calc: calculateReservationQuote }, 202);
  assert.equal(basket.vatRatePercent, 20);
});
