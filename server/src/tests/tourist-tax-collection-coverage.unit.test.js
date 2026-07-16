// Tourist-tax collection coverage (specs/per-platform-tourist-tax-collection.md):
//   1. Suivi Financier → Taxe de séjour: a platform-collected stay is EXCLUDED from the tax-to-remit,
//      an owner-collected ("Vous") and a direct stay are INCLUDED. Simulated end-to-end via a seeded DB.
//   2. Suivi Financier → Comptabilité: an owner-collected stay surfaces the tourist tax on a dedicated
//      `46710000` pass-through line of the accounting detail AND of the CSV export; a platform-collected
//      stay surfaces no such line.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const financeModel = require('../models/financeModel');
const { __test: { buildEntry } } = require('../models/accountingModel');
const { CSV_HEADERS, buildRows } = require('../utils/accountingExport');
const { serializeCsv } = require('../utils/csv');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 1. Suivi Financier → Taxe de séjour (financeModel.getTouristTaxExtraction)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const pad2 = (n) => String(n).padStart(2, '0');

// A month strictly in the past (getTouristTaxExtraction accepts up to and including the current
// month, never the future), plus a stay that ends inside it (its last night falls in the month).
function previousMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { month: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, year: d.getFullYear(), m: d.getMonth() + 1 };
}

function currentMonth() {
  const now = new Date();
  return { month: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`, year: now.getFullYear(), m: now.getMonth() + 1 };
}

function seedTaxDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  // A property with a per-day-per-person tourist tax so the extraction has a non-zero amount.
  db.prepare(`INSERT INTO properties (id, name, touristTaxPerDayPerPerson, touristTaxMode, basePriceIncludedGuests, extraGuestPrice)
              VALUES (1, 'Gite', 1.0, 'per_day_per_person', 0, 0)`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  // The tourist-tax mode is GLOBAL per platform (specs/per-platform-tourist-tax-three-way.md), stored
  // on `platforms`. One platform per handling; the reservations below use the manual label so the
  // Suivi filter matches platforms.name directly:
  //   Airbnb  → collects + remits to commune itself (1, 1) → NOT remitted by us → excluded from the page.
  //   Expedia → collects then reverses to us           (1, 0) → remitted by us → INCLUDED in the page.
  //   Booking → we collect at arrival                  (0, 0) → remitted by us → INCLUDED in the page.
  const insPlatform = db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (?, ?, ?)');
  insPlatform.run('Airbnb', 1, 1);
  insPlatform.run('Expedia', 1, 0);
  insPlatform.run('Booking', 0, 0);
  return { db, model: financeModel.buildModel(db) };
}

function insertStay(db, { id, platform, year, m }) {
  // 2-night stay: arrival on the 14th, departure on the 16th → last night = 15th, inside the month.
  const start = `${year}-${pad2(m)}-14`;
  const end = `${year}-${pad2(m)}-16`;
  // specs/tourist-tax-on-solde.md — the tax now appears in the month its échéance is PAID. Mark BOTH the
  // solde and the complement paid inside the month (the 15th) so the stay surfaces whether the tax rides
  // on the solde (direct / platform-reverses) or on the complement (we collect at arrival).
  const paid = `${year}-${pad2(m)}-15`;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, touristTaxRate, touristTaxTotal, finalPrice, totalPrice,
                balanceAmount, balancePaid, balancePaidDate, complementAmount, complementPaid, complementPaidDate)
              VALUES (?, 'reservation', 1, 1, ?, ?, ?, 2, 1.0, 4.0, 300, 300, 300, 1, ?, 4.0, 1, ?)`).run(id, start, end, platform, paid, paid);
}

test('Taxe de séjour: platform-remits stay is excluded; platform-reverses + owner-collected + direct are included', () => {
  const { db, model } = seedTaxDb();
  const { month, year, m } = previousMonth();
  insertStay(db, { id: 1, platform: 'direct', year, m });   // direct → always remitted by us
  insertStay(db, { id: 2, platform: 'Airbnb', year, m });   // platform collects + remits → EXCLUDED
  insertStay(db, { id: 3, platform: 'Booking', year, m });  // we collect at arrival → INCLUDED
  insertStay(db, { id: 4, platform: 'Expedia', year, m });  // platform reverses to us → INCLUDED (case 1)

  const res = model.getTouristTaxExtraction({ month });
  assert.equal(res.ok, true);
  const ids = res.data.reservations.map((r) => r.reservationId).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 3, 4], 'direct + owner-collected + platform-reversed stays are in the tax-to-remit');
  assert.ok(!ids.includes(2), 'the platform-remits (Airbnb) stay is NOT remitted by us');
  // Each remitted stay carries a positive tax (2 adults × 2 nights × 1.0 = 4.00). The Expedia stay's
  // tax is offered on the quote (touristTaxTotal = 0) but the Suivi recomputes it from nights/persons.
  for (const r of res.data.reservations) assert.ok(r.taxAmount > 0, `stay ${r.reservationId} has tax`);
});

