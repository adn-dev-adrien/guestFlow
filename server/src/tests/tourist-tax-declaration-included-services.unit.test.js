// specs/tourist-tax-included-services-deduction.md rules 14-15 — the « Suivi financier → Taxe de
// séjour » page RECOMPUTES the tax instead of reading the stored one, so it has to apply the same
// deduction as the fiche: otherwise the operator validates 13,05 € on the reservation and declares
// 14,85 € to the commune. It also reports the assiette the commune's percentage form asks for — the
// cost of one night per occupant, HT.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const pad2 = (n) => String(n).padStart(2, '0');

// The CURRENT month on purpose: a stay whose last night falls before the 1st of it is frozen
// (specs/tourist-tax-freeze-past-with-refresh.md) and declares its stored amount — which is exactly
// what its fiche shows, and what the last test below pins. Everything else here exercises the live
// recompute, i.e. the fiche of a stay that is not frozen yet.
function currentMonth() {
  const now = new Date();
  return { month: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`, year: now.getFullYear(), m: now.getMonth() + 1 };
}

function previousMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { month: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, year: d.getFullYear(), m: d.getMonth() + 1 };
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

test('the declaration deducts the services included in the rate, exactly like the fiche', () => {
  const { db, model } = seedDb();
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m });

  const before = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(before.taxAmount, 18);                 // 359,79 € → 18,00 €
  assert.equal(before.includedServicesDeduction, 0);

  insertInclusions(db);
  const after = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(after.includedServicesDeduction, 60);  // 30 + 7×2 + 8×2
  assert.equal(after.taxAmount, 15);                  // the amount the fiche shows
});

test('the declaration reports the night cost per occupant, HT', () => {
  const { db, model } = seedDb();
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m });
  insertInclusions(db);

  const row = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(row.nightPricePerOccupantHt, 45.43);   // (299,79 ÷ 3 ÷ 1,10) ÷ 2 occupants
  // « Montant hébergement HT » is that same base for the stay, so the operator can re-derive it:
  // 272,55 ÷ 3 nuits ÷ 2 occupants = 45,43 €.
  assert.equal(row.accommodationAmount, 272.55);
});

// Rule 3 again, this time through the declaration: the forfait does not follow the party.
test('the deduction does not grow with the party — the linen is sold for four, deducted for two', () => {
  const { db, model } = seedDb();
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m, persons: 4 });
  insertInclusions(db, { persons: 4 });               // 7 × 4 and 8 × 4 are SOLD

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

  const row = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(row.includedServicesDeduction, 0);
  assert.equal(row.taxAmount, 18);
});

test('a per-day-per-person property is untouched — no deduction, no night price to report', () => {
  const { db, model } = seedDb({ mode: 'per_day_per_person' });
  const { month, year, m } = currentMonth();
  insertStay(db, { year, m });
  insertInclusions(db);

  const row = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(row.taxAmount, 7.2);                   // 1,20 € × 2 adultes × 3 nuits
  assert.equal(row.includedServicesDeduction, 0);
  assert.equal(row.nightPricePerOccupantHt, null);    // the table prints « — »
  assert.equal(row.accommodationAmount, 327.08);      // 359,79 € HT — unchanged by the inclusions
});

// The other half of « exactly what the fiche shows »: a PAST stay is frozen on the fiche and declares
// the amount stored at its last save, whatever a live recompute would say today
// (specs/tourist-tax-freeze-past-with-refresh.md, unchanged by this spec).
test('a past stay declares its frozen amount, like its fiche', () => {
  const { db, model } = seedDb();
  const { month, year, m } = previousMonth();
  insertStay(db, { year, m });
  insertInclusions(db);
  db.prepare('UPDATE reservations SET touristTaxTotal = 12.34, touristTaxRate = 5 WHERE id = 1').run();

  const row = model.getTouristTaxExtraction({ month }).data.reservations[0];
  assert.equal(row.taxAmount, 12.34, 'the stored amount wins over any recompute');
  // The base columns still describe the stay, so the declaration form can be filled in.
  assert.equal(row.nightPricePerOccupantHt, 45.43);
});
