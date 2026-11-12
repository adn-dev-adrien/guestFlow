// specs/pricing-components.md §3 rules 74 and 76 (formerly reservation-save-keeps-pricing.md rule 18, audit R4 N5) — the complement
// counts only the lines it collected; a line dropped from the schedule belongs to the schedule. The two never overlap: a payment
// names its lines, the complement through its frozen split, the schedule through its contribs.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stayWithCollectedLines, OPTION, RESOURCE } = require('./complementExcessFixture');

const db = require('../database');
const controller = require('../controllers/reservationsController');
const { overpaymentLinesOf } = require('../utils/overpayment');
const { postesLeft } = require('../models/refundInputModel');

const quote = (extra = {}) => ({ finalPrice: 300, optionsTotal: 24, resourcesTotal: 0, touristTaxTotal: 0, complementCollectedExcessTtc: 30, optionLines: [], resourceLines: [], complementDetailLines: [], ...extra });
const ACTIVITY = { key: RESOURCE(7), bucket: 'resources', cents: 3000 };

function read(spec, q = quote()) {
  const id = stayWithCollectedLines(db, spec);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  return { id, row, left: controller.__test.complementLeftOf(id, q, row), leftover: postesLeft(db, id, { scope: 'schedule', quote: q }) };
}

test('rule 18 — X1: a solde option dropped from an unpaid solde does not take the complement activity\'s excess', () => {
  const { left, leftover } = read({ complement: [ACTIVITY], balancePaid: false });
  assert.equal(left.options, 0);
  assert.equal(left.resources, 30);
  assert.deepEqual(leftover, { options: 0, resources: 0, touristTax: 0 });
  const lines = overpaymentLinesOf({ row: { depositPaid: 0, balancePaid: 0 }, capturedByPoste: {}, quote: quote(), overpaymentTtc: 30, complementLeft: left, leftover });
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc]), [['resources', 30]]);
});

test('rule 18 — X2: a solde option excess already refunded does not take the complement activity\'s excess', () => {
  const { left, leftover } = read({ complement: [ACTIVITY], removed: [{ key: OPTION(3), bucket: 'options', solde: 50 }] });
  assert.equal(leftover.options, 50);
  const lines = overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 1 }, capturedByPoste: { balance: { accommodation: 226, options: 74, resources: 0, touristTax: 0 } },
    quote: quote(), overpaymentTtc: 30, complementLeft: left, leftover,
  });
  assert.deepEqual(lines.map((l) => [l.bucket, l.amountTtc]), [['resources', 30]]);
});

test('rule 18 — an option dropped from the complement is read from the complement\'s lines', () => {
  const { left } = read({ complement: [{ key: OPTION(3), bucket: 'options', cents: 3000 }] });
  assert.equal(left.options, 30);
  assert.equal(left.resources, 0);
});

test('rule 18 — an option the complement collected and the stay still sells is not a drop', () => {
  const { left } = read({ complement: [{ key: OPTION(3), bucket: 'options', cents: 3000 }] }, quote({ optionLines: [{ optionId: 3, totalPrice: 30 }] }));
  assert.equal(left.options, 0);
});
