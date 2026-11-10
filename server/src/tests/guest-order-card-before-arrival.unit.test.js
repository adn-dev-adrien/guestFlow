// specs/guest-app.md rule 85 (« Mon séjour » from J-7, amended 2026-11-10, Q13) — an order paid by card BEFORE the arrival
// is committed by the core on the arrival path of rule 66 and its money is recorded as a settled note of the arrival
// moment. The engine reads the arrival complement net of those notes on every pricing, never below 0, so the arrival SAS
// never collects it again, and a later save of the fiche never raises it back.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();

const db = require('../database');
const { commitOrder, priceOrder, orderCollection } = require('../utils/midStayOrderCommit');
const reservations = require('../models/reservationsModel');
const { splitComplementBuckets } = require('../utils/complementBuckets');
const { settledByKey, arrivalPrepaid } = require('../utils/midStayExtras');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (102, 'Cidre', 6, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 102)').run();

function seedStay(start = 5) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 400, 0, 400, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1)`)
    .run(isoPlus(start), isoPlus(start + 4), isoPlus(start)).lastInsertRowid);
  for (let i = start; i < start + 4; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  return id;
}
const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const paid = (amountCents, reference) => ({ amountCents, paidDate: isoPlus(0), reference });

test('rule 85: a card order before the arrival is committed, its money is an arrival-moment note and the complement owes nothing for it', () => {
  const id = seedStay();
  const result = commitOrder(id, { ...named(1), lines: [{ kind: 'option', id: 102, quantity: 2 }], paid: paid(1200, 'pay_1') });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual([result.collectAt, result.settledCents, result.excessCents], ['arrival', 1200, 0]);
  const notes = JSON.parse(row(id).midStaySettledNotes);
  assert.equal(notes.length, 1);
  assert.deepEqual([notes[0].moment, notes[0].total, notes[0].paidCash, notes[0].reference, notes[0].source, notes[0].ref], ['arrival', 12, 0, 'pay_1', 'shopOrder', '1']);
  assert.deepEqual(notes[0].lines.map((l) => [l.key, l.amount, l.label]), [['opt:102', 12, 'Cidre']]);
  assert.equal(row(id).complementAmount, 0, 'the arrival complement is read net of the note: nothing left to collect');
  assert.equal(row(id).endOfStayComplementAmount, 0);
});

test('rule 85: a card order and an unpaid one on the same stay — the arrival complement keeps only the unpaid one, a later save never raises it back', () => {
  const id = seedStay();
  assert.equal(commitOrder(id, { ...named(2), lines: [{ kind: 'option', id: 102, quantity: 2 }], paid: paid(1200, 'pay_2') }).status, 200);
  assert.equal(commitOrder(id, { ...named(3), lines: [{ kind: 'option', id: 102, quantity: 1 }] }).status, 200);
  assert.equal(row(id).complementAmount, 6);
  // an unrelated save of the fiche (the operator's) reprices the whole stay: the complement stays net
  const stored = reservations.getByIdWithDetails(id);
  const { toUpdateBody } = require('../utils/reservationUpdateBody');
  const saved = require('../controllers/reservationsController').performUpdate(id, toUpdateBody(stored, new Set()), { beforeArrival: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(row(id).complementAmount, 6);
});

test('rule 85: the note is never inside the end-of-stay remainder (settledByKey skips it) yet counts as collected per line (withArrival)', () => {
  const id = seedStay();
  commitOrder(id, { ...named(4), lines: [{ kind: 'option', id: 102, quantity: 1 }], paid: paid(600, 'pay_4') });
  const raw = row(id).midStaySettledNotes;
  assert.deepEqual(settledByKey(raw), {});
  assert.deepEqual(settledByKey(raw, { withArrival: true }), { 'opt:102': 6 });
  assert.deepEqual(arrivalPrepaid(raw), { total: 6, byKey: { 'opt:102': 6 } });
});

test('rule 85: the complement buckets file the prepaid money with the money collected before the arrival, the total never moves', () => {
  const buckets = splitComplementBuckets({ complementAmount: 6, complementPaid: 0, midStaySettledTotal: 12, endOfStayComplementTotal: 0, deferred: false });
  assert.deepEqual(buckets, { arrival: 6, duringStay: 12, endOfStay: 0 });
});

test('rule 85: the arrival marked, a later order is a departure order and the arrival-moment note stays out of its remainder', () => {
  const id = seedStay(-1);
  db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
  assert.equal(orderCollection(id), 'departure');
  const result = commitOrder(id, { ...named(5), lines: [{ kind: 'option', id: 102, quantity: 1 }], paid: paid(600, 'pay_5') });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const notes = JSON.parse(row(id).midStaySettledNotes);
  assert.equal(notes[0].moment, undefined, 'after the arrival: the in-stay note of rule 35');
});

test('rule 85: a card commit whose stay price moved meanwhile is refused ORDER_STAY_PRICE_MOVED, no note written', () => {
  const id = seedStay();
  db.prepare('UPDATE reservations SET finalPrice = 999 WHERE id = ?').run(id);
  const result = commitOrder(id, { ...named(6), lines: [{ kind: 'option', id: 102, quantity: 1 }], paid: paid(600, 'pay_6') });
  assert.deepEqual([result.status, result.body.code], [409, 'ORDER_STAY_PRICE_MOVED']);
  assert.equal(row(id).midStaySettledNotes, null);
  assert.equal(priceOrder(id, [{ kind: 'option', id: 102, quantity: 1 }]).body.code, 'ORDER_STAY_PRICE_MOVED');
});
