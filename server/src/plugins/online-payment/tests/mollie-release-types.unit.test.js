/**
 * specs/payments/mollie-rolling-reserve-and-incoming-payments.md rule 10 — a settlement is composed from the whole family of payment
 * and reserve-release balance transactions, not only the two types measured on an online payment: an on-site payment's
 * release may come under a sibling type. Any other type between two transfers is reported, never silently allocated.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readBalanceTransaction } = require('../mollieClient');
const { createSettlementsModel, isImmediateType, isReleaseType } = require('../reconciliation/mollieSettlements');
const { db, reset } = require('./mollieFixture');

test.beforeEach(() => { reset(); });

const amount = (value) => ({ value, currency: 'EUR' });
const apiTx = (id, type, createdAt, result, initial, context) => ({
  id, type, createdAt, resultAmount: amount(result), initialAmount: amount(initial), deductions: null, context,
});
// date-literal-ok: balance transaction timestamps only order the rows (offsets from a fixed origin), nothing compares them with today
// date-literal-ok: fixture data drawn as given; nothing compares it with today
const at = (offset) => new Date(Date.UTC(2030, 0, 1 + offset, 5)).toISOString();

test('rule 10 — every rolling-reserve release type and a captured payment are composed with their payment id', () => {
  assert.equal(isReleaseType('api-payment-rolling-reserve-release'), true);
  assert.equal(isReleaseType('rolling-reserve-release'), true);
  assert.equal(isReleaseType('capture-rolling-reserve-release'), true);
  assert.equal(isReleaseType('released-rolling-reserve'), true);
  assert.equal(isReleaseType('rolling-reserve-hold'), false);
  assert.equal(isImmediateType('capture'), true);
  assert.equal(isImmediateType('refund'), false);

  const model = createSettlementsModel(db);
  model.storeBalanceTransactions([
    apiTx('bt_r1', 'outgoing-transfer', at(10), '-62.80', '-62.80', { settlementId: 'stl_rel01' }),
    apiTx('bt_r2', 'rolling-reserve-release', at(9), '2.80', '2.80', { paymentId: 'tr_onsite1' }),
    apiTx('bt_r3', 'capture', at(8), '60.00', '75.00', { paymentId: 'tr_capt1' }),
    apiTx('bt_r0', 'outgoing-transfer', at(1), '-10.00', '-10.00', { settlementId: 'stl_rel00' }),
  ].map(readBalanceTransaction));
  const composed = (model.compositionOf('stl_rel01') || []).map((t) => [t.type, t.paymentId, t.resultCents]);
  assert.deepEqual(composed, [['capture', 'tr_capt1', 6000], ['rolling-reserve-release', 'tr_onsite1', 280]]);
});

test('rule 10 — an unknown type between two transfers is reported and left out of the composition', (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (msg) => warnings.push(String(msg)));
  const model = createSettlementsModel(db);
  model.storeBalanceTransactions([
    apiTx('bt_u1', 'outgoing-transfer', at(40), '-14.00', '-14.00', { settlementId: 'stl_unk01' }),
    apiTx('bt_u2', 'payment', at(39), '11.20', '14.00', { paymentId: 'tr_pay1' }),
    apiTx('bt_u3', 'balance-correction', at(39), '2.80', '2.80', {}),
  ].map(readBalanceTransaction));
  const composed = (model.compositionOf('stl_unk01') || []).map((x) => x.type);
  assert.deepEqual(composed, ['payment']);
  assert.ok(warnings.some((w) => w.includes('balance-correction') && w.includes('stl_unk01')), 'the unknown type is named');
});
