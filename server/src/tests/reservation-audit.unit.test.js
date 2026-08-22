const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHistoryValue, getOptionsSignature, getResourcesSignature, computeAuditChanges,
  formatHistoryMoney,
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
  // The trailing `:c0` segment encodes the `inComplement` flag (spec force-item-to-complement.md);
  // unset lines default to 0 so legacy reservations produce a stable, additive-only signature.
  assert.equal(a, '1:2:5.00:c0|2:1:10.00:c0');

  const r = getResourcesSignature([{ resourceId: 3, quantity: 1, totalPrice: 20, offered: 1 }]);
  assert.equal(r, '3:1:20.00:1:c0');

  // Toggling `inComplement` flips the signature so the audit history records it.
  const forced = getOptionsSignature([{ optionId: 1, quantity: 1, totalPrice: 10, inComplement: 1 }]);
  assert.equal(forced, '1:1:10.00:c1');
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

// specs/adjustable-complement-amounts.md §3.1 rule 11 — un complément ajusté est de l'argent déplacé
// à la main : il doit se relire dans l'historique comme n'importe quelle autre modification.
test('les deux ajustements de complément apparaissent dans le diff d\'historique', () => {
  const arrival = computeAuditChanges({ complementAmountOverride: null }, { complementAmountOverride: 85 });
  assert.equal(arrival.length, 1);
  assert.equal(arrival[0].label, "Complément d'arrivée ajusté");
  assert.equal(arrival[0].from, null);
  assert.equal(arrival[0].to, 85);

  const endOfStay = computeAuditChanges(
    { endOfStayComplementAmountOverride: 45 }, { endOfStayComplementAmountOverride: null },
  );
  assert.equal(endOfStay.length, 1);
  assert.equal(endOfStay[0].label, 'Complément de fin de séjour ajusté');
  assert.equal(endOfStay[0].to, null, 'vider le champ se relit aussi');
});

// ---- human-readable history (names + money) ----
// The row-building read side lives in reservation-history-rows.unit.test.js.

test('formatHistoryMoney: integers drop decimals, fractions use a FR comma', () => {
  assert.equal(formatHistoryMoney(0), '0 €');
  assert.equal(formatHistoryMoney(8), '8 €');
  assert.equal(formatHistoryMoney(12.5), '12,50 €');
  assert.equal(formatHistoryMoney(null), '0 €');
});
