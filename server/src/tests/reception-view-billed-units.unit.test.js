// specs/reception-role-checkin-only.md rule 13 (fixed at the 2026-10-27 spec review) — the reception
// payload keeps `billedUnits` on option and resource lines: it is a count, not money, and the
// planning card renders « title ×billedUnits ». Dropping it made a reception card read « ×1 » where
// the admin card read « ×3 ».
const test = require('node:test');
const assert = require('node:assert/strict');

const { toReceptionReservationView } = require('../utils/receptionView');

test('option and resource lines keep billedUnits, still without a price', () => {
  const view = toReceptionReservationView({
    id: 1,
    startDate: '2099-01-01',
    endDate: '2099-01-04',
    options: [{ id: 1, title: 'Petit-déjeuner', quantity: 1, billedUnits: 3, unitPrice: 12, totalPrice: 36, inComplement: 0 }],
    resources: [{ id: 2, resourceId: 5, name: 'Bain nordique', quantity: 1, billedUnits: 2, unitPrice: 40, totalPrice: 80 }],
  });
  assert.equal(view.options[0].billedUnits, 3);
  assert.equal(view.options[0].unitPrice, undefined);
  assert.equal(view.options[0].totalPrice, undefined);
  assert.equal(view.resources[0].billedUnits, 2);
  assert.equal(view.resources[0].totalPrice, undefined);
});
