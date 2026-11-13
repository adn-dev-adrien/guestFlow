// specs/outside-booking-sas.md rules 25-27 and the edge case « booking moved after the arrival » — lowering a paid line goes through REFUNDS only (409 `LINE_PAID`,
// then the administrator's confirmation, « à rembourser » from `refundOwedCents`); deleting an unpaid visit cancels its document, one holding money stays;
// « Client absent » retires the unpaid lines and keeps the money; a moved booking re-prices its session only while it is unpaid.
// Deleting, paying and moving a booking whose money is on a document: resource-booking-pricing-and-invoicing rule 52.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

test('rule 25 — offering a paid line asks the administrator\'s confirmation, then owes the refund', async () => {
  const id = f.book();
  const visit = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 2)], payment: { tenders: f.card(6300) } } })).body.visit;
  const beer = visit.lines.find((line) => line.label === 'Bière locale');
  const refused = await f.call('patchLine', { id, lineId: beer.id, body: { offered: true } });
  assert.deepEqual([refused.code, refused.body.code, refused.body.error], [409, 'LINE_PAID', 'Ligne payée : remboursement à confirmer.']);
  const confirmed = (await f.call('patchLine', { id, lineId: beer.id, body: { offered: true, confirmRefund: true } })).body.visit;
  assert.deepEqual([confirmed.totals.totalCents, confirmed.totals.remainingCents, confirmed.totals.refundOwedCents], [5000, 0, 1300]);
  const reception = (await f.call('getVisit', { id, user: f.RECEPTION })).body;
  assert.ok(!('refundOwedCents' in reception.totals), 'never a refund amount for the reception');
});

test('rule 25 — removing an unpaid line is free; a paid one needs the confirmation', async () => {
  const id = f.book();
  const visit = (await f.call('commit', { id, body: { extras: [f.extra(f.lemonade, 1)], payment: { tenders: f.card(5000), shortfall: { kind: 'due' } } } })).body.visit;
  const lemonade = visit.lines.find((line) => line.label === 'Limonade');
  const removed = (await f.call('patchLine', { id, lineId: lemonade.id, body: { remove: true } })).body.visit;
  assert.deepEqual([removed.lines.find((l) => l.id === lemonade.id).status, removed.totals.remainingCents], ['cancelled', 0]);
  const session = removed.lines[0];
  assert.equal((await f.call('patchLine', { id, lineId: session.id, body: { remove: true } })).body.code, 'SESSION_LINE', 'the session is offered, or the booking deleted');
  const lemonades = (await f.call('commit', { id, body: { extras: [f.extra(f.lemonade, 1)] } })).body.visit;
  await f.call('pay', { id, body: { tenders: f.card(400) } });
  const paidLemonade = lemonades.lines.filter((line) => line.label === 'Limonade').at(-1);
  assert.equal((await f.call('patchLine', { id, lineId: paidLemonade.id, body: { remove: true } })).body.code, 'LINE_PAID');
});

test('rule 26 — deleting an unpaid visit cancels its document; a visit holding money is never deleted', async () => {
  const unpaid = f.book();
  await f.call('commit', { id: unpaid, body: { extras: [f.extra(f.beer, 1)] } });
  const saleId = Number(f.row(unpaid).saleRef.split(':')[1]);
  assert.deepEqual(f.bookings.remove(unpaid), { ok: true });
  assert.equal(f.row(unpaid), null, 'the slot is released');
  assert.equal(f.db.prepare('SELECT status FROM standalone_sales WHERE id = ?').get(saleId).status, 'cancelled');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM standalone_sale_lines WHERE saleId = ? AND cancelledAt IS NULL').get(saleId).n, 0);
  const paid = f.book();
  await f.call('commit', { id: paid, body: { payment: { tenders: f.card(1000), shortfall: { kind: 'due' } } } });
  const refused = f.bookings.remove(paid);
  assert.deepEqual([refused.status, refused.code], [409, 'BOOKING_PAID']);
  assert.ok(f.row(paid));
});

test('rule 27 — « Client absent »: on or after the day only, never once arrived; unpaid lines retired, money kept, the card « Absent »', async () => {
  const early = f.book();
  f.setNow(new Date(new Date(`${f.DAY}T00:00:00+01:00`).getTime() - 3600000).toISOString());
  assert.equal((await f.call('noShow', { id: early })).body.code, 'NO_SHOW_TOO_EARLY');
  f.setNow(`${f.DAY}T15:00:00Z`);
  const arrived = f.book();
  await f.call('commit', { id: arrived, body: {} });
  assert.equal((await f.call('noShow', { id: arrived })).body.code, 'BOOKING_ARRIVED');

  const id = f.book();
  // Money taken before the day of the visit (a payment of the session from the booking dialog once the document exists).
  await f.call('pay', { id, body: { tenders: f.card(2000), shortfall: { kind: 'due' } } });
  const res = await f.call('noShow', { id });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.booking.cardState, { state: 'absent', label: 'Absent', remainingCents: 0 });
  const visit = (await f.call('getVisit', { id })).body;
  assert.equal(visit.lines[0].status, 'due', 'a line partly paid stays as it is');
  assert.equal(visit.totals.paidCents, 2000, 'the money taken is kept');
  assert.deepEqual(visit.window, { open: false, reason: 'noShow' });
  assert.equal((await f.call('commit', { id, body: {} })).body.code, 'BOOKING_NO_SHOW');

  const unpaid = f.book();
  f.visits.inTransaction((stop) => f.visits.ensureDocument(f.row(unpaid), { stop }));
  await f.call('noShow', { id: unpaid });
  const cancelled = (await f.call('getVisit', { id: unpaid })).body;
  assert.equal(cancelled.lines[0].status, 'cancelled', 'an unpaid line is retired');
  assert.equal(cancelled.totals.remainingCents, 0);
});

test('edge case — a booking moved after its session was sold is re-priced while unpaid, refused once paid', async () => {
  const id = f.book();
  await f.call('commit', { id, body: {} });
  const moved = f.bookings.update(id, { startTime: '18:00', endTime: '20:00' });
  assert.equal(moved.ok, true);
  const visit = (await f.call('getVisit', { id })).body;
  assert.deepEqual(visit.lines.map((line) => [line.status, line.totalCents]), [['cancelled', 0], ['due', 12000]]);
  assert.ok(visit.history.some((entry) => entry.text === 'Bain fictif retirée'));
  await f.call('pay', { id, body: { tenders: f.card(12000) } });
  const refused = f.bookings.update(id, { startTime: '17:00', endTime: '19:00' });
  assert.deepEqual([refused.status, refused.code], [409, 'BOOKING_PAID']);
  assert.equal(f.row(id).startTime, '18:00', 'the move is undone with the refusal');
});
