// specs/pricing-components.md §3 rule 72 — REFUNDS / overpayment: the trop-perçu of a stay, live and as stored, and its split
// by poste. The two netting bases stay different on purpose until PR B (every refund for the live figure, the free « Trop-perçu »
// lines only for the stored one). The legacy module re-exports the unit. Plain objects, no DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const overpayment = require('../utils/pricing/refunds/overpayment');
const legacy = require('../utils/overpayment');

const {
  collectedOnSchedule, engineExcessOf, overpaymentOf, storedOverpaymentOf, overpaymentLinesOf, currentByPoste,
} = overpayment;

const ROW = { platform: 'direct', depositPaid: 1, depositAmount: 100, balancePaid: 1, balanceAmount: 200 };

test('rule 72 — the legacy module is the unit', () => {
  assert.equal(legacy, overpayment);
});

test('rule 72 — the schedule collected: a paid bucket at its captured contribs, else its stored amount, a split at what it received', () => {
  assert.equal(collectedOnSchedule(ROW, { deposit: 100, balance: 250 }), 350);
  assert.equal(collectedOnSchedule(ROW, {}), 300);
  assert.equal(collectedOnSchedule(ROW, {}, { deposit: 80, balance: null }), 280);
  assert.equal(collectedOnSchedule({ ...ROW, balancePaid: 0 }, {}), 100);
});

test('specs/reservation-refunds.md rule 38 — a platform stay has no trop-perçu to give back; a direct one is what was collected beyond what is due', () => {
  const platform = { ...ROW, platform: 'Booking.com' };
  assert.equal(engineExcessOf({ row: platform, captured: { balance: 999 } }), 0);
  assert.equal(overpaymentOf({ row: platform, captured: { balance: 999 } }), 0);
  assert.equal(engineExcessOf({ row: ROW, captured: { deposit: 100, balance: 250 }, balanceAmount: 200 }), 50);
  assert.equal(engineExcessOf({ row: ROW, engineOverTtc: 12 }), 12);
});

test('specs/reservation-refunds.md rule 44 — the live trop-perçu is net of every refund given back, whatever the means', () => {
  assert.equal(overpaymentOf({ row: ROW, captured: { deposit: 100, balance: 250 } }), 50);
  assert.equal(overpaymentOf({ row: ROW, captured: { deposit: 100, balance: 250 }, refundedTtc: 20 }), 30);
  assert.equal(overpaymentOf({ row: ROW, captured: { deposit: 100, balance: 250 }, refundedTtc: 80 }), 0);
});

test('specs/reservation-refunds.md rule 44 — the stored trop-perçu: collected beyond the stored total, net of the free refund lines only', () => {
  const stored = { ...ROW, finalPrice: 280, touristTaxTotal: 10 };
  assert.equal(storedOverpaymentOf({ row: stored, captured: { deposit: 100, balance: 250 } }), 60);
  assert.equal(storedOverpaymentOf({ row: stored, captured: { deposit: 100, balance: 250 }, freeRefundedTtc: 5 }), 55);
  assert.equal(storedOverpaymentOf({ row: { ...stored, platform: 'Booking.com' }, captured: { balance: 999 } }), 0);
});

test('rule 72 — the postes of a stay: the accommodation is what the sale holds once the options and activities are out', () => {
  assert.deepEqual(currentByPoste({ finalPrice: 480, touristTaxTotal: 13.2, optionsTotal: 72, resourcesTotal: 28 }), {
    accommodation: 380, options: 72, resources: 28, touristTax: 13.2,
  });
  assert.deepEqual(currentByPoste({}), { accommodation: 0, options: 0, resources: 0, touristTax: 0 });
});

test('rule 72 — the trop-perçu is split by poste, none when there is none', () => {
  const quote = { finalPrice: 380, touristTaxTotal: 12, optionsTotal: 72, resourcesTotal: 0, depositAmount: 100, balanceAmount: 200 };
  const row = { ...ROW, balanceAmount: 300 };
  const lines = overpaymentLinesOf({
    row, capturedByPoste: { accommodation: 300, options: 72, resources: 0, touristTax: 12 }, quote, overpaymentTtc: 100,
  });
  assert.deepEqual(lines, [{
    bucket: 'accommodation', label: 'Hébergement', amountTtc: 100, collectedTtc: 100, dueTtc: 0, excessOnly: true,
  }]);
  assert.deepEqual(overpaymentLinesOf({ row, quote, overpaymentTtc: 0 }), []);
});
