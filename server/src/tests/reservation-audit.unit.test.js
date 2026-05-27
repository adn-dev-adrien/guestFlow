const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHistoryValue, getOptionsSignature, getResourcesSignature, computeAuditChanges,
} = require('../utils/reservationAudit');

test('normalizeHistoryValue: empty-ish → null, numbers rounded to cents', () => {
  assert.equal(normalizeHistoryValue(''), null);
  assert.equal(normalizeHistoryValue(undefined), null);
  assert.equal(normalizeHistoryValue(null), null);
  assert.equal(normalizeHistoryValue(12.345), 12.35);
  assert.equal(normalizeHistoryValue('Paris'), 'Paris');
});

test('option/resource signatures are order-independent and stable', () => {
  const a = getOptionsSignature([{ optionId: 2, quantity: 1, totalPrice: 10 }, { optionId: 1, quantity: 2, totalPrice: 5 }]);
  const b = getOptionsSignature([{ optionId: 1, quantity: 2, totalPrice: 5 }, { optionId: 2, quantity: 1, totalPrice: 10 }]);
  assert.equal(a, b);
  assert.equal(a, '1:2:5.00|2:1:10.00');

  const r = getResourcesSignature([{ resourceId: 3, quantity: 1, totalPrice: 20, offered: 1 }]);
  assert.equal(r, '3:1:20.00:1');
});

test('computeAuditChanges reports only changed labeled fields', () => {
  const before = { clientId: 1, finalPrice: 100, notes: 'x' };
  const after = { clientId: 2, finalPrice: 100, notes: 'x' };
  const changes = computeAuditChanges(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].field, 'clientId');
  assert.equal(changes[0].label, 'Client');
  assert.equal(changes[0].from, 1);
  assert.equal(changes[0].to, 2);
});

test('computeAuditChanges treats empty-string and null as equal (no spurious change)', () => {
  assert.equal(computeAuditChanges({ notes: '' }, { notes: null }).length, 0);
  assert.equal(computeAuditChanges({ finalPrice: 100.001 }, { finalPrice: 100.004 }).length, 0);
});
