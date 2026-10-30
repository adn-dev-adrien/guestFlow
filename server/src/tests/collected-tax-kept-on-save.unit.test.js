// specs/tourist-tax-matches-the-office-calculation.md rule 17 (spec review 2026-10-27) — a tourist tax
// already collected is pinned by the SAVE exactly like by the preview: a later rate change, or a guest
// added after the money came in, never rewrites what the guest paid.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');

function markBalancePaid(id) {
  const res = f.respond();
  f.controller.updatePayment({ params: { id: String(id) }, body: { balancePaid: true, balancePaidDate: '2026-10-01' }, user: f.ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}

test('a notes-only save after the rate went up keeps the collected tax', async () => {
  f.seed();
  f.db.prepare("UPDATE properties SET touristTaxMode = 'per_day_per_person', touristTaxPerDayPerPerson = 1.5 WHERE id = 1").run();
  const id = f.createStay({ startDate: f.inDays(250), endDate: f.inDays(253) });
  const collected = f.rowOf(id).touristTaxTotal;
  assert.equal(collected, 9);
  markBalancePaid(id);
  f.db.prepare('UPDATE properties SET touristTaxPerDayPerPerson = 2 WHERE id = 1').run();

  const res = await f.save(id, { notes: 'Arrivée tardive' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(f.rowOf(id).touristTaxTotal, collected);
});

test('« Recalculer la taxe de séjour » still re-prices it on purpose', async () => {
  const id = f.createStay({ startDate: f.inDays(259), endDate: f.inDays(262) });
  markBalancePaid(id);
  f.db.prepare('UPDATE properties SET touristTaxPerDayPerPerson = 3 WHERE id = 1').run();
  const res = await f.save(id, { refreshTouristTax: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(f.rowOf(id).touristTaxTotal, 18);
});
