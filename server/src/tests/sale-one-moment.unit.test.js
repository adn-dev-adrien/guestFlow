// specs/pricing/pricing-components.md §3 rule 102 (stabilisation loop t2, N-1 to N-6, 2026-11-16) — one moment per gesture: the stay clock decides the fiche
// lock, the moment of a sale, the extras baseline, the arrival SAS and the change of an order at the door, at the `now` the caller injects (the wall
// clock of this suite is weeks before the stays). Every stay below is booked 20 days ahead (`saleRound1Fixtures`, check-in 15:00).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, stay, row, beer, addDaysToIsoDate,
} = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const reservations = require('../models/reservationsModel');
const stayClockModel = require('../models/stayClockModel');
const { withNow } = require('../utils/localDate');
const { storedBody } = require('../utils/stayOrderLines');
const controller = require('../controllers/reservationsController');

// The stay's own day at `hh:mm`, Paris (`offset` days from its arrival).
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const cents = (value) => Math.round(Number(value || 0) * 100);
const money = (id) => {
  const r = row(id);
  return { final: cents(r.finalPrice), arrival: cents(r.complementAmount), departure: cents(r.endOfStayComplementAmount) };
};
const customRows = (id) => db.prepare('SELECT lineId, description, amount, fulfilmentRef FROM reservation_custom_options WHERE reservationId = ? ORDER BY lineId').all(id);

test('N-1 — a card order paid before the arrival is not asked again once the check-in hour has passed: detail, SAS plan and commit ask 0', () => {
  const id = stay(20);
  const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Bain nordique — supplément soirée', amount: 20 }], {
    source: 'shop', now: at(id, '12:00', -3), orderRef: 'order:1:1', paid: { amountCents: 2000, ref: '1' },
  });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.deepEqual([sold.settledCents, money(id).arrival], [2000, 0]);
  const late = at(id, '17:00');
  assert.equal(stayClockModel.phaseForReservation(id, late).started, true);
  assert.equal(extraSale.saleDetailOf(id, late).buckets.arrival, 0, 'the paid line is not back in the arrival bucket');
  assert.equal(extraSale.arrivalComplementDetailOf(id, late).amount, 0);
  const plan = withNow(late, () => reservations.planArrivalSas(id, {}));
  assert.deepEqual([plan.arrivalComplementTotal, plan.lines.length], [0, 0], 'the SAS lists nothing to collect for the paid line');
  withNow(late, () => reservations.commitArrivalSas(id, { complementItems: [] }));
  assert.equal(money(id).arrival, 0, 'the commit writes no complement for what the card paid');
});

test('N-1 — the baseline laid once the stay has started nets the card money: a later sale still moves only its line', () => {
  const id = stay(20);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], {
    source: 'shop', now: at(id, '12:00', -3), orderRef: 'order:2:1', paid: { amountCents: 600, ref: '2' },
  }).status, 200);
  const before = money(id);
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: at(id, '18:00') });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const after = money(id);
  assert.deepEqual([after.final - before.final, after.arrival - before.arrival, after.departure - before.departure], [600, 0, 600]);
});

test('N-2 — past the check-in hour, arrival not validated: an unpaid order line is removed and re-sold into the arrival complement (core clock = injected)', () => {
  const id = stay(20);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 2 }], { source: 'shop', now: at(id, '12:00', -3), orderRef: 'order:3:1' }).status, 200);
  assert.equal(money(id).arrival, 1200);
  const door = at(id, '18:00');
  const line = extraSale.saleDetailOf(id, door).lines.find((l) => l.label === 'Bière ronde');
  const removed = extraSale.removeLine(id, line.ref, { now: door });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.notEqual(row(id).arrivalExtrasBaseline, null, 'the core saw 18:00 on the arrival day, not the wall clock: the stay has started');
  const resold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 3 }], { source: 'shop', now: door, atArrival: true, orderRef: 'order:3:101' });
  assert.equal(resold.status, 200, JSON.stringify(resold.body));
  assert.deepEqual(money(id), { final: 30000 + 1800, arrival: 1800, departure: 0 }, 'all of it in the arrival complement, nothing at the departure');
  const kept = resold.saleDetail.lines.find((l) => l.label === 'Bière ronde');
  assert.deepEqual([kept.collectAt, resold.saleDetail.buckets.arrival, resold.saleDetail.buckets.departure], ['arrival', 1800, 0]);
  assert.equal(extraSale.departureSalesOf(id, door), null);
});

test('N-2 — once the arrival is validated, the arrival lines are frozen again', () => {
  const id = stay(20);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { source: 'shop', now: at(id, '12:00', -3), orderRef: 'order:4:1' }).status, 200);
  db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
  const door = at(id, '18:00');
  const line = extraSale.saleDetailOf(id, door).lines.find((l) => l.label === 'Bière ronde');
  const refused = extraSale.removeLine(id, line.ref, { now: door });
  assert.deepEqual([refused.status, refused.body.code], [400, 'ARRIVAL_EXTRAS_FROZEN']);
});

