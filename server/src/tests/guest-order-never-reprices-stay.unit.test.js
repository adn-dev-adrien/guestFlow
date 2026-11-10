// specs/guest-app.md rule 93, rule 66 (third pass, 2026-11-10) — an order never re-prices the stay. Its write adds the order's own
// amount to the arrival complement and touches no other money column: a Booking stay that carries no tourist tax, a stay sold
// under a price the engine no longer reproduces, and the rules frozen at the sale (minimum nights) are all left as they were.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();

const db = require('../database');
const {
  priceOrder, commitOrder, amendOrder, orderCollection, __test,
} = require('../utils/midStayOrderCommit');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 1.5, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (102, 'Cidre', 6.5, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 102)').run();

const MONEY = [
  'totalPrice', 'touristTaxRate', 'touristTaxTotal', 'discountPercent', 'finalPrice', 'depositAmount', 'depositDueDate', 'balanceAmount',
  'balanceDueDate', 'complementAmount', 'endOfStayComplementAmount', 'platformCommissionAmount', 'acompteCommissionAmount',
  'platformGrossAmount', 'platformPayoutAmount', 'platformTouristTaxAmount', 'clientGrossAmount', 'touristTaxInComplement',
  'installmentsTarget', 'installmentsPaidAmount', 'installmentsUnpaidAmount', 'installmentsLastPaidDate',
];

let sequence = 0;

