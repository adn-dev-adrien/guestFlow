// specs/outside-booking-sas.md rule 32 — the card batch counts each visit once: `ctx.standaloneSales` lists a booking's money from the plugin only while it lives on the
// booking's own columns (paid before the document existed, rule 34); a payment of the document never touches those columns, so its session is the core's to list. A
// session paid on the booking whose extras later went on a document is still listed once, by the plugin.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('./standaloneBookingFixture');

const paid = (m, id, { saleRef = null } = {}) => {
  m.db.prepare("UPDATE resource_bookings SET paid = 1, paidAt = ?, paymentRecordedAt = ?, paymentTenders = ?, saleRef = ? WHERE id = ?")
    .run('2027-03-10', '2027-03-10T10:00:00.000Z', JSON.stringify([{ method: 'card', amountCents: 5000 }]), saleRef, id);
};
const insert = (m, name, start) => Number(m.db.prepare("INSERT INTO resource_bookings (resourceId, clientName, date, startTime, endTime, totalPrice) VALUES (1, ?, '2027-03-10', ?, ?, 50)")
  .run(name, start, `${Number(start.slice(0, 2)) + 1}:00`).lastInsertRowid);

test('rule 32 — money on the booking is listed by the plugin; a booking whose money is on a document is not', () => {
  const m = seed();
  const own = insert(m, 'A', '10:00');
  const documented = insert(m, 'B', '11:00');
  paid(m, own);
  m.db.prepare("UPDATE resource_bookings SET saleRef = 'standalone:7' WHERE id = ?").run(documented);
  const listed = m.model.standaloneSales({ from: '2027-03-01', to: '2027-03-31' });
  assert.deepEqual(listed.map((sale) => sale.key), [`resource-booking:${own}`]);
});

test('rule 34 — a session paid on the booking, then extras on a document: the session is still listed once by the plugin', () => {
  const m = seed();
  const legacy = insert(m, 'C', '12:00');
  paid(m, legacy, { saleRef: 'standalone:8' });
  const listed = m.model.standaloneSales({ from: '2027-03-01', to: '2027-03-31' });
  assert.deepEqual(listed.map((sale) => [sale.key, sale.totalCents]), [[`resource-booking:${legacy}`, 5000]]);
});
