// specs/pricing/pricing-components.md §3 rule 103 (stabilisation loop t3, T3-4, 2026-11-16) — a line the fiche's own save writes is stamped where the engine
// put its money: beyond a settled plan (the arrival complement takes the excess) it reads « À payer à l’arrivée » and the arrival SAS lists it; above
// the baseline of a started stay it reads « À payer au départ ». Stays booked 20 days ahead (`saleRound1Fixtures`, check-in 15:00).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const reservations = require('../models/reservationsModel');
const controller = require('../controllers/reservationsController');
const extraSalesModel = require('../models/extraSalesModel');
const { stampFicheLines } = require('../utils/pricingLinesMigration');
const { storedBody } = require('../utils/stayOrderLines');
const { withNow } = require('../utils/localDate');

const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);

// The fiche's PUT path: performUpdate, then the stamp of the lines it wrote with the buckets it started from.
function ficheAdds(id, now, line) {
  const before = extraSalesModel.lineIds(id);
  const rowBefore = row(id);
  const body = storedBody(id);
  body.customOptions = [...(body.customOptions || []), { customKey: 'custom_new', description: line.label, amount: line.amount, offered: false }];
  const saved = withNow(now, () => controller.performUpdate(id, body, { now }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  stampFicheLines(db, id, now.toISOString(), before, { rowBefore });
  return extraSale.saleDetailOf(id, now).lines.find((l) => l.label === line.label);
}

test('T3-4 — balance paid, the fiche adds a line before the arrival: the money and the line are the arrival\'s', () => {
  const id = stay(20);
  db.prepare('UPDATE reservations SET depositAmount = 0, balanceAmount = 300, balancePaid = 1, balancePaidDate = startDate WHERE id = ?').run(id);
  const now = at(id, '12:00', -3);
  const line = ficheAdds(id, now, { label: 'Bière locale', amount: 5 });
  assert.equal(Math.round(row(id).complementAmount * 100), 500);
  assert.deepEqual([line.collectAt, line.statusLabel], ['arrival', 'À payer à l’arrivée']);
  const plan = withNow(now, () => reservations.planArrivalSas(id, {}));
  assert.deepEqual(plan.lines.map((l) => [l.label, l.billed]), [['Bière locale', 5]]);
  assert.equal(extraSale.arrivalComplementDetailOf(id, now).detail.some((d) => d.label === 'Bière locale'), true);
});

test('T3-4 — a started stay: the fiche\'s new line is carved out to the departure and reads so', () => {
  const id = stay(20);
  db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
  const now = at(id, '12:00', 1);
  const line = ficheAdds(id, now, { label: 'Bière locale', amount: 5 });
  assert.equal(Math.round(row(id).endOfStayComplementAmount * 100), 500);
  assert.equal(line.collectAt, 'departure');
});
