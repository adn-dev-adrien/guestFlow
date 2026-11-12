// specs/pricing-components.md §3 rule 55 (SDK 2.28.0) — the sale service publishes what happened after its transaction commits: `extraSale.sold`,
// `extraSale.lineMoved`, `extraSale.lineCancelled` (a save removed lines), `extraSale.refundOwed` (a confirmed lowering of a paid line). A handler that throws
// is logged and never undoes the sale; a refused sale publishes nothing.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const extraSale = require('../utils/extraSale');
const controller = require('../controllers/reservationsController');
const model = require('../models/reservationsModel');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { EVENTS } = require('../plugins/sdk/eventBus');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9261, 'Evenements', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9261, 'Camille', 'Evenement')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9261, 'Standard', 100)").run();
const bath = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Bain nordique', 40, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9261, ?)').run(bath);

const seen = [];
registry.configure({ isActive: () => true, allows: () => true });
const ctx = createContext('observer', {});
for (const name of ['extraSale.sold', 'extraSale.lineMoved', 'extraSale.lineCancelled', 'extraSale.refundOwed']) ctx.events.on(name, (payload) => { seen.push([name, payload]); });
createContext('broken', {}).events.on('extraSale.sold', () => { throw new Error('observer down'); });

const settle = () => new Promise((resolve) => { setImmediate(() => setImmediate(resolve)); });
let offset = 40;
function stay() {
  offset += 7;
  const startDate = addDaysToIsoDate(todayIso(), offset);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime)
    VALUES (9261, 9261, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00')`).run(startDate, addDaysToIsoDate(startDate, 3)).lastInsertRowid);
}
const request = [{ articleRef: `option:${bath}`, quantity: 1 }];
const only = (name) => seen.filter(([n]) => n === name).map(([, payload]) => payload);

test('rule 55 — the four events are part of the bus, and a plugin may not emit them itself', () => {
  for (const name of ['extraSale.sold', 'extraSale.lineMoved', 'extraSale.lineCancelled', 'extraSale.refundOwed']) assert.ok(EVENTS.includes(name), name);
  assert.throws(() => ctx.events.emit('extraSale.sold', {}), /may not emit/);
});

test('rule 55 — a sale publishes extraSale.sold with its lines after it commits, whatever an observer does', async () => {
  const id = stay();
  const result = extraSale.sell(id, request, { source: 'fiche' });
  assert.equal(result.status, 200);
  await settle();
  const [sold] = only('extraSale.sold');
  assert.equal(sold.reservationId, id);
  assert.equal(sold.source, 'fiche');
  assert.deepEqual(sold.lines.map((l) => [l.label, l.totalCents, l.collectAt]), [['Bain nordique', 4000, 'arrival']]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 1, 'the sale stands though one observer threw');
});

test('rule 55 — a refused sale publishes nothing', async () => {
  const id = stay();
  const before = seen.length;
  assert.equal(extraSale.sell(id, request, { acceptedTotalCents: 1 }).status, 409);
  await settle();
  assert.equal(seen.length, before);
});

test('rule 55 — moving a line publishes extraSale.lineMoved with both moments', async () => {
  const id = stay();
  const sold = extraSale.sell(id, request);
  const ref = sold.saleDetail.lines.find((l) => l.label === 'Bain nordique').ref;
  seen.length = 0;
  assert.equal(extraSale.changeLine(id, ref, { collectAt: 'departure' }).status, 200);
  await settle();
  assert.deepEqual(only('extraSale.lineMoved'), [{ reservationId: id, ref, from: 'arrival', to: 'departure' }]);
});

test('rule 55 — a save that removes a line publishes extraSale.lineCancelled', async () => {
  const id = stay();
  const sold = extraSale.sell(id, request);
  const ref = sold.saleDetail.lines.find((l) => l.label === 'Bain nordique').ref;
  seen.length = 0;
  const body = { ...toUpdateBody(model.getByIdWithDetails(id)), forceOverpayment: true };
  body.options = []; body.selectedOptions = [];
  assert.equal(controller.performUpdate(String(id), body).status, 200);
  await settle();
  assert.deepEqual(only('extraSale.lineCancelled'), [{ reservationId: id, refs: [ref] }]);
});

test('rule 55 — lowering a paid line, once confirmed, publishes extraSale.refundOwed with the excess', async () => {
  const start = addDaysToIsoDate(todayIso(), 40);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime,
      balanceAmount, balancePaid, balancePaidDate, accommodationSoldeContribTtc)
    VALUES (9261, 9261, ?, ?, 'direct', 2, 300, 340, 'reservation', '15:00', 340, 1, '2026-11-01', 300)`).run(start, addDaysToIsoDate(start, 3)).lastInsertRowid);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement, soldeContribTtc)
    VALUES (?, ?, 1, 40, 1, 'per_stay', 40, 0, 0, 40)`).run(id, bath);
  require('../utils/paymentAllocationsSync').syncStay(db, id);
  const ref = `option:${db.prepare('SELECT lineId FROM reservation_options WHERE reservationId = ?').get(id).lineId}`;
  seen.length = 0;
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }).body.code, 'OVERPAID');
  await settle();
  assert.deepEqual(only('extraSale.refundOwed'), []);
  assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 10 } }, { forceOverpayment: true }).status, 200);
  await settle();
  assert.deepEqual(only('extraSale.refundOwed'), [{ reservationId: id, ref, cents: 1000 }]);
});
