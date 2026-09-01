// specs/tourist-tax-matches-the-office-calculation.md rules 10-12 — the « Suivi financier → Taxe de
// séjour » page must show, for every stay it lists, the amount the fiche shows AND a base that
// reproduces it. That second half is what broke on 2026-08-20: the amount was pinned while the base
// went on being recomputed under a new rule, so a declared line read « 24,73 €/occupant/nuit » next
// to « 21,00 € » — two numbers that do not answer each other, and cannot be retyped into the
// commune's form.
//
// Note the structural consequence of rule 10: the page only ever lists stays whose tax has been
// COLLECTED, and collecting is what freezes it. Every line here is therefore a frozen one — the
// declaration reports, it no longer re-prices.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');
const { calculateReservationQuote } = require('../utils/pricing').__test;
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { writeTouristTaxSnapshot } = require('../utils/touristTaxFreeze');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const pad2 = (n) => String(n).padStart(2, '0');

function currentMonth() {
  const now = new Date();
  return { month: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`, year: now.getFullYear(), m: now.getMonth() + 1 };
}

// The Lodge as configured in production: 5 % + 10 % departmental, VAT 10 %, 2 guests included in the
// rate, and the three inclusions (Ménage 30 €/séjour, Linge de lit 7 €/pers, Linge de toilette 8 €/pers).
function seedDb({ mode = 'percentage_accommodation' } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties
      (id, name, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage, touristTaxPerDayPerPerson,
       basePriceIncludedGuests, extraGuestPrice)
    VALUES (1, 'Aventura lodge', ?, ?, ?, ?, 2, 0)`)
    .run(mode, mode === 'per_day_per_person' ? 0 : 5, mode === 'per_day_per_person' ? 0 : 10,
      mode === 'per_day_per_person' ? 1.2 : 0);
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const addOption = db.prepare('INSERT INTO options (id, title, priceType, price) VALUES (?, ?, ?, ?)');
  addOption.run(7, 'Ménage', 'per_stay', 30);
  addOption.run(8, 'Linge de lit', 'per_person', 7);
  addOption.run(9, 'Linge de toilette', 'per_person', 8);
  addOption.run(11, 'Panier gourmand', 'per_stay', 45);
  for (const id of [7, 8, 9, 11]) db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(id);
  for (const id of [7, 8, 9]) {
    db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, ?, 1)').run(id);
  }
  return { db, model: financeModel.buildModel(db) };
}

