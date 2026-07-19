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
  // specs/tourist-tax-declaration-month-stay-end.md — a stay is declared in its last-night month once
  // its tax-carrying échéance is paid (a later payment shifts it to the payment month). Mark BOTH the
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

// specs/tourist-tax-declaration-month-stay-end.md — the declaration follows the STAY: last-night month,
// unless the tax-carrying échéance is paid LATER (→ payment month). Payment stays a gate: an unpaid
// stay never appears, so a never-collected tax is never remitted.
function monthsAgo(n) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
  return { month: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, year: d.getFullYear(), m: d.getMonth() + 1 };
}

function insertStayDetailed(db, {
  id, platform, nightsYear, nightsM, startDate, endDate,
  balancePaid = 0, balancePaidDate = null, complementPaid = 0, complementPaidDate = null,
}) {
  const start = startDate || `${nightsYear}-${pad2(nightsM)}-14`;
  const end = endDate || `${nightsYear}-${pad2(nightsM)}-16`;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, touristTaxRate, touristTaxTotal, finalPrice, totalPrice,
                balanceAmount, balancePaid, balancePaidDate, complementAmount, complementPaid, complementPaidDate)
              VALUES (?, 'reservation', 1, 1, ?, ?, ?, 2, 1.0, 4.0, 300, 300, 300, ?, ?, 4.0, ?, ?)`)
    .run(id, start, end, platform, balancePaid, balancePaidDate, complementPaid, complementPaidDate);
}

test('Taxe de séjour: a solde paid BEFORE the stay ends → declared in the last-night month, not the payment month', () => {
  const { db, model } = seedTaxDb();
  const nights = previousMonth();              // last night in the previous month…
  const paid = monthsAgo(3);                   // …but the solde was encashed 3 months ago.
  insertStayDetailed(db, {
    id: 1, platform: 'direct',
    nightsYear: nights.year, nightsM: nights.m,
    balancePaid: 1, balancePaidDate: `${paid.year}-${pad2(paid.m)}-09`,
  });

  const atPaid = model.getTouristTaxExtraction({ month: paid.month });
  assert.equal(atPaid.ok, true);
  assert.deepEqual(atPaid.data.reservations.map((r) => r.reservationId), [], 'absent from the early payment month');

  const atNights = model.getTouristTaxExtraction({ month: nights.month });
  assert.equal(atNights.ok, true);
  assert.deepEqual(atNights.data.reservations.map((r) => r.reservationId), [1], 'present in the last-night month');
});

test('Taxe de séjour: a LATE-paid solde moves the declaration to the payment month (never retroactive)', () => {
  const { db, model } = seedTaxDb();
  const nights = previousMonth();              // last night in the previous month…
  const paid = currentMonth();                 // …but the solde is only encashed in the current month.
  insertStayDetailed(db, {
    id: 1, platform: 'direct',
    nightsYear: nights.year, nightsM: nights.m,
    balancePaid: 1, balancePaidDate: `${paid.year}-${pad2(paid.m)}-09`,
  });

  // The already-declarable last-night month must NOT contain the stay (its tax wasn't collected yet).
  const atNights = model.getTouristTaxExtraction({ month: nights.month });
  assert.equal(atNights.ok, true);
  assert.deepEqual(atNights.data.reservations.map((r) => r.reservationId), [], 'absent from the last-night month');

  const atPaid = model.getTouristTaxExtraction({ month: paid.month });
  assert.equal(atPaid.ok, true);
  assert.deepEqual(atPaid.data.reservations.map((r) => r.reservationId), [1], 'present in the late payment month');
});

test('Taxe de séjour: a checkout on the 1st belongs to the PREVIOUS month (all taxed nights are in it)', () => {
  const { db, model } = seedTaxDb();
  const prev = previousMonth();
  const cur = currentMonth();
  insertStayDetailed(db, {
    id: 1, platform: 'direct',
    startDate: `${prev.year}-${pad2(prev.m)}-27`,
    endDate: `${cur.year}-${pad2(cur.m)}-01`,   // last night = last day of the previous month
    balancePaid: 1, balancePaidDate: `${prev.year}-${pad2(prev.m)}-10`,
  });

  const atPrev = model.getTouristTaxExtraction({ month: prev.month });
  assert.deepEqual(atPrev.data.reservations.map((r) => r.reservationId), [1], 'declared in the last-night month');
  const atCur = model.getTouristTaxExtraction({ month: cur.month });
  assert.deepEqual(atCur.data.reservations.map((r) => r.reservationId), [], 'absent from the checkout month');
});

test('Taxe de séjour: paid flag set but paid DATE missing (legacy row) → last-night month', () => {
  const { db, model } = seedTaxDb();
  const nights = previousMonth();
  insertStayDetailed(db, {
    id: 1, platform: 'direct',
    nightsYear: nights.year, nightsM: nights.m,
    balancePaid: 1, balancePaidDate: null,
  });
  const res = model.getTouristTaxExtraction({ month: nights.month });
  assert.deepEqual(res.data.reservations.map((r) => r.reservationId), [1], 'a dateless paid solde falls back to the stay-end month');
});

test('Taxe de séjour: tax collected ON ARRIVAL follows the same rule against the COMPLEMENT payment', () => {
  const { db, model } = seedTaxDb();
  const nights = previousMonth();
  const early = monthsAgo(3);
  const late = currentMonth();
  // Booking = « we collect at arrival » (complement carries the tax; the solde is irrelevant here).
  insertStayDetailed(db, {
    id: 1, platform: 'Booking',
    nightsYear: nights.year, nightsM: nights.m,
    complementPaid: 1, complementPaidDate: `${early.year}-${pad2(early.m)}-09`,
  });
  insertStayDetailed(db, {
    id: 2, platform: 'Booking',
    nightsYear: nights.year, nightsM: nights.m,
    complementPaid: 1, complementPaidDate: `${late.year}-${pad2(late.m)}-09`,
  });
  insertStayDetailed(db, {
    id: 3, platform: 'Booking',
    nightsYear: nights.year, nightsM: nights.m,
    complementPaid: 0, complementPaidDate: null,
  });

  const atNights = model.getTouristTaxExtraction({ month: nights.month });
  assert.deepEqual(atNights.data.reservations.map((r) => r.reservationId), [1],
    'early-paid complement → last-night month; late-paid + unpaid → absent');
  const atLate = model.getTouristTaxExtraction({ month: late.month });
  assert.deepEqual(atLate.data.reservations.map((r) => r.reservationId), [2],
    'late-paid complement → payment month; unpaid still absent');
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
