// specs/airbnb-mail-intake.md rules 9–10 — reading A: the withheld tax is what Airbnb keeps, and the
// commission is then Airbnb's host fee exactly. Measured on réservations 202610003 and 202609003.
const test = require('node:test');
const assert = require('node:assert/strict');

const { paymentBlock } = require('../paymentBlock');

const LOUIS = { total: 1236.26, payout: 1028.44, guestTaxes: 81.66, hostTaxes: 52.8, hostFee: 178.96 };
const NICOLAS = { total: 868.87, payout: 704.22, guestTaxes: 63.87, hostTaxes: 24, hostFee: 124.78 };

test('rule 9: both measured bookings — the tax kept by Airbnb, the commission on its fee', () => {
  assert.deepEqual(paymentBlock(LOUIS, { withholds: true }).block,
    { platformGrossAmount: 1236.26, platformTouristTaxAmount: 28.86, platformPayoutAmount: 1028.44 });
  assert.deepEqual(paymentBlock(NICOLAS, { withholds: true }).block,
    { platformGrossAmount: 868.87, platformTouristTaxAmount: 39.87, platformPayoutAmount: 704.22 });
});

test('rule 9: a commission that does not land on the host fee is refused', () => {
  const r = paymentBlock({ ...LOUIS, hostFee: 178.95 }, { withholds: true });
  assert.deepEqual(r, { ok: false, error: 'La commission ne retombe pas sur les frais de service Airbnb' });
});

test('rule 9: more taxes handed to the host than the guest paid is refused', () => {
  assert.equal(paymentBlock({ ...LOUIS, hostTaxes: 90 }, { withholds: true }).ok, false);
});

test('rule 10: outside the `platform` tax mode the box stays empty', () => {
  const r = paymentBlock(LOUIS, { withholds: false });
  assert.equal(r.taxLeftEmpty, true);
  assert.equal(r.block.platformTouristTaxAmount, null);
  assert.equal(r.block.platformGrossAmount, 1236.26);
});
