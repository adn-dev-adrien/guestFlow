// specs/guest-app.md rule 96 and specs/pricing-components.md rules 12, 13 (review defect D4, MEDIUM 3) — an order for an article the stay already holds at an older
// price is a line of its own at the catalogue price of the day; the line already sold keeps its price (nothing is merged, nothing drifts).
const fx = require('../plugins/guest-app/tests/guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, db, openOrdering, seedStay, sell,
} = fx;

const CIDER = addOption({ id: 3821, title: 'Cidre fusion', price: 7 });
sell('option', CIDER);

test('rule 96 — the stay holds 1 × 6,50 €, the catalogue is at 7 €: an order of 2 is quoted, charged and written as 2 × 7 €, the first line untouched', async () => {
  const stayId = seedStay({ start: 5, end: 9, checkedIn: 0 });
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, billedUnits, unitPrice, totalPrice, inComplement) VALUES (?, ?, 1, 1, 6.5, 6.5, 1)').run(stayId, CIDER);
  const ctx = await openOrdering(stayId);
  try {
    const lines = [{ kind: 'option', id: CIDER, quantity: 2 }];
    assert.equal((await ctx.call('POST', '/public/v1/guest/orders/quote', { lines })).body.data.total, 14);
    const placed = await ctx.call('POST', '/public/v1/guest/orders', { lines, payment: 'note' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    const written = db.prepare('SELECT quantity, unitPrice, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ? ORDER BY lineId').all(stayId, CIDER);
    assert.deepEqual(written.map((l) => [l.quantity, l.unitPrice, l.totalPrice]), [[1, 6.5, 6.5], [2, 7, 14]]);
  } finally { await ctx.close(); }
});
