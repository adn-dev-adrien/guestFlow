// Declaration of the added guests' tourist tax — specs/platform-added-guests-tourist-tax.md rules 11-12,
// 15: declared once collected, a declaration already made does not move. Rule 13 (the books) is tested
// beside the export: plugins/accounting-export/tests/platform-added-guests-tourist-tax-books.unit.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');
const { localIsoDate } = require('../utils/localDate');
const { __test: { arrivalComplementDetailFromReservation } } = require('../models/reservationsModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const pad2 = (n) => String(n).padStart(2, '0');
const now = new Date();
const year = now.getFullYear();
const m = now.getMonth() + 1;
const month = `${year}-${pad2(m)}`;
const day = (d) => `${year}-${pad2(m)}-${pad2(d)}`;

function ensureColumn(db, table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function seed(stay = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec(`CREATE TABLE IF NOT EXISTS platforms (id INTEGER PRIMARY KEY, name TEXT)`);
  for (const [table, column, type] of [
    ['platforms', 'collectsTouristTax', 'INTEGER'], ['platforms', 'touristTaxRemittedByPlatform', 'INTEGER'],
    ['reservations', 'platformGrossAmount', 'REAL'], ['reservations', 'platformPaidGuests', 'INTEGER'],
    ['reservations', 'platformPaidAdults', 'INTEGER'], ['reservations', 'touristTaxDeclaredAt', 'TEXT'],
    ['reservations', 'touristTaxAddedGuestsAmount', 'REAL NOT NULL DEFAULT 0'],
    ['reservations', 'touristTaxAddedGuestsDeclaredAt', 'TEXT'], ['reservations', 'touristTaxAddedGuestsAdults', 'INTEGER'],
    ['reservations', 'touristTaxDeclaredWithAddedAmount', 'REAL'], ['reservations', 'platformPaidOccupants', 'INTEGER'],
    ['reservations', 'touristTaxFrozenAt', 'TEXT'],
    ['reservations', 'touristTaxFrozenBaseHt', 'REAL'], ['reservations', 'touristTaxFrozenOccupants', 'INTEGER'],
    ['reservations', 'touristTaxFrozenUnitAmount', 'REAL'],
  ]) ensureColumn(db, table, column, type);
  db.prepare('INSERT OR REPLACE INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, touristTaxMode, touristTaxPerDayPerPerson, basePriceIncludedGuests, extraGuestPrice)
              VALUES (1, 'Gite', 'per_day_per_person', 1.2, 4, 0)`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Canal', 1, 0)").run();
  const row = {
    id: 1, kind: 'reservation', clientId: 1, propertyId: 1, startDate: day(1), endDate: day(3), platform: 'Canal',
    adults: 3, touristTaxRate: 1.2, touristTaxTotal: 7.2, finalPrice: 595.2, totalPrice: 595.2,
    balanceAmount: 600, balancePaid: 1, balancePaidDate: day(2),
    complementAmount: 2.4, complementPaid: 0, complementPaidDate: null,
    platformGrossAmount: 600, platformPaidGuests: 2, platformPaidAdults: 2, touristTaxAddedGuestsAmount: 2.4,
    ...stay,
  };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => row[k]));
  return { db, model: financeModel.buildModel(db) };
}

const extract = (model) => model.getTouristTaxExtraction({ month });
const mainRow = (data) => data.reservations.find((r) => !r.addedGuestsRow);
const addedRow = (data) => data.reservations.find((r) => r.addedGuestsRow);
const stamp = (db) => db.prepare('SELECT touristTaxDeclaredWithAddedAmount AS s, touristTaxAddedGuestsDeclaredAt AS at, touristTaxDeclaredAt AS d FROM reservations').get();
const TODAY = localIsoDate();
// Paid after a tick made earlier: a row of its own, read from the stamp (rule 20).
const OWN_ROW = {
  complementPaid: 1, complementPaidDate: day(2), touristTaxDeclaredAt: `${day(1)} 09:00:00`, touristTaxDeclaredWithAddedAmount: 0,
  balancePaidDate: day(1), touristTaxFrozenAt: `${day(1)} 09:00:00`, touristTaxAddedGuestsAdults: 1,
};

test('rule 11: a complement not collected → the row declares what the platform reversed', () => {
  const { model } = seed();
  const { data } = extract(model);
  assert.equal(data.reservations.length, 1);
  assert.equal(data.reservations[0].taxAmount, 4.8);
  assert.equal(data.reservations[0].adults, 2);
  assert.equal(data.reservations[0].adultNights, 4);
  assert.equal(data.reservations[0].taxRate, 1.2);
});

test('rule 11: a complement collected → the same row declares the whole tax', () => {
  const { model } = seed({ complementPaid: 1, complementPaidDate: day(1) });
  const { data } = extract(model);
  assert.equal(data.reservations.length, 1);
  assert.equal(data.reservations[0].taxAmount, 7.2);
  assert.equal(data.reservations[0].adults, 3);
  assert.equal(data.totals.taxAmount, 7.2);
});

test('rule 12: collected after the row was declared → the row keeps its amount, a row of its own', () => {
  const { model } = seed({
    complementPaid: 1, complementPaidDate: day(2), touristTaxDeclaredAt: `${day(1)} 09:00:00`,
    balancePaidDate: day(1), touristTaxFrozenAt: `${day(1)} 09:00:00`, touristTaxAddedGuestsAdults: 1,
  });
  const { data } = extract(model);
  assert.equal(data.reservations.length, 2);
  const [main, added] = [data.reservations.find((r) => !r.addedGuestsRow), data.reservations.find((r) => r.addedGuestsRow)];
  assert.equal(main.taxAmount, 4.8);
  assert.ok(main.touristTaxDeclaredAt);
  assert.equal(added.taxAmount, 2.4);
  assert.equal(added.adults, 1);
  assert.equal(added.adultNights, 2);
  assert.equal(added.touristTaxDeclaredAt, null);
  assert.equal(added.accommodationAmount, 0);
  assert.equal(data.totals.taxAmount, 7.2);
  assert.equal(data.totals.reservationsCount, 1);
  assert.equal(data.totals.rentedNights, 2);
  assert.equal(data.totals.adultNights, 6);
});

test('rule 12: the added row is ticked on its own', () => {
  const { db, model } = seed({
    complementPaid: 1, complementPaidDate: day(2), touristTaxDeclaredAt: `${day(1)} 09:00:00`, touristTaxFrozenAt: `${day(1)} 09:00:00`,
  });
  const before = db.prepare('SELECT touristTaxDeclaredAt AS at FROM reservations').get().at;
  const res = model.setTouristTaxDeclared({ reservationId: 1, declared: true, addedGuests: true });
  assert.ok(res.data.declaredAt);
  assert.equal(db.prepare('SELECT touristTaxDeclaredAt AS at FROM reservations').get().at, before);
  assert.ok(extract(model).data.reservations.find((r) => r.addedGuestsRow).touristTaxDeclaredAt);
});

test('rule 23: a tax that is not the addition keeps its name on the stored detail', () => {
  const { detail } = arrivalComplementDetailFromReservation({
    complementAmount: 7.2, touristTaxInComplementAmount: 7.2, touristTaxAddedGuestsAmount: 2.4, options: [], resources: [],
  });
  assert.equal(detail[0].label, 'Taxe de séjour');
  assert.equal(detail[0].addedGuests, undefined);
});

test('rule 15: the stored complement detail carries the added tax on its tax line', () => {
  const { detail } = arrivalComplementDetailFromReservation({
    complementAmount: 42.4, touristTaxInComplementAmount: 2.4,
    extraGuestComplementSurcharge: 40, extraGuestComplementCount: 1, options: [], resources: [],
  });
  assert.deepEqual(detail.map((l) => [l.kind, l.amount]), [['extraGuests', 40], ['tax', 2.4]]);
});

// R22-DB-4 / R22-C1 — a date has no order within a day, and a UTC stamp is not a Paris day.
test('rule 20: ticked on the day the complement was collected → one row, whole, and nothing more to declare', () => {
  const { db, model } = seed({ complementPaid: 1, complementPaidDate: TODAY, touristTaxAddedGuestsAdults: 1 });
  const before = extract(model).data;
  assert.equal(before.reservations.length, 1);
  assert.equal(before.reservations[0].taxAmount, 7.2);
  assert.ok(model.setTouristTaxDeclared({ reservationId: 1, declared: true }).ok);
  assert.equal(stamp(db).s, 2.4);
  const after = extract(model).data;
  assert.equal(after.reservations.length, 1);
  assert.equal(after.reservations[0].taxAmount, 7.2);
  assert.equal(after.reservations[0].adults, 3);
  assert.ok(after.reservations[0].touristTaxDeclaredAt);
});

test('rule 20: ticked before the complement was collected → its own row, even the same day', () => {
  const { db, model } = seed({ touristTaxAddedGuestsAdults: 1 });
  model.setTouristTaxDeclared({ reservationId: 1, declared: true });
  assert.equal(stamp(db).s, 0);
  db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ?').run(TODAY);
  const { data } = extract(model);
  assert.equal(mainRow(data).taxAmount, 4.8);
  assert.equal(addedRow(data).taxAmount, 2.4);
  assert.equal(data.totals.taxAmount, 7.2);
});

test('rule 20: a stamp reads the same whatever the dates say', () => {
  const included = seed({ complementPaid: 1, complementPaidDate: day(2), touristTaxDeclaredAt: `${day(1)} 09:00:00`, touristTaxDeclaredWithAddedAmount: 2.4 });
  assert.equal(extract(included.model).data.reservations.length, 1);
  assert.equal(extract(included.model).data.reservations[0].taxAmount, 7.2);
  const left = seed({ complementPaid: 1, complementPaidDate: day(1), touristTaxDeclaredAt: `${day(2)} 09:00:00`, touristTaxDeclaredWithAddedAmount: 0 });
  assert.equal(extract(left.model).data.reservations.length, 2);
  assert.equal(mainRow(extract(left.model).data).taxAmount, 4.8);
});

test('rule 20: unticking clears the stamp, and a tick repeated on a declared row does not rewrite it', () => {
  const { db, model } = seed({ touristTaxAddedGuestsAdults: 1 });
  model.setTouristTaxDeclared({ reservationId: 1, declared: true });
  db.prepare('UPDATE reservations SET complementPaid = 1, complementPaidDate = ?').run(TODAY);
  model.setTouristTaxDeclared({ reservationId: 1, declared: true });
  assert.equal(stamp(db).s, 0, 'a stale tab does not swallow the row of its own');
  model.setTouristTaxDeclared({ reservationId: 1, declared: false });
  assert.equal(stamp(db).s, null);
  assert.equal(stamp(db).d, null);
  assert.equal(extract(model).data.reservations.length, 1);
  assert.equal(extract(model).data.reservations[0].taxAmount, 7.2);
  model.setTouristTaxDeclared({ reservationId: 1, declared: true });
  assert.equal(stamp(db).s, 2.4);
});

test('rule 25: a main tick repeated on a declared row changes nothing, its first date stands', () => {
  const first = `${day(1)} 09:00:00`;
  const { db, model } = seed({ ...OWN_ROW, complementPaidDate: day(1), touristTaxDeclaredAt: first, touristTaxDeclaredWithAddedAmount: null });
  const before = extract(model).data.reservations.map((r) => [r.addedGuestsRow || false, r.taxAmount]);
  assert.deepEqual(before, [[false, 4.8], [true, 2.4]]);
  const answer = model.setTouristTaxDeclared({ reservationId: 1, declared: true });
  assert.equal(answer.data.declaredAt, first);
  assert.equal(stamp(db).d, first);
  assert.equal(stamp(db).s, null, 'a legacy row stays a legacy row');
  assert.deepEqual(extract(model).data.reservations.map((r) => [r.addedGuestsRow || false, r.taxAmount]), before);
});

test('rule 20: a tick with no addition stamps 0, and a guest collected later gets the row of its own', () => {
  const { db, model } = seed({ touristTaxAddedGuestsAmount: 0, touristTaxTotal: 4.8, adults: 2, complementAmount: 0 });
  model.setTouristTaxDeclared({ reservationId: 1, declared: true });
  assert.equal(stamp(db).s, 0);
});

test('rule 20: a legacy row, no stamp, keeps the date test: the same day is after the declaration', () => {
  const legacy = { touristTaxDeclaredWithAddedAmount: null, touristTaxAddedGuestsAdults: 1 };
  const same = seed({ ...legacy, complementPaid: 1, complementPaidDate: day(2), touristTaxDeclaredAt: `${day(2)} 09:00:00`, touristTaxFrozenAt: `${day(2)} 09:00:00` });
  assert.equal(extract(same.model).data.reservations.length, 2);
  assert.equal(mainRow(extract(same.model).data).taxAmount, 4.8);
  const earlier = seed({ ...legacy, complementPaid: 1, complementPaidDate: day(1), touristTaxDeclaredAt: `${day(2)} 09:00:00`, touristTaxFrozenAt: `${day(2)} 09:00:00` });
  assert.equal(extract(earlier.model).data.reservations.length, 1);
  assert.equal(extract(earlier.model).data.reservations[0].taxAmount, 7.2);
});

// R22-S2 — the JS read the departure day, the SQL the last night: 2,40 € owed to the commune on no row.
test('rule 20: a legacy row with no paid date reads the last night, in the row and in the SQL alike', () => {
  const legacy = { complementPaid: 1, complementPaidDate: null, touristTaxDeclaredWithAddedAmount: null, touristTaxAddedGuestsAdults: 1 };
  const onDeparture = seed({ ...legacy, touristTaxDeclaredAt: `${day(3)} 09:00:00`, touristTaxFrozenAt: `${day(3)} 09:00:00` });
  const departure = extract(onDeparture.model).data;
  assert.equal(departure.reservations.length, 1);
  assert.equal(departure.totals.taxAmount, 7.2);
  const onLastNight = seed({ ...legacy, touristTaxDeclaredAt: `${day(2)} 09:00:00`, touristTaxFrozenAt: `${day(2)} 09:00:00` });
  const lastNight = extract(onLastNight.model).data;
  assert.equal(lastNight.reservations.length, 2);
  assert.equal(lastNight.totals.taxAmount, 7.2);
});

test('rule 11: no row of its own while the complement is not collected, or while nothing was declared', () => {
  const unpaid = seed({ touristTaxDeclaredAt: `${day(1)} 09:00:00`, touristTaxDeclaredWithAddedAmount: 0, touristTaxAddedGuestsAdults: 1 });
  const uncollected = extract(unpaid.model).data;
  assert.equal(uncollected.reservations.length, 1);
  assert.equal(uncollected.totals.taxAmount, 4.8);
  const undeclared = seed({ complementPaid: 1, complementPaidDate: day(2), touristTaxAddedGuestsAdults: 1 });
  const notDeclared = extract(undeclared.model).data;
  assert.equal(notDeclared.reservations.length, 1);
  assert.equal(notDeclared.totals.taxAmount, 7.2);
  // An older release unticks without touching the stamp: undeclared stays undeclared.
  const rolledBack = seed({ complementPaid: 1, complementPaidDate: day(2), touristTaxDeclaredWithAddedAmount: 0, touristTaxAddedGuestsAdults: 1 });
  assert.equal(extract(rolledBack.model).data.reservations.length, 1);
  assert.equal(extract(rolledBack.model).data.totals.taxAmount, 7.2);
});

test('rule 12: the row holds its rate, no base of its own, and the property counts the stay and its nights once', () => {
  const { model } = seed(OWN_ROW);
  const { data } = extract(model);
  const added = addedRow(data);
  assert.equal(added.taxRate, 1.2);
  assert.equal(added.accommodationAmount, 0);
  assert.equal(added.nightPricePerOccupantHt, null);
  assert.equal(added.children, 0);
  const [property] = data.byProperty;
  assert.equal(property.reservationsCount, 1);
  assert.equal(property.nightsCount, 2);
  assert.equal(property.adultNights, 6);
  assert.equal(property.taxAmount, 7.2);
  assert.equal(property.accommodationAmount, mainRow(data).accommodationAmount);
});

test('rule 12: a refunded night leaves the added row too, in amount and in person-nights', () => {
  const { db, model } = seed(OWN_ROW);
  const refund = db.prepare("INSERT INTO reservation_refunds (reservationId, refundDate, method, totalTtc) VALUES (1, ?, 'transfer', 1.2)").run(day(3)).lastInsertRowid;
  db.prepare("INSERT INTO reservation_refund_lines (refundId, lineKey, label, bucket, quantity, amountTtc, unitPrice, vatRate) VALUES (?, 'touristTax', 'Taxe', 'touristTax', 1, 1.2, 1.2, 0)").run(refund);
  const added = addedRow(extract(model).data);
  assert.equal(added.nightsCount, 1);
  assert.equal(added.taxAmount, 1.2);
  assert.equal(added.adultNights, 1);
  assert.equal(added.refundedTaxNights, 1);
  assert.equal(added.refundedTaxAmount, 1.2);
});

// R22-DB-5.
test('rule 21: the row reads the adults stored with the amount, not the party of today', () => {
  const left = seed({ ...OWN_ROW, adults: 2 });
  const added = addedRow(extract(left.model).data);
  assert.equal(added.adults, 1);
  assert.equal(added.adultNights, 2);
  assert.equal(added.taxRate, 1.2);
  assert.equal(added.noGuestAdded, undefined);
});

test('rule 21: a gap with nobody added shows the amount, no person-night, and says so', () => {
  const { model } = seed({ ...OWN_ROW, adults: 2, children: 1, touristTaxAddedGuestsAmount: 8.04, touristTaxAddedGuestsAdults: 0 });
  const { data } = extract(model);
  const added = addedRow(data);
  assert.equal(added.noGuestAdded, true);
  assert.equal(added.adults, null);
  assert.equal(added.children, null);
  assert.equal(added.adultNights, 0);
  assert.equal(added.taxRate, null);
  assert.equal(added.taxAmount, 8.04);
  assert.equal(data.totals.adultNights, 4);
});

test('rule 21: no adults stored with the amount (a rollback, then a re-upgrade) → the row falls back on the party', () => {
  const { model } = seed({ ...OWN_ROW, touristTaxAddedGuestsAdults: null, adults: 3, platformPaidAdults: 2 });
  const added = addedRow(extract(model).data);
  assert.equal(added.adults, 1);
  assert.equal(added.adultNights, 2);
  assert.equal(added.taxRate, 1.2);
  assert.equal(added.noGuestAdded, undefined);
});

test('rule 22: ticking a row that does not exist answers 409 and stamps nothing', () => {
  const none = seed({ touristTaxAddedGuestsAmount: 0, touristTaxTotal: 4.8, adults: 2 });
  const refused = none.model.setTouristTaxDeclared({ reservationId: 1, declared: true, addedGuests: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 409);
  assert.equal(stamp(none.db).at, null);
  const included = seed({ complementPaid: 1, complementPaidDate: day(1), touristTaxDeclaredAt: `${day(2)} 09:00:00`, touristTaxDeclaredWithAddedAmount: 2.4 });
  assert.equal(included.model.setTouristTaxDeclared({ reservationId: 1, declared: true, addedGuests: true }).status, 409);
  const uncollected = seed({ touristTaxDeclaredAt: `${day(1)} 09:00:00`, touristTaxDeclaredWithAddedAmount: 0 });
  assert.equal(uncollected.model.setTouristTaxDeclared({ reservationId: 1, declared: true, addedGuests: true }).status, 409);
  const noAddition = seed({
    touristTaxAddedGuestsAmount: 0, touristTaxTotal: 4.8, adults: 2, complementPaid: 1, complementPaidDate: day(2),
    touristTaxDeclaredAt: `${day(1)} 09:00:00`, touristTaxDeclaredWithAddedAmount: 0,
  });
  assert.equal(noAddition.model.setTouristTaxDeclared({ reservationId: 1, declared: true, addedGuests: true }).status, 409);
});

test('rule 22: unticking a row that no longer exists is allowed, only ticking one answers 409', () => {
  const gone = seed({ touristTaxDeclaredAt: `${day(1)} 09:00:00`, touristTaxDeclaredWithAddedAmount: 0, touristTaxAddedGuestsDeclaredAt: `${day(1)} 10:00:00` });
  assert.equal(addedRow(extract(gone.model).data), undefined);
  const answer = gone.model.setTouristTaxDeclared({ reservationId: 1, declared: false, addedGuests: true });
  assert.equal(answer.ok, true);
  assert.equal(answer.data.declaredAt, null);
  assert.equal(stamp(gone.db).at, null);
});

test('rule 22: the added row unticks alone, and unticking the main row takes the added tick with it', () => {
  const { db, model } = seed(OWN_ROW);
  model.setTouristTaxDeclared({ reservationId: 1, declared: true, addedGuests: true });
  const untick = model.setTouristTaxDeclared({ reservationId: 1, declared: false, addedGuests: true });
  assert.equal(untick.data.declaredAt, null);
  assert.equal(stamp(db).at, null);
  assert.ok(stamp(db).d, 'the main row stays declared');
  assert.equal(stamp(db).s, 0);
  assert.equal(addedRow(extract(model).data).touristTaxDeclaredAt, null);

  model.setTouristTaxDeclared({ reservationId: 1, declared: true, addedGuests: true });
  model.setTouristTaxDeclared({ reservationId: 1, declared: false });
  assert.equal(stamp(db).at, null);
  assert.equal(extract(model).data.reservations.length, 1);
});
