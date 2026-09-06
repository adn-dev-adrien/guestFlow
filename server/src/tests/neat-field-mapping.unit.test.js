/**
 * specs/neat-cancellation-insurance-subscription.md §3.1 rules 4-5 — utils/neatFieldMapping.js.
 *
 * Mapping validation (required coverage, type compatibility, dropdown options), payload building
 * from a stay snapshot, and the customer payload. Pure functions, no I/O.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  contractServiceFields, parseMappingJson, validateMapping, buildServiceFieldValues, buildCustomerPayload,
} = require('../utils/neatFieldMapping');

const FIELDS = [
  { id: 'f-start', title: 'Date de début', name: 'startDate', type: 'datetime', required: true, options: [] },
  { id: 'f-amount', title: 'Montant', name: 'amount', type: 'number', required: true, options: [] },
  { id: 'f-kind', title: 'Type', name: 'kind', type: 'dropdown', required: true, options: ['Lodge', 'Camping'] },
  { id: 'f-note', title: 'Note', name: 'note', type: 'string', required: false, options: [] },
];

const SNAPSHOT = {
  startDate: '2026-10-01', endDate: '2026-10-04', nights: 3, guests: 4,
  accommodationAmount: 300, insuranceAmount: 21, totalAmount: 380,
  propertyName: 'La Granja', reservationRef: 'GF-42',
};

test('contractServiceFields flattens Garanties and dedupes shared field ids', () => {
  const contract = { product: { Garanties: [
    { serviceFields: [{ id: 'a', title: 'A', type: 'string', required: true }, { id: 'b', title: 'B', type: 'number' }] },
    { serviceFields: [{ id: 'a', title: 'A again', type: 'string' }, { id: 'c', title: 'C', type: 'datetime', required: false }] },
  ] } };
  const fields = contractServiceFields(contract);
  assert.deepEqual(fields.map((f) => f.id), ['a', 'b', 'c']);
  assert.equal(fields[0].title, 'A', 'the first occurrence wins');
  assert.equal(fields[0].required, true);
});

test('a complete, type-consistent mapping validates', () => {
  const mapping = {
    'f-start': { source: 'startDate' },
    'f-amount': { source: 'accommodationAmount' },
    'f-kind': { source: 'constant', constant: 'Lodge' },
  };
  assert.deepEqual(validateMapping(mapping, FIELDS), { ok: true, errors: [] });
});

test('an unmapped required field fails with REQUIRED_UNMAPPED; optional fields may stay unmapped', () => {
  const { ok, errors } = validateMapping({ 'f-start': { source: 'startDate' }, 'f-kind': { source: 'constant', constant: 'Lodge' } }, FIELDS);
  assert.equal(ok, false);
  assert.deepEqual(errors, [{ fieldId: 'f-amount', error: 'REQUIRED_UNMAPPED' }]);
});

test('type mismatches are rejected: a date source cannot feed a number field, and vice versa', () => {
  const bad = validateMapping({
    'f-start': { source: 'nights' }, // number → datetime
    'f-amount': { source: 'endDate' }, // datetime → number
    'f-kind': { source: 'propertyName' }, // derived → dropdown
  }, FIELDS);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.error), ['TYPE_MISMATCH', 'TYPE_MISMATCH', 'TYPE_MISMATCH']);
});

test('a string field accepts any source — everything stringifies', () => {
  const { ok } = validateMapping({
    'f-start': { source: 'startDate' },
    'f-amount': { source: 'totalAmount' },
    'f-kind': { source: 'constant', constant: 'Camping' },
    'f-note': { source: 'nights' },
  }, FIELDS);
  assert.equal(ok, true);
});

test('a dropdown constant must belong to the contract options; a number constant must be numeric', () => {
  const wrongOption = validateMapping({
    'f-start': { source: 'startDate' }, 'f-amount': { source: 'totalAmount' },
    'f-kind': { source: 'constant', constant: 'Yourte' },
  }, FIELDS);
  assert.deepEqual(wrongOption.errors, [{ fieldId: 'f-kind', error: 'CONSTANT_NOT_IN_OPTIONS' }]);

  const notNumeric = validateMapping({
    'f-start': { source: 'startDate' }, 'f-amount': { source: 'constant', constant: 'douze' },
    'f-kind': { source: 'constant', constant: 'Lodge' },
  }, FIELDS);
  assert.deepEqual(notNumeric.errors, [{ fieldId: 'f-amount', error: 'CONSTANT_NOT_NUMERIC' }]);
});

test('an unknown source key is rejected, never silently dropped', () => {
  const { errors } = validateMapping({
    'f-start': { source: 'startDate' }, 'f-amount': { source: 'grandTotal' },
    'f-kind': { source: 'constant', constant: 'Lodge' },
  }, FIELDS);
  assert.deepEqual(errors, [{ fieldId: 'f-amount', error: 'UNKNOWN_SOURCE' }]);
});

test('buildServiceFieldValues types each value for Neat: ISO datetime, real number, string, dropdown constant', () => {
  const mapping = {
    'f-start': { source: 'startDate' },
    'f-amount': { source: 'accommodationAmount' },
    'f-kind': { source: 'constant', constant: 'Lodge' },
    'f-note': { source: 'reservationRef' },
  };
  assert.deepEqual(buildServiceFieldValues(mapping, FIELDS, SNAPSHOT), [
    { id: 'f-start', type: 'datetime', value: '2026-10-01T00:00:00.000Z' },
    { id: 'f-amount', type: 'number', value: 300 },
    { id: 'f-kind', type: 'dropdown', value: 'Lodge' },
    { id: 'f-note', type: 'string', value: 'GF-42' },
  ]);
});

test('unmapped or empty-valued fields are omitted from the payload', () => {
  const mapping = { 'f-amount': { source: 'accommodationAmount' } };
  const values = buildServiceFieldValues(mapping, FIELDS, { ...SNAPSHOT, accommodationAmount: 300, propertyName: '' });
  assert.deepEqual(values.map((v) => v.id), ['f-amount']);
});

test('parseMappingJson tolerates garbage — corrupt JSON reads as an empty mapping', () => {
  assert.deepEqual(parseMappingJson('{broken'), {});
  assert.deepEqual(parseMappingJson('[1,2]'), {});
  assert.deepEqual(parseMappingJson(''), {});
  assert.deepEqual(parseMappingJson('{"f":{"source":"nights"}}'), { f: { source: 'nights' } });
});

test('buildCustomerPayload maps the GuestFlow client and omits what it does not hold', () => {
  const full = buildCustomerPayload({
    firstName: 'jeanne', lastName: 'Durand', email: 'j@d.fr', phone: '0601020304',
    streetNumber: '12', street: 'rue des Lilas', postalCode: '20200', city: 'Bastia',
  });
  assert.deepEqual(full, {
    firstName: 'jeanne', lastName: 'Durand', email: 'j@d.fr', phone: '0601020304',
    address: { street: '12 rue des Lilas', postalCode: '20200', city: 'Bastia' },
  });

  const minimal = buildCustomerPayload({ firstName: 'Jean', lastName: 'Petit', email: 'jp@x.fr' });
  assert.deepEqual(minimal, { firstName: 'Jean', lastName: 'Petit', email: 'jp@x.fr' });
  assert.equal('phone' in minimal, false, 'no empty keys — Neat must see absence, not ""');
  assert.equal('address' in minimal, false);
});