test('N-3 — an arrival marked before its hour starts the stay for the lock and the sale alike: the sale moves only its line, and it can be undone', () => {
  const id = stay(20);
  db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
  const early = at(id, '13:00');
  assert.equal(stayClockModel.phaseForReservation(id, early).started, true, 'the stay clock reads the validated arrival');
  assert.equal(extraSale.collectionOf(id, early), 'departure');
  const before = money(id);
  const quoted = extraSale.quote(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: early });
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: early, acceptedTotalCents: quoted.totalCents });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  const after = money(id);
  assert.deepEqual([quoted.totalCents, quoted.buckets.departure, after.final - before.final, after.departure - before.departure, after.arrival - before.arrival], [600, 600, 600, 600, 0]);
  const line = sold.saleDetail.lines.find((l) => l.label === 'Bière ronde');
  assert.equal(line.collectAt, 'departure');
  const removed = extraSale.removeLine(id, line.ref, { now: early });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(money(id), before);
});

test('N-3 — not marked before its hour: the sale is the arrival\'s, and the fiche is not locked', () => {
  const id = stay(20);
  const early = at(id, '13:00');
  assert.equal(stayClockModel.phaseForReservation(id, early).started, false);
  const sold = extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: early });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  assert.equal(money(id).arrival, 600);
  const edit = reservations.getEditLock(id, { today: row(id).startDate, nowTime: '13:00', now: early });
  assert.equal(edit.locked, false);
});

test('N-4 — a SAS item under a label the shop already sold is numbered: distinct refs, both paid once the complement is collected', () => {
  const id = stay(20);
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Bière locale', amount: 5 }], { source: 'shop', now: at(id, '12:00', -3) }).status, 200);
  const door = at(id, '14:00');
  withNow(door, () => reservations.commitArrivalSas(id, { complementItems: [{ label: 'Bière locale', amount: 5 }], complementSettled: true, complementPaidCash: false }));
  assert.deepEqual(customRows(id).map((r) => r.description), ['Bière locale', 'Bière locale (2)']);
  const detail = extraSale.saleDetailOf(id, door).lines.filter((l) => /Bière locale/.test(l.label));
  assert.equal(new Set(detail.map((l) => l.ref)).size, 2);
  assert.deepEqual(detail.map((l) => [l.totalCents, l.settledCents]), [[500, 500], [500, 500]]);
  withNow(door, () => reservations.commitArrivalSas(id, { complementItems: [{ label: 'Bière locale', amount: 5 }] }));
  assert.deepEqual(customRows(id).map((r) => r.description), ['Bière locale', 'Bière locale (2)'], 'a re-run finds its own numbered line again');
});

test('N-4 — the fiche\'s save numbers a new custom line under a label the stay holds; stored lines keep theirs', () => {
  const id = stay(20);
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Bière locale', amount: 5 }], { now: at(id, '12:00', -3) }).status, 200);
  const body = storedBody(id);
  body.customOptions = [...body.customOptions, { customKey: 'custom_new', description: 'Bière locale', amount: 5, offered: false }];
  const saved = withNow(at(id, '12:00', -3), () => controller.performUpdate(id, body));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(customRows(id).map((r) => r.description).sort(), ['Bière locale', 'Bière locale (2)']);
  const again = withNow(at(id, '12:00', -3), () => controller.performUpdate(id, storedBody(id)));
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.deepEqual(customRows(id).map((r) => r.description).sort(), ['Bière locale', 'Bière locale (2)'], 'a plain save renames nothing');
});

test('N-6 — a sold custom line carries its seller\'s stable key, whatever label it was numbered under', () => {
  const id = stay(20);
  const request = { articleRef: 'custom', label: 'Bain — supplément soirée', amount: 20, fulfilmentRef: 'evening:resource:7' };
  for (const n of [1, 2]) assert.equal(extraSale.sell(id, [request], { source: 'shop', now: at(id, '12:00', -3), orderRef: `order:${10 + n}:1` }).status, 200);
  assert.deepEqual(customRows(id).map((r) => [r.description, r.fulfilmentRef]), [
    ['Bain — supplément soirée', 'evening:resource:7'], ['Bain — supplément soirée (2)', 'evening:resource:7'],
  ]);
  const summed = db.prepare("SELECT SUM(amount) AS s FROM reservation_custom_options WHERE reservationId = ? AND orderRef LIKE 'order:%' AND fulfilmentRef = ?").get(id, 'evening:resource:7').s;
  assert.equal(summed, 40, 'the key reads both supplements (the bare label read 20 of 40)');
});
