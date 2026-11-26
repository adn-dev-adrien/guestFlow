// specs/sas/outside-booking-sas.md rule 27 (loop t1 UI-9) — the booking payload says whether « Client absent » can be asked now: an administrator, from the session's
// day on (the server's clock), never the reception, never a visit already absent.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');
const { createController } = require('../controller');
const { todayIso } = require('../../../utils/localDate');

const controller = createController({ bookings: () => f.bookings, invoicing: () => f.invoicing });
async function getOne(id, user) {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.getOne({ params: { id: String(id) }, user }, res);
  return res.body;
}

test('UI-9 — today an administrator may mark the client absent, the reception may not; a future session offers it to nobody', async () => {
  const today = f.book({ date: todayIso() });
  assert.equal((await getOne(today, f.ADMIN)).actions.noShow, true);
  assert.equal((await getOne(today, f.RECEPTION)).actions.noShow, false);
  const later = f.book();
  assert.equal((await getOne(later, f.ADMIN)).actions.noShow, false);
  f.db.prepare("UPDATE resource_bookings SET noShowAt = datetime('now') WHERE id = ?").run(today);
  assert.equal((await getOne(today, f.ADMIN)).actions.noShow, false);
});
