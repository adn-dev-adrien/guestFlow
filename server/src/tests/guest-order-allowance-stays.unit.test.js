// specs/guest-app.md rule 87 and specs/pricing-components.md rules 25, 26 (review defect D5, H2 — no test existed) — the free units a line consumed stay with it: removing an unpaid
// order line gives them back for the NEXT sale and re-prices no other standing line.
const fx = require('../plugins/guest-app/tests/guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, openOrdering, seedStay, sell,
} = fx;
const extraSale = require('../utils/extraSale');

const CIDER = addOption({ id: 3861, title: 'Cidre allocation', price: 5 });
db.prepare('INSERT OR REPLACE INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, ?, 5, 2)').run(CIDER);
sell('option', CIDER);
const lines = (id) => db.prepare('SELECT lineId, quantity, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(id, CIDER);

test('rules 25, 26 — an unpaid line removed leaves the line sold after it at its own price, never re-priced onto the units given back', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  const ctx = await openOrdering(stayId);
  try {
    const first = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' });
    const second = await ctx.call('POST', '/public/v1/guest/orders', { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
    assert.deepEqual([first.status, second.status], [200, 200]);
    assert.deepEqual(lines(stayId).map((l) => l.totalPrice), [0, 5], 'the 2 granted units covered the first order; the second is billed');
    const [one] = lines(stayId);
    const removed = extraSale.removeLine(stayId, `option:${one.lineId}`);
    assert.equal(removed.status, 200);
    assert.deepEqual(lines(stayId).map((l) => l.totalPrice), [5], 'the standing line is not re-priced by the removal (D5)');
  } finally { await ctx.close(); }
});
