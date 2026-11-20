// specs/pricing-components.md §3 rule 102, specs/guest-app.md rule 110 a (stabilisation loop t5, S5-6, 2026-11-16) — « the arrival is still open
// at the door » is ONE judge (`extraSale.arrivalOpenAt`), and its reading of the validation is the stay clock's: the check-in box or the
// committed SAS count from the arrival day only. Before: the judge read the raw flags, so a box ticked days ahead said « closed » while the
// `atArrival` sale it answers for was accepted into the arrival complement.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const beers = [{ articleRef: `option:${beer}`, quantity: 1 }];

function tickedEarly(column) {
  const id = stay(10);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }).status, 200);
  db.prepare(`UPDATE reservations SET ${column} = ? WHERE id = ?`).run(column === 'checkInDone' ? 1 : '2026-01-01 09:00:00', id); // date-literal-ok: a stored SAS stamp, only its presence is read
  return id;
}

for (const column of ['checkInDone', 'arrivalSasDoneAt']) {
  test(`S5-6 — ${column} set three days ahead: the judge reads the arrival open and the atArrival sale lands in the arrival complement`, () => {
    const id = tickedEarly(column);
    const now = at(id, '12:00', -3);
    assert.equal(extraSale.arrivalOpenAt(id, now), true);
    const sold = extraSale.sell(id, beers, { now, atArrival: true });
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    assert.equal(Math.round(Number(row(id).complementAmount) * 100), 600);
  });

  test(`S5-6 — ${column} on the arrival day: the judge reads it closed and the atArrival sale is refused ARRIVAL_CLOSED, both at once`, () => {
    const id = tickedEarly(column);
    const now = at(id, '11:00');
    assert.equal(extraSale.arrivalOpenAt(id, now), false);
    const refused = extraSale.sell(id, beers, { now, atArrival: true });
    assert.deepEqual([refused.status, refused.body.code], [409, 'ARRIVAL_CLOSED']);
  });
}
