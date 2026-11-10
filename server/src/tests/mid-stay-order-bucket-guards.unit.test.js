// specs/guest-app.md rule 66 (audit of the J-7 branch, item 7 / M15) — an order measured before the arrival may grow the arrival
// complement and NOTHING else: whenever the order's save would move another bucket (acompte, solde, end-of-stay complement) it is
// refused ORDER_OFF_ARRIVAL_COMPLEMENT, nothing written; and an order that would move the tourist tax is refused ORDER_STAY_PRICE_MOVED.
// The engine never does either on its own for a settled stay, so the second dry-run of the measure is played by a wrapper.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const controller = require('../controllers/reservationsController');
const { priceOrder, commitOrder, amendOrder } = require('../utils/midStayOrderCommit');

const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (102, 'Cidre', 6, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 102)').run();

function seedStay() {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 400, 0, 400, 1, 0, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1)`)
    .run(isoPlus(5), isoPlus(9), isoPlus(5)).lastInsertRowid);
  for (let i = 5; i < 9; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  return id;
}
const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const lines = [{ kind: 'option', id: 102, quantity: 1 }];

/** The second dry-run save of a measure (the one with the order) answers a row moved by `change`. */
function withMovedRow(change, run) {
  const real = controller.performUpdate;
  let dry = 0;
  controller.performUpdate = (id, body, options) => {
    const result = real(id, body, options);
    if (!(options && options.dryRun)) return result;
    dry += 1;
    return dry % 2 === 0 ? { ...result, row: { ...result.row, ...change(result.row) } } : result;
  };
  try {
    return run();
  } finally {
    controller.performUpdate = real;
  }
}
const money = (id) => db.prepare('SELECT depositAmount, balanceAmount, complementAmount, endOfStayComplementAmount FROM reservations WHERE id = ?').get(id);

test('rule 66: an order that would move the solde, the acompte or the end-of-stay complement is refused ORDER_OFF_ARRIVAL_COMPLEMENT, nothing written', () => {
  for (const column of ['balanceAmount', 'depositAmount', 'endOfStayComplementAmount']) {
    const id = seedStay();
    const before = money(id);
    const priced = withMovedRow((row) => ({ [column]: Number(row[column] || 0) + 5 }), () => priceOrder(id, lines));
    assert.deepEqual([priced.status, priced.body.code], [409, 'ORDER_OFF_ARRIVAL_COMPLEMENT'], column);
    const committed = withMovedRow((row) => ({ [column]: Number(row[column] || 0) + 5 }), () => commitOrder(id, { ...named(1), lines }));
    assert.deepEqual([committed.status, committed.body.code], [409, 'ORDER_OFF_ARRIVAL_COMPLEMENT'], column);
    assert.deepEqual(money(id), before, 'nothing written');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ?').get(id).n, 0);
  }
});

test('rule 66: an order that would move the tourist tax is refused ORDER_STAY_PRICE_MOVED — an order never re-prices the stay', () => {
  const id = seedStay();
  const priced = withMovedRow((row) => ({ touristTaxTotal: Number(row.touristTaxTotal || 0) + 3 }), () => priceOrder(id, lines));
  assert.deepEqual([priced.status, priced.body.code], [409, 'ORDER_STAY_PRICE_MOVED']);
});

test('rule 87: an amendment that would move another bucket or the tourist tax is refused too, nothing written', () => {
  const id = seedStay();
  assert.equal(commitOrder(id, { ...named(2), lines: [{ kind: 'option', id: 102, quantity: 2 }] }).status, 200);
  const from = [{ kind: 'option', id: 102, quantity: 2 }];
  const to = [{ kind: 'option', id: 102, quantity: 1 }];
  const before = money(id);
  const moved = withMovedRow((row) => ({ balanceAmount: Number(row.balanceAmount || 0) + 5 }), () => amendOrder(id, { ...named(2), history: named(2).history, from, to }));
  assert.deepEqual([moved.status, moved.body.code], [409, 'ORDER_OFF_ARRIVAL_COMPLEMENT']);
  const taxed = withMovedRow((row) => ({ touristTaxTotal: Number(row.touristTaxTotal || 0) + 3 }), () => amendOrder(id, { ...named(2), history: named(2).history, from, to }));
  assert.deepEqual([taxed.status, taxed.body.code], [409, 'ORDER_STAY_PRICE_MOVED']);
  assert.deepEqual(money(id), before);
});
