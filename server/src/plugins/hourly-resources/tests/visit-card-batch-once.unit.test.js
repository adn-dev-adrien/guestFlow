// specs/outside-booking-sas.md rule 32 — the card batch counts each visit once: `ctx.standaloneSales` lists a booking's money from the plugin only while it lives on the
// booking (paid before the document existed, rule 34); a booking with a `saleRef` is the core document's to list, so its session is never counted twice.
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('./standaloneBookingFixture');

const paid = (m, id, { saleRef = null } = {}) => {
  m.db.prepare("UPDATE resource_bookings SET paid = 1, paidAt = ?, paymentRecordedAt = ?, paymentTenders = ?, saleRef = ? WHERE id = ?")
    .run('2027-03-10', '2027-03-10T10:00:00.000Z', JSON.stringify([{ method: 'card', amountCents: 5000 }]), saleRef, id);
};

test('rule 32 — a booking paid on the booking is listed by the plugin; one whose money is on a document is not', () => {
  const m = seed();
  const own = Number(m.db.prepare("INSERT INTO resource_bookings (resourceId, clientName, date, startTime, endTime, totalPrice) VALUES (1, 'A', '2027-03-10', '10:00', '11:00', 50)").run().lastInsertRowid);
  const documented = Number(m.db.prepare("INSERT INTO resource_bookings (resourceId, clientName, date, startTime, endTime, totalPrice) VALUES (1, 'B', '2027-03-10', '11:00', '12:00', 50)").run().lastInsertRowid);
  paid(m, own);
  paid(m, documented, { saleRef: 'standalone:7' });
  const listed = m.model.standaloneSales({ from: '2027-03-01', to: '2027-03-31' });
  assert.deepEqual(listed.map((sale) => sale.key), [`resource-booking:${own}`]);
});