test('Taxe de séjour: when ALL non-direct stays are platform-collected, only direct remains', () => {
  const { db, model } = seedTaxDb();
  const { month, year, m } = previousMonth();
  insertStay(db, { id: 1, platform: 'direct', year, m });
  insertStay(db, { id: 2, platform: 'Airbnb', year, m }); // platform collects → excluded
  const res = model.getTouristTaxExtraction({ month });
  assert.deepEqual(res.data.reservations.map((r) => r.reservationId), [1]);
});

test('Taxe de séjour: a MULTI-WORD owner-collected platform (manual stay) is still in the tax-to-remit', () => {
  // Regression for the platformKey/platformLabel divergence: iCal stores the hyphenated key, a manual
  // reservation stores the concatenated label. The extraction must match EITHER (specs/platforms-and-ical-rework.md).
  const { db, model } = seedTaxDb();
  const { month, year, m } = previousMonth();
  // Owner-collected multi-word platform: the GLOBAL mode lives on platforms (label 'GitesDeFrance',
  // 0,0 = we remit); an ical_sources row bridges the hyphenated key 'g-tes-de-france' to that label.
  db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (?, 0, 0)').run('GitesDeFrance');
  db.prepare(`INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor)
              VALUES (1, 'Gîtes de France', '', 'g-tes-de-france', 'GitesDeFrance', '#e6c832')`).run();
  insertStay(db, { id: 1, platform: 'GitesDeFrance', year, m });    // manual path → platform = label → direct match
  insertStay(db, { id: 2, platform: 'g-tes-de-france', year, m });  // iCal path → platform = key → bridge match

  const res = model.getTouristTaxExtraction({ month });
  assert.deepEqual(res.data.reservations.map((r) => r.reservationId).sort((a, b) => a - b), [1, 2],
    'both the manual-label and the iCal-key stays of an owner-collected multi-word platform are remitted by us');
});

test('Taxe de séjour: the CURRENT month is accepted (declarations run up to the month in progress)', () => {
  // Regression: the page failed with « Seuls les mois déjà passés sont autorisés. » on the current
  // month. getTouristTaxExtraction now accepts up to and including the month in progress.
  const { db, model } = seedTaxDb();
  const { month, year, m } = currentMonth();
  insertStay(db, { id: 1, platform: 'direct', year, m });   // direct → remitted by us, included
  insertStay(db, { id: 2, platform: 'Booking', year, m });  // we collect at arrival → included

  const res = model.getTouristTaxExtraction({ month });
  assert.equal(res.ok, true, 'the current month is no longer rejected');
  assert.deepEqual(res.data.reservations.map((r) => r.reservationId).sort((a, b) => a - b), [1, 2]);
});

