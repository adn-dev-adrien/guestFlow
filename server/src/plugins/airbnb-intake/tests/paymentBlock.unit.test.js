// specs/airbnb-mail-intake.md rules 9–10 — reading A: the withheld tax is what Airbnb keeps, and the
// commission is then Airbnb's host fee exactly. Measured on réservations 202610003 and 202609003.
const test = require('node:test');
const assert = require('node:assert/strict');

const { paymentBlock: block } = require('../paymentBlock');
const { computePlatformCommission } = require('../../../utils/platformCommission');

// The core's PLATFORM PAYMENT, as the SDK hands it to the plugin: the box adds to the host amount only for a platform that reverses the tax.
const REVERSES = (figures) => computePlatformCommission(figures);
const KEEPS = ({ touristTax, ...figures }) => computePlatformCommission(figures);
const paymentBlock = (booking, options) => block(booking, { platform: 'Airbnb', platformCommission: options.mode === 'platform_reversed' ? REVERSES : KEEPS, ...options });

// Amended 2026-11-26 (specs/platform-host-statement-and-commission-vat.md rules 1, 5, 20): the block is the host side of « Vous gagnez ».
// Toussaint (#22326) and Fraisse (#22291), figures measured in production.
const LOUIS = { roomFees: 1598, adjustments: -443.4, cleaningFee: 0, payout: 1028.44, guestTaxes: 81.66, hostTaxes: 52.8, hostFee: 178.96 };
const NICOLAS = { roomFees: 725, adjustments: 0, cleaningFee: 80, payout: 704.22, guestTaxes: 63.87, hostTaxes: 24, hostFee: 124.78 };

test('rule 20: Location = rooms and adjustments, Options = the cleaning fee, the box = the taxes handed to the host (reversed)', () => {
  assert.deepEqual(paymentBlock(LOUIS, { mode: 'platform_reversed' }).block,
    { platformGrossAmount: 1154.6, platformOptionsAmount: 0, platformTouristTaxAmount: 52.8, platformPayoutAmount: 1028.44 });
  assert.deepEqual(paymentBlock(NICOLAS, { mode: 'platform_reversed' }).block,
    { platformGrossAmount: 805, platformOptionsAmount: 80, platformTouristTaxAmount: 24, platformPayoutAmount: 704.22 });
});

test('rule 20: in mode `platform` the box is the part of the taxes Airbnb kept, and the commission is the same host fee', () => {
  assert.deepEqual(paymentBlock(LOUIS, { mode: 'platform' }).block,
    { platformGrossAmount: 1154.6, platformOptionsAmount: 0, platformTouristTaxAmount: 28.86, platformPayoutAmount: 1028.44 });
});

test('rule 9: a commission that does not land on the host fee is refused', () => {
  const r = paymentBlock({ ...LOUIS, hostFee: 178.95 }, { mode: 'platform_reversed' });
  assert.deepEqual(r, { ok: false, error: 'La commission ne retombe pas sur les frais de service Airbnb' });
});

test('rule 9: more taxes handed to the host than the guest paid is refused', () => {
  assert.equal(paymentBlock({ ...LOUIS, hostTaxes: 90 }, { mode: 'platform_reversed' }).ok, false);
});

test('rule 10: in `owner` mode the box stays empty', () => {
  const r = paymentBlock(LOUIS, { mode: 'owner' });
  assert.equal(r.taxLeftEmpty, true);
  assert.equal(r.block.platformTouristTaxAmount, null);
  assert.equal(r.block.platformGrossAmount, 1154.6);
});

test('specs/pricing-components.md rule 70 — the commission is the core\'s PLATFORM PAYMENT (SDK platformCommission), never worked out here', () => {
  const seen = [];
  const spy = (figures) => { seen.push(figures); return computePlatformCommission(figures); };
  assert.equal(block(LOUIS, { mode: 'platform_reversed', platform: 'Airbnb', platformCommission: spy }).ok, true);
  assert.deepEqual(seen, [{ platform: 'Airbnb', gross: 1154.6, payout: 1028.44, touristTax: 52.8 }]);
  assert.equal(block(LOUIS, { mode: 'platform_reversed', platform: 'Airbnb', platformCommission: () => null }).ok, false, 'a figure missing: refused');
});
