// specs/pricing-components.md §3 rules 74 and 76 (formerly reservation-save-keeps-pricing.md rule 17, audit R3 N3) — once a save has
// rewritten the stored lines, the complement excess a removed activity left is still booked on « Activités ». The poste split reads
// the lines and the payments that name them (the complement's frozen split, the contribs of removed paid lines), never the audit log.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { stayWithCollectedLines, OPTION, RESOURCE } = require('./complementExcessFixture');

const db = require('../database');
const controller = require('../controllers/reservationsController');
const { overpaymentLinesOf } = require('../utils/overpayment');
const { postesLeft } = require('../models/refundInputModel');

const quoteOf = (cx, extra = {}) => ({ finalPrice: 300, optionsTotal: 24, resourcesTotal: 0, touristTaxTotal: 0, complementCollectedExcessTtc: cx, optionLines: [], resourceLines: [], complementDetailLines: [], ...extra });
const ACTIVITY = { key: RESOURCE(7), bucket: 'resources', cents: 8000 };
const SOLDE_OPTION = { key: OPTION(3), bucket: 'options', solde: 32 };

function splitOf(spec, { cx, total, captured, quote = {} }) {
  const id = stayWithCollectedLines(db, spec);
  const q = quoteOf(cx, quote);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const left = controller.__test.complementLeftOf(id, q, row);
  const leftover = postesLeft(db, id, { scope: 'schedule', quote: q });
  const lines = overpaymentLinesOf({
    row: { depositPaid: 0, balancePaid: 1 }, capturedByPoste: captured || {}, quote: q, overpaymentTtc: total, complementLeft: left, leftover,
  });
  return { left, leftover, lines: lines.map((l) => [l.bucket, l.amountTtc]).sort() };
}

test('rule 17 — a resource removed after the complement was collected is read from the complement it was collected in', () => {
  const { left, lines } = splitOf({ complement: [ACTIVITY], balancePaid: false, startDate: '2099-03-01' }, { cx: 80, total: 80 });
  assert.equal(left.resources, 80);
  assert.equal(left.options, 0);
  assert.deepEqual(lines, [['resources', 80]]);
});

test('rule 17 — a solde option removed is not counted again on the complement', () => {
  const { left, leftover, lines } = splitOf({ complement: [ACTIVITY], removed: [SOLDE_OPTION], startDate: '2099-04-01' }, { cx: 80, total: 112 });
  assert.equal(left.resources, 80);
  assert.equal(leftover.options, 32);
  assert.equal(leftover.resources, 0, 'the activity was collected in the complement, not in the schedule');
  assert.deepEqual(lines, [['options', 32], ['resources', 80]]);
});

test('rule 17 — a complement with no frozen split and no line named reads nothing: the options poste takes the unexplained rest', () => {
  const id = stayWithCollectedLines(db, { complement: [], balancePaid: false, startDate: '2099-05-01' });
  db.prepare("UPDATE reservations SET complementPaid = 1, complementPaidDate = '2099-02-01', complementAmount = 80 WHERE id = ?").run(id);
  const q = quoteOf(80);
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  assert.equal(controller.__test.complementLeftOf(id, q, row).resources, 0);
  const lines = overpaymentLinesOf({ row: { depositPaid: 0, balancePaid: 1 }, capturedByPoste: {}, quote: q, overpaymentTtc: 80, complementLeft: {} });
  assert.deepEqual(lines.map((l) => l.bucket), ['options']);
});

test('rule 17 — an option dropped before and another after the collection, none left on the stay, both land on options (case A)', () => {
  const { lines } = splitOf({ complement: [{ key: OPTION(5), bucket: 'options', cents: 2800 }], removed: [SOLDE_OPTION] }, { cx: 28, total: 60, quote: { optionsTotal: 0, resourcesTotal: 50 } });
  assert.deepEqual(lines, [['options', 60]]);
});

test('rule 17 — case B: the same with an option left on the stay', () => {
  const stay = { complement: [{ key: OPTION(5), bucket: 'options', cents: 2800 }], removed: [SOLDE_OPTION] };
  const kept = { optionLines: [{ optionId: 4, totalPrice: 24 }] };
  assert.deepEqual(splitOf(stay, { cx: 28, total: 60, quote: kept }).lines, [['options', 60]]);
});

test('rule 17 — case D: with captured contribs the solde option is not counted again on the complement', () => {
  const { lines } = splitOf({ complement: [ACTIVITY], removed: [SOLDE_OPTION] }, {
    cx: 80, total: 112, captured: { balance: { accommodation: 220, options: 56, resources: 0, touristTax: 0 } },
  });
  assert.deepEqual(lines, [['options', 32], ['resources', 80]]);
});