// specs/tourist-tax-on-solde.md — the declaration is driven by the month the tax is ENCASHED, not the
// month of the last night. For a direct/platform-reverses stay that is the balancePaidDate; an unpaid
// solde drops out of the declaration entirely.
function insertStayDetailed(db, { id, platform, nightsYear, nightsM, balancePaid, balancePaidDate }) {
  const start = `${nightsYear}-${pad2(nightsM)}-14`;
  const end = `${nightsYear}-${pad2(nightsM)}-16`;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, touristTaxRate, touristTaxTotal, finalPrice, totalPrice,
                balanceAmount, balancePaid, balancePaidDate, complementAmount, complementPaid, complementPaidDate)
              VALUES (?, 'reservation', 1, 1, ?, ?, ?, 2, 1.0, 4.0, 300, 300, 300, ?, ?, 0, 0, NULL)`)
    .run(id, start, end, platform, balancePaid, balancePaidDate);
}

test('Taxe de séjour: a direct stay surfaces in the month its SOLDE is paid, not the month of its last night', () => {
  const { db, model } = seedTaxDb();
  const nights = previousMonth();              // last night two-ish months back…
  const paid = currentMonth();                 // …but the solde is encashed in the current month.
  insertStayDetailed(db, {
    id: 1, platform: 'direct',
    nightsYear: nights.year, nightsM: nights.m,
    balancePaid: 1, balancePaidDate: `${paid.year}-${pad2(paid.m)}-09`,
  });

  // The month of the last night must NOT contain the stay (the tax isn't encashed yet there).
  const atNights = model.getTouristTaxExtraction({ month: nights.month });
  assert.equal(atNights.ok, true);
  assert.deepEqual(atNights.data.reservations.map((r) => r.reservationId), [], 'absent from the last-night month');

  // The month the solde is paid DOES contain it.
  const atPaid = model.getTouristTaxExtraction({ month: paid.month });
  assert.equal(atPaid.ok, true);
  assert.deepEqual(atPaid.data.reservations.map((r) => r.reservationId), [1], 'present in the solde-paid month');
});

test('Taxe de séjour: a stay whose solde is UNPAID disappears from the declaration', () => {
  const { db, model } = seedTaxDb();
  const { month, year, m } = previousMonth();
  insertStayDetailed(db, {
    id: 1, platform: 'direct',
    nightsYear: year, nightsM: m,
    balancePaid: 0, balancePaidDate: null,
  });
  const res = model.getTouristTaxExtraction({ month });
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.reservations.map((r) => r.reservationId), [], 'an unpaid solde is not yet declarable');
});

test('Taxe de séjour: a FUTURE month is still rejected', () => {
  const { model } = seedTaxDb();
  const now = new Date();
  const future = `${now.getFullYear() + 1}-01`;
  const res = model.getTouristTaxExtraction({ month: future });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.error, /futurs/i);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 2. Suivi Financier → Comptabilité (accounting entry detail + CSV export)
// ─────────────────────────────────────────────────────────────────────────────────────────────

function makeRow(overrides = {}) {
  return {
    id: 7, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Le Petit Gîte',
    finalPrice: 200, touristTaxTotal: 4.80, clientGrossAmount: null, platform: 'direct',
    depositAmount: 60, depositPaid: 1, depositPaidDate: '2026-08-15',
    balanceAmount: 140, balancePaid: 1, balancePaidDate: '2026-08-15',
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    ...overrides,
  };
}
// buildEntry(row, kind, perLineData, commissionContext, taxContext) — quote-free since
// specs/accounting-encaissement-effective-percent.md; the routing flag rides taxContext.
const csvLines = (entries) => serializeCsv(CSV_HEADERS, buildRows(entries), { bom: false }).split('\r\n').filter(Boolean);

test('Comptabilité: owner-collected tax → a dedicated 46710000 line in the entry detail + CSV', () => {
  // We collect (touristTaxCollectedOnArrival = true, i.e. the source's collectsTouristTax = 0). The tax
  // rides on the complement (pure-tax complement of 4.80).
  const row = makeRow({
    platform: 'gitedefrance',
    complementAmount: 4.80, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const entry = buildEntry(row, 'complement', null, null, { collectedOnArrival: true });
  assert.ok(entry, 'the owner-collected tax complement produces an accounting entry');
  assert.equal(entry.taxTtc, 4.80, 'the entry detail surfaces the tourist tax on its own (taxTtc)');

  const lines = csvLines([entry]);
  const taxLine = lines.find((l) => l.includes(';46710000;'));
  assert.ok(taxLine, 'the CSV export carries a dedicated 46710000 tourist-tax credit line');
  assert.ok(taxLine.includes('4,80'), 'the tourist-tax line holds the 4,80 € amount');
});

test('Comptabilité: platform-remits tax → NO 46710000 line (tax is the platform\'s business)', () => {
  // The platform collects + remits to the commune (touristTaxCollectedOnArrival = false, not reversed);
  // the stay carries no owner-side tax.
  const row = makeRow({ platform: 'airbnb', touristTaxTotal: 0 });
  const dep = buildEntry(row, 'deposit');
  const bal = buildEntry(row, 'balance');
  assert.equal(dep.taxTtc, 0);
  assert.equal(bal.taxTtc, 0);

  const lines = csvLines([dep, bal].filter(Boolean));
  assert.ok(!lines.some((l) => l.includes(';46710000;')), 'no tourist-tax pass-through line for a platform-remits stay');
});

test('Comptabilité: platform-reversed tax (case 1) → the tax rides the balance on a 46710000 line', () => {
  // The platform collects the tax then reverses it to us at settlement (single platform payout → the
  // `balance` entry, deposit=0). The tax is now a REAL charge stored in `touristTaxTotal` and scheduled
  // in the balance, so the STANDARD tax-in-balance path books it on 46710000 (no special casing).
  const row = makeRow({
    platform: 'expedia', touristTaxTotal: 4.80,
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 204.80, balancePaid: 1, balancePaidDate: '2026-08-15',
  });
  const bal = buildEntry(row, 'balance');
  assert.ok(bal, 'the balance entry is emitted');
  assert.equal(bal.taxTtc, 4.80, 'the tax surfaces on its own (taxTtc)');
  assert.equal(bal.encaissementTtc, 204.80, 'the payout we banked = stay 200 + tax 4.80');

  const lines = csvLines([bal]);
  const taxLine = lines.find((l) => l.includes(';46710000;'));
  assert.ok(taxLine, 'the CSV export carries a dedicated 46710000 tourist-tax credit line');
  assert.ok(taxLine.includes('4,80'), 'the tourist-tax line holds the 4,80 € amount');
});
