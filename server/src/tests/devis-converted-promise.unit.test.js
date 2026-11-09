// specs/deposit-blocks-the-dates.md rules 21 and 22, specs/payment-schedule-and-cancellation.md rule 57 (audit R34-RES-L1,
// R34-RES-L2). The reservation converted from a devis reads its promise on the devis row (D23 conversion):
// - L1: deleting that devis while its stay exists dropped the promise in silence — the next priced save of the stay
//   took an acompte the guest was never asked for, and an earlier deadline. The delete is now refused.
// - L2: a direct devis with no acompte owes ONE payment due on its validity date (deposit-blocks-the-dates rule 7),
//   inside or outside the D23 window. Outside it, the stay lost that deadline at its first priced save (the
//   reservation date start − balanceDaysBefore replaced it). The stay now keeps it for the dates quoted.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const f = require('./ledgerFixture');
const devisModel = require('../models/devisModel');
const { todayIso } = require('../utils/localDate');

const { db, inDays } = f;
const TODAY = todayIso();
f.seed();
// Property 3: no acompte (the « Acompte » switch off, as both production logements).
db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled,
    depositPercent, defaultCautionAmount, balanceDaysBefore)
  VALUES (3, 'Cabane', 8, 'per_day_per_person', 1.2, 0, 30, 0, 30)`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (3, 'Standard', 100)").run();
db.prepare('UPDATE app_settings SET quoteValidityDays = 15 WHERE id = 1').run();

const pick = (r) => ({
  depositAmount: Number(r.depositAmount || 0),
  depositDueDate: r.depositDueDate || null,
  balanceDueDate: r.balanceDueDate || null,
});
const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));
const devisBody = (startIn, propertyId) => f.stayBody({ propertyId, startDate: inDays(startIn), endDate: inDays(startIn + 2) });
test.beforeEach(() => {
  db.prepare("DELETE FROM reservation_nights WHERE reservationId IN (SELECT id FROM reservations WHERE kind != 'devis')").run();
  db.prepare("DELETE FROM reservations WHERE kind != 'devis'").run();
});

function convert(startIn, propertyId) {
  const id = devisModel.create(devisBody(startIn, propertyId)).data.id;
  const devis = rowOf(id);
  const converted = devisModel.convertToReservation(id);
  assert.ok(converted.ok, JSON.stringify(converted));
  return { id, devis, rid: converted.data.reservationId };
}

test('R34-RES-L1 — a converted devis whose stay exists cannot be deleted; its stay keeps the single payment', async () => {
  const { id, devis, rid } = convert(35, 1);
  assert.deepEqual(pick(rowOf(rid)), { depositAmount: 0, depositDueDate: null, balanceDueDate: devis.validUntil });
  const refused = devisModel.remove(id);
  assert.equal(refused.status, 409);
  assert.equal(refused.code, 'DEVIS_HOLDS_PROMISE');
  assert.equal(refused.error, "Ce devis porte l'échéance de la réservation qui en est issue : il ne peut pas être supprimé.");
  assert.ok(rowOf(id), 'the devis is kept');
  const saved = await f.save(rid, { adults: 3 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual(pick(rowOf(rid)), { depositAmount: 0, depositDueDate: null, balanceDueDate: devis.validUntil });
});

test('R34-RES-L1 — once its stay is gone, the converted devis can be deleted; an unconverted one always could', () => {
  const { id, rid } = convert(37, 1);
  db.prepare('DELETE FROM reservation_nights WHERE reservationId = ?').run(rid);
  db.prepare('DELETE FROM reservations WHERE id = ?').run(rid);
  assert.ok(devisModel.remove(id).ok);
  const open = devisModel.create(devisBody(39, 1)).data.id;
  assert.ok(devisModel.remove(open).ok);
});

test('R34-RES-L2 — outside the D23 window, a converted no-acompte devis keeps its deadline across priced saves', async () => {
  const { devis, rid } = convert(100, 3);
  const promised = { depositAmount: 0, depositDueDate: null, balanceDueDate: devis.validUntil };
  assert.deepEqual(pick(devis), promised, 'the devis owes one payment on its validity date (rule 7)');
  assert.ok(devis.validUntil < inDays(70), 'outside the window: the reservation rule would say start − 30');
  assert.deepEqual(pick(rowOf(rid)), promised, 'conversion');
  assert.deepEqual(pick(await f.liveQuote(rid, { adults: 3 })), promised, 'the live quote of a priced change');
  const saved = await f.save(rid, { adults: 3 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual(pick(rowOf(rid)), promised, 'the priced save');
});

test('R34-RES-L2 — moved to other dates the stay takes the reservation rule; moved back it keeps the promise again', async () => {
  const { devis, rid } = convert(110, 3);
  const moved = await f.save(rid, { startDate: inDays(150), endDate: inDays(152) });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  assert.equal(rowOf(rid).balanceDueDate, inDays(120));
  const back = await f.save(rid, { startDate: inDays(110), endDate: inDays(112) });
  assert.equal(back.statusCode, 200, JSON.stringify(back.body));
  assert.equal(rowOf(rid).balanceDueDate, devis.validUntil);
});

test('R34-RES-L2 — an expired no-acompte devis converted late owes its payment from today, and its save agrees', async () => {
  const id = devisModel.create(devisBody(120, 3)).data.id;
  db.prepare('UPDATE reservations SET validUntil = ?, balanceDueDate = ? WHERE id = ?').run(inDays(-3), inDays(-3), id);
  const rid = devisModel.convertToReservation(id).data.reservationId;
  assert.equal(rowOf(rid).balanceDueDate, TODAY);
  const saved = await f.save(rid, { adults: 3 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(rowOf(rid).balanceDueDate, TODAY);
});

test('R34-RES-L2 — a devis converted with an acompte outside the window keeps the reservation rules (unchanged)', async () => {
  const { devis, rid } = convert(100, 1);
  assert.ok(devis.depositAmount > 0);
  const saved = await f.save(rid, { adults: 3 });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const row = rowOf(rid);
  assert.ok(row.depositAmount > 0);
  assert.equal(row.balanceDueDate, inDays(70));
});
