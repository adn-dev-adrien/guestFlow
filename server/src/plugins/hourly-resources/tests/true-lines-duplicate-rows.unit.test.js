// specs/pricing-components.md §3 rule 85 — the hourly-resources plugin on a stay holding TWO lines of one resource: a tick lands on its own
// line, the SAS « Planifier » write replaces the resource's sessions once, the hours of the lines add up.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stayWithTwoSales } = require('../../../tests/trueLinesFixture');

test('rule 85 (LINE: hourly planning cards, SAS step) — sessions are ticked on their own line and replaced as one set on the first line', () => {
  const resourceId = Number(db.prepare("INSERT INTO resources (name, priceType, price, showsPlanningCard) VALUES ('Sauna', 'per_hour', 20, 1)").run().lastInsertRowid);
  const id = stayWithTwoSales();
  const insert = db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, sessions) VALUES (?, ?, 2, 20, 2, 'per_hour', 40, ?)");
  insert.run(id, resourceId, JSON.stringify([{ date: '2030-03-01', start: '10:00', end: '11:00' }]));
  insert.run(id, resourceId, JSON.stringify([{ date: '2030-03-02', start: '10:00', end: '11:00' }]));
  const [one, two] = db.prepare('SELECT lineId FROM reservation_resources WHERE reservationId = ? ORDER BY lineId').all(id);
  const { buildModel } = require('../planningCardsModel');
  const cards = buildModel(db);
  const day = cards.cardsInRange({ from: '2030-03-01', to: '2030-03-02' });
  assert.deepEqual([day['2030-03-01'], day['2030-03-02']].map((d) => d.items.filter((i) => i.reservationId === id && i.kind === 'session').map((i) => i.lineId)), [[one.lineId], [two.lineId]]);
  assert.deepEqual(cards.setSessionDone({ reservationId: id, resourceId, date: '2030-03-02', start: '10:00', done: true, kind: 'session' }), { ok: true, done: true });
  const doneOf = (lineId) => JSON.parse(db.prepare('SELECT sessions FROM reservation_resources WHERE lineId = ?').get(lineId).sessions).map((s) => Boolean(s.done));
  assert.deepEqual([doneOf(one.lineId), doneOf(two.lineId)], [[false], [true]], 'the second line holds the session, the first is untouched');
  const { createSasStep } = require('../sasStep');
  const step = createSasStep({ scheduling: () => ({}), reservations: {} });
  step.hook.write(db, { id }, { resourceIds: [resourceId], blocks: [{ resourceId, date: '2030-03-05', start: '09:00', end: '10:00' }, { resourceId, date: '2030-03-04', start: '09:00', end: '10:00' }] });
  const sessions = (lineId) => JSON.parse(db.prepare('SELECT sessions FROM reservation_resources WHERE lineId = ?').get(lineId).sessions).map((s) => s.date);
  assert.deepEqual([sessions(one.lineId), sessions(two.lineId)], [['2030-03-04', '2030-03-05'], []], 'one set, written once: no session counted on both lines');
});

test('rule 85 (AGG: resourceOtherUsesModel, schedulingModel) — the sessions of a resource are those of every line that sold it; the hours add up', () => {
  const resourceId = Number(db.prepare("INSERT INTO resources (name, priceType, price, showsPlanningCard) VALUES ('Spa', 'per_hour', 30, 1)").run().lastInsertRowid);
  const id = stayWithTwoSales();
  const insert = db.prepare("INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, sessions) VALUES (?, ?, ?, 30, ?, 'per_hour', ?, ?)");
  insert.run(id, resourceId, 2, 2, 60, JSON.stringify([{ date: '2030-04-01', start: '10:00', end: '11:00' }]));
  insert.run(id, resourceId, 1, 1, 30, JSON.stringify([{ date: '2030-04-02', start: '10:00', end: '11:00' }]));
  const uses = require('../../../models/resourceOtherUsesModel');
  assert.deepEqual(uses.storedSessions({ reservationId: id, resourceId }).map((s) => s.date), ['2030-04-01', '2030-04-02']);
  const sold = require('../schedulingModel').create(db).soldSchedulableResources(db.prepare('SELECT * FROM reservations WHERE id = ?').get(id));
  assert.equal(sold.length, 1, 'one entry per resource, not per line');
  assert.deepEqual([sold[0].hoursSold, sold[0].hoursPlaced, sold[0].hoursRemaining, sold[0].sessions.length], [3, 2, 1, 2]);
});
