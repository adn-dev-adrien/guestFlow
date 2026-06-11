const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHistoryValue, getOptionsSignature, getResourcesSignature, computeAuditChanges,
  formatHistoryMoney, describeSignatureValue, enrichHistoryChanges,
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

// ---- human-readable history (names + money) ----

test('formatHistoryMoney: integers drop decimals, fractions use a FR comma', () => {
  assert.equal(formatHistoryMoney(0), '0 €');
  assert.equal(formatHistoryMoney(8), '8 €');
  assert.equal(formatHistoryMoney(12.5), '12,50 €');
  assert.equal(formatHistoryMoney(null), '0 €');
});

test('describeSignatureValue: options resolve ids to names with money + compl. tag', () => {
  const names = { optionNames: { 6: 'Petit-déjeuner', 8: 'Linge de lit' } };
  const text = describeSignatureValue('optionsSignature', '6:1:0.00:c1|8:1:14.00:c1', names);
  assert.equal(text, 'Petit-déjeuner : 0 € (compl.) • Linge de lit : 14 € (compl.)');
});

test('describeSignatureValue: quantity > 1 is shown; unknown id falls back to a numbered label', () => {
  const text = describeSignatureValue('optionsSignature', '6:3:24.00:c0|99:1:5.00:c0', { optionNames: { 6: 'Petit-déjeuner' } });
  assert.equal(text, 'Petit-déjeuner ×3 : 24 € • Option #99 : 5 €');
});

test('describeSignatureValue: resources expose the offered flag and resolve names', () => {
  const names = { resourceNames: { 3: 'Lit parapluie' } };
  assert.equal(describeSignatureValue('resourcesSignature', '3:1:20.00:1:c0', names), 'Lit parapluie : 20 € (offert)');
  assert.equal(describeSignatureValue('resourcesSignature', '3:1:20.00:0:c1', names), 'Lit parapluie : 20 € (compl.)');
});

test('describeSignatureValue: custom options (synthetic id) and empty signature', () => {
  assert.equal(describeSignatureValue('optionsSignature', '1000000:1:30.00:c0', {}), 'Option personnalisée : 30 €');
  assert.equal(describeSignatureValue('optionsSignature', '', {}), 'aucune');
});

test('enrichHistoryChanges: adds fromText/toText only to option/resource changes', () => {
  const changes = [
    { field: 'finalPrice', label: 'Prix final', from: 100, to: 120 },
    { field: 'optionsSignature', label: 'Options', from: '', to: '6:1:8.00:c0' },
  ];
  const enriched = enrichHistoryChanges(changes, { optionNames: { 6: 'Petit-déjeuner' } });
  assert.equal(enriched[0].fromText, undefined); // non-signature field untouched
  assert.equal(enriched[1].fromText, 'aucune');
  assert.equal(enriched[1].toText, 'Petit-déjeuner : 8 €');
});
