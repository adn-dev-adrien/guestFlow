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

// A month strictly in the past (getTouristTaxExtraction only accepts already-closed months), plus a
// stay that ends inside it (its last night falls in the month).
function previousMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { month: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`, year: d.getFullYear(), m: d.getMonth() + 1 };
}

function seedTaxDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  // A property with a per-day-per-person tourist tax so the extraction has a non-zero amount.
  db.prepare(`INSERT INTO properties (id, name, touristTaxPerDayPerPerson, touristTaxMode, basePriceIncludedGuests, extraGuestPrice)
              VALUES (1, 'Gite', 1.0, 'per_day_per_person', 0, 0)`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  // Two iCal sources on the same property: Airbnb COLLECTS the tax (1), Booking does NOT (0 → we remit it).
  const insSrc = db.prepare(`INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor, collectsTouristTax)
                             VALUES (1, ?, ?, ?, ?, '#000000', ?)`);
  insSrc.run('Airbnb', 'https://airbnb/x.ics', 'airbnb', 'Airbnb', 1);
  insSrc.run('Booking', 'https://booking/x.ics', 'booking', 'Booking', 0);
  return { db, model: financeModel.buildModel(db) };
}

function insertStay(db, { id, platform, year, m }) {
  // 2-night stay: arrival on the 14th, departure on the 16th → last night = 15th, inside the month.
  const start = `${year}-${pad2(m)}-14`;
  const end = `${year}-${pad2(m)}-16`;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, touristTaxRate, touristTaxTotal, finalPrice, totalPrice)
              VALUES (?, 'reservation', 1, 1, ?, ?, ?, 2, 1.0, 4.0, 300, 300)`).run(id, start, end, platform);
}

test('Taxe de séjour: platform-collected stay is excluded; owner-collected + direct are included', () => {
  const { db, model } = seedTaxDb();
  const { month, year, m } = previousMonth();
  insertStay(db, { id: 1, platform: 'direct', year, m });   // direct → always remitted by us
  insertStay(db, { id: 2, platform: 'Airbnb', year, m });   // platform collects → EXCLUDED
  insertStay(db, { id: 3, platform: 'Booking', year, m });  // we collect → INCLUDED

  const res = model.getTouristTaxExtraction({ month });
  assert.equal(res.ok, true);
  const ids = res.data.reservations.map((r) => r.reservationId).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 3], 'only the direct + owner-collected stays are in the tax-to-remit');
  assert.ok(!ids.includes(2), 'the platform-collected (Airbnb) stay is NOT remitted by us');
  // Each remitted stay carries a positive tax (2 adults × 2 nights × 1.0 = 4.00).
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
  // Owner-collected multi-word platform: key 'g-tes-de-france', label 'GitesDeFrance'.
  db.prepare(`INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor, collectsTouristTax)
              VALUES (1, 'Gîtes de France', '', 'g-tes-de-france', 'GitesDeFrance', '#e6c832', 0)`).run();
  insertStay(db, { id: 1, platform: 'GitesDeFrance', year, m }); // manual path → platform = label

  const res = model.getTouristTaxExtraction({ month });
  assert.deepEqual(res.data.reservations.map((r) => r.reservationId), [1],
    'the owner-collected multi-word stay is remitted by us (matched via platformLabel)');
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
function makeQuote(overrides = {}) {
  return {
    finalPrice: 200,
    accommodationNetPrice: 181.82, accommodationVatAmount: 18.18, vatPercentageAccommodation: 10,
    optionsNetPrice: 0, optionsVatAmount: 0, vatPercentageOptions: 20,
    resourcesNetPrice: 0, resourcesVatAmount: 0, vatPercentageResources: 20,
    touristTaxCollectedOnArrival: false,
    ...overrides,
  };
}
const csvLines = (entries) => serializeCsv(CSV_HEADERS, buildRows(entries), { bom: false }).split('\r\n').filter(Boolean);

test('Comptabilité: owner-collected tax → a dedicated 46710000 line in the entry detail + CSV', () => {
  // We collect (touristTaxCollectedOnArrival = true, i.e. the source's collectsTouristTax = 0). The tax
  // rides on the complement (pure-tax complement of 4.80).
  const row = makeRow({
    platform: 'gitedefrance',
    complementAmount: 4.80, complementPaid: 1, complementPaidDate: '2026-08-20',
  });
  const quote = makeQuote({ touristTaxCollectedOnArrival: true });

  const entry = buildEntry(row, quote, 'complement');
  assert.ok(entry, 'the owner-collected tax complement produces an accounting entry');
  assert.equal(entry.taxTtc, 4.80, 'the entry detail surfaces the tourist tax on its own (taxTtc)');

  const lines = csvLines([entry]);
  const taxLine = lines.find((l) => l.includes(';46710000;'));
  assert.ok(taxLine, 'the CSV export carries a dedicated 46710000 tourist-tax credit line');
  assert.ok(taxLine.includes('4,80'), 'the tourist-tax line holds the 4,80 € amount');
});

test('Comptabilité: platform-collected tax → NO 46710000 line (tax is the platform\'s business)', () => {
  // The platform collects (touristTaxCollectedOnArrival = false); the stay carries no owner-side tax.
  const row = makeRow({ platform: 'airbnb', touristTaxTotal: 0 });
  const quote = makeQuote({ touristTaxCollectedOnArrival: false });

  const dep = buildEntry(row, quote, 'deposit');
  const bal = buildEntry(row, quote, 'balance');
  assert.equal(dep.taxTtc, 0);
  assert.equal(bal.taxTtc, 0);

  const lines = csvLines([dep, bal].filter(Boolean));
  assert.ok(!lines.some((l) => l.includes(';46710000;')), 'no tourist-tax pass-through line for a platform-collected stay');
});
