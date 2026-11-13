// specs/outside-booking-sas.md rules 1, 5, 7 — who gets the mini SAS, its day window (D 00:00 → D+1 04:00, the stay SAS's), and what the reception may do:
// open and commit inside the window, read-only after it, never a paid line, a refund or a refund amount (403 `ADMIN_ONLY`).
// The reception's side of it is reception-role-checkin-only rule 17.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');
const registry = require('../../sdk/registry');
const plugin = require('..');

const { DAY, NEXT_DAY } = f;

test('rule 1 — a booking tied to a stay has no mini SAS: its stay\'s SAS covers it', async () => {
  const id = f.book();
  f.db.pragma('foreign_keys = OFF');
  f.db.prepare('UPDATE resource_bookings SET reservationId = 7 WHERE id = ?').run(id);
  f.db.pragma('foreign_keys = ON');
  for (const handler of ['getVisit', 'quote', 'commit']) {
    const res = await f.call(handler, { id });
    assert.deepEqual([res.code, res.body.code], [409, 'BOOKING_HAS_STAY'], handler);
  }
  f.db.prepare('UPDATE resource_bookings SET reservationId = NULL WHERE id = ?').run(id);
});

test('rule 5 — the first commit runs from D 00:00 to D+1 04:00 (Europe/Paris), not before, not after', async () => {
  const late = f.book();
  f.setNow(`${NEXT_DAY}T02:30:00Z`); // 03:30 in Paris, the day after
  assert.equal((await f.call('commit', { id: late, body: {} })).code, 200);
  const tooLate = f.book();
  f.setNow(`${NEXT_DAY}T03:30:00Z`); // 04:30 in Paris
  const refused = await f.call('commit', { id: tooLate, body: {} });
  assert.deepEqual([refused.code, refused.body.code, refused.body.error], [409, 'ARRIVAL_NOT_TODAY', 'Arrivée : le jour de la séance seulement.']);
  f.setNow(new Date(new Date(`${DAY}T00:00:00+01:00`).getTime() - 60000).toISOString()); // 23:59 the day before
  const early = await f.call('commit', { id: tooLate, body: {} });
  assert.equal(early.body.code, 'ARRIVAL_NOT_TODAY');
  const view = await f.call('getVisit', { id: tooLate });
  assert.deepEqual(view.body.window, { open: false, reason: 'future' });
  f.setNow(`${DAY}T15:00:00Z`);
});

test('rule 7 — the reception opens and commits inside the window, then reads only; the administrator reopens on any day', async () => {
  const id = f.book();
  const done = await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] }, user: f.RECEPTION });
  assert.equal(done.code, 200);
  f.setNow(`${NEXT_DAY}T10:00:00Z`);
  const read = await f.call('getVisit', { id, user: f.RECEPTION });
  assert.equal(read.code, 200);
  assert.deepEqual(read.body.window, { open: false, reason: 'past' });
  const closed = await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] }, user: f.RECEPTION });
  assert.deepEqual([closed.code, closed.body.code], [409, 'ARRIVAL_NOT_TODAY']);
  const pay = await f.call('pay', { id, body: { tenders: f.card(100), shortfall: { kind: 'due' } }, user: f.RECEPTION });
  assert.equal(pay.body.code, 'ARRIVAL_NOT_TODAY');
  const admin = await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] } });
  assert.equal(admin.code, 200, 'an opened visit reopens on any day for the administrator');
  f.setNow(`${DAY}T15:00:00Z`);
});

test('rule 7 — the reception sees the door money only: no refund amount, no history, no phone, no notes', async () => {
  const id = f.book({ clientPhone: '0600000000', notes: 'Note' });
  const view = (await f.call('getVisit', { id, user: f.RECEPTION })).body;
  assert.ok(!('refundOwedCents' in view.totals));
  assert.ok('remainingCents' in view.totals);
  assert.deepEqual(view.history, []);
  assert.ok(!('clientPhone' in view.booking) && !('notes' in view.booking));
  const admin = (await f.call('getVisit', { id })).body;
  assert.equal(admin.totals.refundOwedCents, 0);
  assert.equal(admin.booking.clientPhone, '0600000000');
});

test('rule 7 — a paid line, a refund confirmation and « Client absent » are the administrator\'s (403 ADMIN_ONLY)', async () => {
  const id = f.book();
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1), f.extra(f.lemonade, 1)], payment: { tenders: f.card(5000), shortfall: { kind: 'due' } } } });
  const visit = (await f.call('getVisit', { id })).body;
  const paidLine = visit.lines.find((line) => line.kind === 'session');
  const unpaid = visit.lines.find((line) => line.label === 'Limonade');
  const refused = await f.call('patchLine', { id, lineId: paidLine.id, body: { offered: true }, user: f.RECEPTION });
  assert.deepEqual([refused.code, refused.body.code, refused.body.error], [403, 'ADMIN_ONLY', 'Remboursement : réservé à l’administrateur.']);
  const confirm = await f.call('patchLine', { id, lineId: unpaid.id, body: { offered: true, confirmRefund: true }, user: f.RECEPTION });
  assert.equal(confirm.code, 403);
  const allowed = await f.call('patchLine', { id, lineId: unpaid.id, body: { offered: true }, user: f.RECEPTION });
  assert.equal(allowed.code, 200, 'an unpaid line may be offered by the reception');
  const noShow = await f.call('noShow', { id: f.book(), user: f.RECEPTION });
  assert.equal(noShow.code, 403);
});

test('rule 7 — the plugin opens the visit routes to the reception, nothing else of the booking', () => {
  const access = registry.get(plugin.id).roleAccess.reception;
  const allows = (method, path) => access.some((entry) => entry.method === method && entry.re.test(path));
  assert.ok(allows('GET', '/resource-bookings/12/visit'));
  assert.ok(allows('POST', '/resource-bookings/12/visit'));
  assert.ok(allows('POST', '/resource-bookings/12/visit/quote'));
  assert.ok(allows('POST', '/resource-bookings/12/visit/payment'));
  assert.ok(allows('PATCH', '/resource-bookings/12/visit/lines/3'));
  assert.ok(allows('POST', '/resource-bookings/12/visit/payment-link'));
  assert.ok(allows('POST', '/resource-bookings/12/visit/payment-link/4/email'));
  assert.ok(allows('DELETE', '/resource-bookings/12/visit/payment-link/4'));
  assert.ok(!allows('POST', '/resource-bookings/12/no-show'));
  assert.ok(!allows('POST', '/resource-bookings/12/payment'));
  assert.ok(!allows('DELETE', '/resource-bookings/12'));
  assert.ok(!allows('GET', '/resource-bookings/12'));
});