/** A stay sold as `platform` for `finalPrice`, whose stored figures the engine of today does not reproduce. */
function seedStay({ platform = 'Booking', start = 5, finalPrice = 905, tax = 0, balance = 825, minNightsStay = 4, balancePaid = 0 } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid, reservationNumber)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, ?, 880, 0, ?, 0, ?, 1, ?, 'reservation', 0, '16:00', '10:00', 0, 0, 0, 0, 0, ?, ?, ?)`)
    .run(isoPlus(start), isoPlus(start + minNightsStay), platform, finalPrice, balance, tax, isoPlus(start), balancePaid, `2026${String(++sequence).padStart(5, '0')}`).lastInsertRowid);
  for (let i = start; i < start + minNightsStay; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 220)").run(id, isoPlus(i));
  }
  return id;
}

// `tariffSnapshot` follows the order's consumed free units (tariff-recipes rule 66); `updatedAt` is the write itself.
const snapshot = (id) => {
  const { tariffSnapshot, updatedAt, ...row } = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  return { ...row, nights: JSON.stringify(db.prepare('SELECT date, seasonLabel, pricingMode, price FROM reservation_nights WHERE reservationId = ? ORDER BY date').all(id)) };
};
const moved = (before, after) => Object.keys(before).filter((key) => before[key] !== after[key]);

test('rule 93 (HIGH 1, kills N2): a Booking stay with no tourist tax — the order moves the complement, never the tax, the solde or the platform figures', () => {
  const id = seedStay();
  const before = snapshot(id);
  assert.equal(orderCollection(id), 'arrival');
  const priced = priceOrder(id, [{ kind: 'option', id: 102, quantity: 2 }]);
  assert.deepEqual([priced.status, priced.total], [200, 13], JSON.stringify(priced.body));
  const result = commitOrder(id, { ...named(1), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  assert.deepEqual([result.status, result.total, result.collectAt], [200, 13, 'arrival'], JSON.stringify(result.body));
  const after = snapshot(id);
  assert.deepEqual(MONEY.filter((key) => before[key] !== after[key]).sort(), ['complementAmount', 'finalPrice'].sort());
  assert.equal(after.complementAmount - before.complementAmount, 13);
  assert.equal(after.finalPrice - before.finalPrice, 13);
  assert.equal(after.touristTaxTotal, 0);
  assert.equal(after.balanceAmount, 825);
  assert.deepEqual(moved(before, after).filter((key) => !['complementAmount', 'finalPrice'].includes(key)), []);
});

test('rule 93 (HIGH 1): a stay sold at a price the engine no longer reproduces keeps it; a second order and a direct stay hold the same line', () => {
  const direct = seedStay({ platform: 'direct', finalPrice: 777, tax: 12.34, balance: 777, balancePaid: 1 });
  const before = snapshot(direct);
  const first = commitOrder(direct, { ...named(2), lines: [{ kind: 'option', id: 102, quantity: 1 }] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const second = commitOrder(direct, { ...named(3), lines: [{ kind: 'option', id: 102, quantity: 1 }] });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  const after = snapshot(direct);
  // A direct stay's gross is its price (`clientGrossAmount`), which follows the order's growth with it.
  assert.deepEqual(MONEY.filter((key) => before[key] !== after[key]).sort(), ['clientGrossAmount', 'complementAmount', 'finalPrice'].sort());
  assert.equal(after.complementAmount, 13);
  assert.equal(after.finalPrice, 790);
  assert.equal(after.clientGrossAmount, 790);
  assert.equal(after.touristTaxTotal, 12.34);
  assert.equal(after.balanceAmount, 777);
});

test('rule 93 (HIGH 1): the amendment of an unpaid order never re-prices the stay either', () => {
  const id = seedStay();
  const first = commitOrder(id, { ...named(4), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const before = snapshot(id);
  const result = amendOrder(id, {
    ...named(4), from: [{ kind: 'option', id: 102, quantity: 2 }], to: [{ kind: 'option', id: 102, quantity: 1 }],
  });
  assert.deepEqual([result.status, result.total], [200, -6.5], JSON.stringify(result.body));
  const after = snapshot(id);
  assert.deepEqual(MONEY.filter((key) => before[key] !== after[key]).sort(), ['complementAmount', 'finalPrice'].sort());
  assert.equal(after.complementAmount, 6.5);
  assert.equal(before.complementAmount - after.complementAmount, 6.5);
  assert.equal(after.touristTaxTotal, 0);
  assert.equal(after.balanceAmount, 825);
});

test('rule 93 (MEDIUM 2): the minimum nights of the season today is not re-judged — a stay sold under older rules orders, and the shop and the commit agree', () => {
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights, dateRanges) VALUES (1, 'Très haute', 220, 7, ?)")
    .run(JSON.stringify([{ startDate: '2000-01-01', endDate: '2100-12-31' }]));
  const id = seedStay({ platform: 'Booking', start: 6, minNightsStay: 3 });
  assert.equal(orderCollection(id), 'arrival');
  const priced = priceOrder(id, [{ kind: 'option', id: 102, quantity: 1 }]);
  assert.deepEqual([priced.status, priced.total], [200, 6.5], JSON.stringify(priced.body));
  const result = commitOrder(id, { ...named(5), lines: [{ kind: 'option', id: 102, quantity: 1 }] });
  assert.deepEqual([result.status, result.total], [200, 6.5], JSON.stringify(result.body));
  assert.equal(snapshot(id).complementAmount, 6.5);
});

test('rule 83 (N11): `tagCharges` never gives an order\'s key to a SAS-origin line, even one stored after the order\'s own row with the same words', () => {
  const label = 'Bain nordique — supplément soirée';
  const id = seedStay({ platform: 'Booking' });
  const insert = (amount, origin) => db.prepare(`INSERT INTO reservation_custom_options (reservationId, description, amount, offered, sortOrder, inComplement, sasArrivalOrigin)
    VALUES (?, ?, ?, 0, 0, 1, ?)`).run(id, label, amount, origin).lastInsertRowid;
  const own = Number(insert(5, 0));
  const sas = Number(insert(10, 1));
  __test.tagCharges(id, [{ kind: 'charge', key: 'guest-order:21:evening:202', label, amount: 5 }]);
  const key = (rowId) => db.prepare('SELECT orderChargeKey FROM reservation_custom_options WHERE id = ?').get(rowId).orderChargeKey;
  assert.equal(key(sas), null, 'the SAS line takes no order key');
  assert.equal(key(own), 'guest-order:21:evening:202');
});