// 3 nights at 119,93 € → 359,79 € of accommodation, 2 adults, solde paid inside the month.
// `touristTaxTotal` is left at 0 here and filled by `saveLikeTheFiche` below, once the option lines
// are in place — exactly the order a real save follows.
function insertStay(db, { year, m, persons = 2 }) {
  const start = `${year}-${pad2(m)}-10`;
  const end = `${year}-${pad2(m)}-13`;
  const paid = `${year}-${pad2(m)}-12`;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults,
                touristTaxRate, touristTaxTotal, finalPrice, totalPrice, balanceAmount, balancePaid, balancePaidDate)
              VALUES (1, 'reservation', 1, 1, ?, ?, 'direct', ?, 0, 0, 359.79, 359.79, 359.79, 1, ?)`)
    .run(start, end, persons, paid);
  const night = db.prepare('INSERT INTO reservation_nights (reservationId, date, price) VALUES (1, ?, 119.93)');
  for (let i = 0; i < 3; i += 1) night.run(`${year}-${pad2(m)}-${pad2(10 + i)}`);
  return { start, end };
}

// The three property defaults, offered → the lines a Lodge booking carries.
function insertInclusions(db, { persons = 2 } = {}) {
  const line = db.prepare(`INSERT INTO reservation_options
    (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (1, ?, 1, ?, ?, ?, 0, 1)`);
  line.run(7, 30, 1, 'per_stay');
  line.run(8, 7, persons, 'per_person');
  line.run(9, 8, persons, 'per_person');
}

// What the fiche does on save: price the stay live, store the amount, and store the base and divisor
// behind it (rule 12). Without this the declaration would be reading a tax nobody ever computed.
function saveLikeTheFiche(db) {
  const stored = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  const quote = calculateReservationQuote({
    ...buildReservationEngineInput(db, stored),
    freezeTouristTax: false,
  });
  db.prepare('UPDATE reservations SET touristTaxTotal = ?, touristTaxRate = ? WHERE id = 1')
    .run(quote.touristTaxTotal, quote.touristTaxRate);
  writeTouristTaxSnapshot(db, 1, quote);
  return quote;
}

test('the declaration shows the amount the fiche stored, and a base that reproduces it', () => {
  const { db, model } = seedDb();
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m });
  insertInclusions(db);
  const quote = saveLikeTheFiche(db);

  const row = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(row.taxAmount, quote.touristTaxTotal);
  assert.equal(row.taxAmount, 15);                    // 359,79 € minus the 60 € of inclusions
  assert.equal(row.includedServicesDeduction, 60);    // 30 + 7×2 + 8×2

  // The line answers itself: base ÷ nuits ÷ occupants × 5 % + 10 % dep × nuits × adultes = taxAmount.
  assert.equal(row.accommodationAmount, 272.55);
  assert.equal(row.nightPricePerOccupantHt, 45.43);   // 272,55 ÷ 3 ÷ 2
  const municipal = Math.round(row.nightPricePerOccupantHt * 5) / 100;
  const unit = Math.round((municipal + Math.round(municipal * 10) / 100) * 100) / 100;
  assert.equal(Math.round(unit * 3 * 2 * 100) / 100, row.taxAmount);
});

// Rule 3 of tourist-tax-included-services-deduction.md, seen through the declaration: the forfait
// does not follow the party.
test('the deduction does not grow with the party — the linen is sold for four, deducted for two', () => {
  const { db, model } = seedDb();
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m, persons: 4 });
  insertInclusions(db, { persons: 4 });               // 7 × 4 and 8 × 4 are SOLD
  saveLikeTheFiche(db);

  const row = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(row.includedServicesDeduction, 60);    // …30 + 7×2 + 8×2 is DEDUCTED
});

test('a one-off commercial gesture is not deducted from the declaration either', () => {
  const { db, model } = seedDb();
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m });
  // Offered, but not a property default → « Offert », not « Comprise ».
  db.prepare(`INSERT INTO reservation_options
    (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
    VALUES (1, 11, 1, 45, 1, 'per_stay', 0, 1)`).run();
  saveLikeTheFiche(db);

  const row = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(row.includedServicesDeduction, 0);
  assert.equal(row.taxAmount, 18);
});

test('a per-day-per-person property is untouched — no deduction, no night price to report', () => {
  const { db, model } = seedDb({ mode: 'per_day_per_person' });
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m });
  insertInclusions(db);
  saveLikeTheFiche(db);

  const row = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(row.taxAmount, 7.2);                   // 1,20 € × 2 adultes × 3 nuits
  assert.equal(row.includedServicesDeduction, 0);
  assert.equal(row.nightPricePerOccupantHt, null);    // the table prints « — »
  assert.equal(row.accommodationAmount, 327.08);      // 359,79 € HT — unchanged by the inclusions
});

// The defect this spec exists to remove: a fiche re-priced under a NEW rule after the guest had paid,
// with the declaration reporting the new base beside the old amount. The base is pinned with the
// amount now, so neither a rate change nor a re-priced night reaches a collected stay.
test('a repriced property does not move a collected line, base included', () => {
  const { db, model } = seedDb();
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m });
  insertInclusions(db);
  saveLikeTheFiche(db);
  const before = model.getTouristTaxExtraction({ month }).data.reservations[0];

  db.prepare('UPDATE properties SET touristTaxPercentage = 10 WHERE id = 1').run();
  db.prepare('UPDATE reservation_nights SET price = 250 WHERE reservationId = 1').run();

  const after = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(after.taxAmount, before.taxAmount);
  assert.equal(after.accommodationAmount, before.accommodationAmount);
  assert.equal(after.nightPricePerOccupantHt, before.nightPricePerOccupantHt);
});

// A legacy row the backfill could not rebuild a base for (rule 14): the amount is still pinned, and
// the page falls back to describing the stay rather than showing nothing.
test('a frozen row with no stored base still declares its amount', () => {
  const { db, model } = seedDb();
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m });
  insertInclusions(db);
  db.prepare(`UPDATE reservations
    SET touristTaxTotal = 12.34, touristTaxRate = 5, touristTaxFrozenAt = '2026-09-01 12:00:00'
    WHERE id = 1`).run();

  const row = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(row.taxAmount, 12.34, 'the stored amount wins over any recompute');
  assert.equal(row.nightPricePerOccupantHt, 45.43);
});
