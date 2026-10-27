// specs/public-api.md rule 16 (2026-10-27 audit) — the same option or resource twice in one stay is
// refused at the boundary (it used to reach the booking lines' UNIQUE index and answer a 500).
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStayInput } = require('../publicInputValidation');

const base = { propertyId: 1, startDate: '2027-07-03', endDate: '2027-07-05', adults: 2 };
const todayIso = '2027-01-01';

test('the same optionId twice → refused, the second line named', () => {
  const v = validateStayInput({ ...base, options: [{ optionId: 7, quantity: 1 }, { optionId: 7, quantity: 2 }] }, { todayIso });
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, [{ field: 'options[1].optionId', issue: 'duplicate id: send one line with a quantity' }]);
});

test('the same resourceId twice → refused', () => {
  const v = validateStayInput({ ...base, resources: [{ resourceId: 3 }, { resourceId: 3 }] }, { todayIso });
  assert.equal(v.ok, false);
  assert.equal(v.errors[0].field, 'resources[1].resourceId');
});

test('distinct ids with quantities go through', () => {
  const v = validateStayInput({ ...base, options: [{ optionId: 7, quantity: 2 }, { optionId: 8 }], resources: [{ resourceId: 3 }] }, { todayIso });
  assert.equal(v.ok, true);
});
