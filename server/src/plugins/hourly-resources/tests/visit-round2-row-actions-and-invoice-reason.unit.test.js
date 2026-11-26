// specs/sas/outside-booking-sas.md rule 51 (rules 6, 27, 48; loop t2 UI2-5, UI2-6, UI2-7) — every booking payload carries its `actions` ({ noShow, arrive }) judged on the server's clock:
// the rows of the resource planning and of the planning's cards (the reception's projection keeps them), and the answer of « Client absent »; the screens compare no
// date and read the booking again for nothing. The invoiceability marks `silent` the refusals that state no step for the operator (no Qonto, nothing to invoice).
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');
const { createController } = require('../controller');
const { createVisitController } = require('../visitController');
const { todayIso } = require('../../../utils/localDate');
const { FAR_YEAR } = require('../../../tests/farYearFixture');

const controller = createController({ bookings: () => f.bookings, invoicing: () => f.invoicing });
const visitController = createVisitController({
  bookings: () => f.bookings, visits: () => f.visits, invoicing: () => f.invoicing, bookingPayload: (booking, req) => controller.bookingPayload(booking, req),
});
async function run(handler, req, on = controller) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await on[handler]({ params: {}, query: {}, body: {}, ...req }, res);
  return res;
}
const resourceOf = (id) => f.row(id).resourceId;

test('UI2-6, UI2-7 — the resource planning rows carry `actions`: today « Arrivée » and « Client absent » for the administrator, a later day neither', async () => {
  const today = f.book({ date: todayIso() });
  const later = f.book({ date: `${FAR_YEAR}-03-20` });
  const rowsOf = async (id, date, user = f.ADMIN) => (await run('list', { query: { resourceId: String(resourceOf(id)), date }, user })).body.filter((r) => r.kind === 'booking');
  assert.deepEqual((await rowsOf(today, todayIso()))[0].actions, { noShow: true, arrive: true });
  assert.deepEqual((await rowsOf(today, todayIso(), f.RECEPTION))[0].actions, { noShow: false, arrive: true }, 'the reception arrives the guest, never marks him absent');
  assert.deepEqual((await rowsOf(later, `${FAR_YEAR}-03-20`))[0].actions, { noShow: false, arrive: false });
});

test('UI2-7 — the planning cards carry `actions.arrive`, for the reception too; an arrived or absent visit is not offered the arrival', async () => {
  const id = f.book({ date: todayIso() });
  const eventOf = async (user) => (await run('planningEvents', { query: { from: todayIso(), to: todayIso() }, user })).body.find((e) => e.id === id);
  assert.equal((await eventOf(f.ADMIN)).actions.arrive, true);
  assert.deepEqual((await eventOf(f.RECEPTION)).actions, { noShow: false, arrive: true });
  f.db.prepare("UPDATE resource_bookings SET arrivedAt = datetime('now') WHERE id = ?").run(id);
  assert.equal((await eventOf(f.ADMIN)).actions.arrive, false);
});

test('UI2-6 — « Client absent » answers the booking with its `actions`: nothing is offered any more', async () => {
  const id = f.book({ date: todayIso() });
  const out = await run('noShow', { params: { id: String(id) }, user: f.ADMIN }, visitController);
  assert.equal(out.code, 200);
  assert.ok(out.body.booking.noShowAt);
  assert.deepEqual(out.body.booking.actions, { noShow: false, arrive: false });
});

test('UI2-5 — a paid visit on an install without Qonto: the refusal is silent; a reste still due is not', async () => {
  f.setIssuer(null);
  const paid = f.book();
  const quiet = (await f.call('commit', { id: paid, body: { extras: [f.extra(f.beer, 2)], payment: { tenders: f.card(6300) } } })).body.visit.invoiceable;
  assert.deepEqual([quiet.ok, quiet.code, quiet.silent], [false, 'ISSUER_UNAVAILABLE', true]);
  const due = f.book();
  const owing = (await f.call('commit', { id: due, body: { extras: [f.extra(f.beer, 2)] } })).body.visit.invoiceable;
  assert.deepEqual([owing.ok, owing.code, owing.silent], [false, 'REMAINING_DUE', false]);
});
