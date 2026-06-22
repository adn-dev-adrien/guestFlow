const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { __test: { buildEntry } } = require('../models/accountingModel');
const { entryToRows } = require('../utils/accountingExport');

// specs/platform-deposit-toggle.md — a platform flagged « acompte = Oui » uses the normal acompte/solde
// split (of the NET pre-arrival = pre-arrival − commission); « Non » (default) keeps the legacy
// single-payment behaviour. Accounting splits the commission pro rata across acompte + solde.

function round2(n) { return Math.round(n * 100) / 100; }

// ── Engine ──────────────────────────────────────────────────────────────────
function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      depositPercent REAL DEFAULT 30, depositDaysBefore INTEGER DEFAULT 30, balanceDaysBefore INTEGER DEFAULT 7,
      defaultCheckIn TEXT DEFAULT '15:00', defaultCheckOut TEXT DEFAULT '10:00',
      touristTaxPerDayPerPerson REAL DEFAULT 0, touristTaxMode TEXT DEFAULT 'per_day_per_person',
      touristTaxPercentage REAL DEFAULT 0, touristTaxDepartmentPercentage REAL DEFAULT 0, touristTaxFixedAmount REAL DEFAULT 0,
      basePriceIncludedGuests INTEGER DEFAULT 0, extraGuestPrice REAL DEFAULT 0
    );
    CREATE TABLE pricing_rules (
      id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, label TEXT DEFAULT 'Standard',
      pricePerNight REAL NOT NULL DEFAULT 100, pricingMode TEXT NOT NULL DEFAULT 'fixed',
      progressiveTiers TEXT NOT NULL DEFAULT '[]', dateRanges TEXT NOT NULL DEFAULT '[]',
      color TEXT NOT NULL DEFAULT '#1976d2', startDate TEXT, endDate TEXT, minNights INTEGER DEFAULT 1
    );
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT NOT NULL, priceType TEXT DEFAULT 'per_stay', price REAL DEFAULT 0, optionProgressiveTiers TEXT DEFAULT '[]', autoOptionType TEXT, autoEnabled INTEGER DEFAULT 0, autoPricingMode TEXT DEFAULT 'fixed', autoFullNightThreshold TEXT);
    CREATE TABLE property_options (propertyId INTEGER, optionId INTEGER, PRIMARY KEY (propertyId, optionId));
    CREATE TABLE resources (id INTEGER PRIMARY KEY, name TEXT, quantity INTEGER DEFAULT 0, price REAL DEFAULT 0, priceType TEXT DEFAULT 'per_stay', isComplex INTEGER DEFAULT 0, propertyIds TEXT DEFAULT '[]');
    CREATE TABLE property_resource_prices (propertyId INTEGER, resourceId INTEGER, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId));
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Lodge')").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run(); // 200 TTC for 2 nights
  return db;
}

const BASE = {
  propertyId: 1, startDate: '2026-07-10', endDate: '2026-07-12',
  checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0,
  selectedOptions: [], customOptions: [], selectedResources: [],
  discountPercent: 0, customPrice: '',
};

test('platform « Non » (default) keeps the legacy single-payment behaviour', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', platformTakesDeposit: 0 });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 200);
  db.close();
});

test('platform « Oui » splits the pre-arrival into acompte/solde (no commission → gross = net)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', platformTakesDeposit: 1 });
  assert.equal(q.depositAmount, 60);  // 30% of 200
  assert.equal(q.balanceAmount, 140);
  assert.equal(q.depositAmount + q.balanceAmount, 200);
  db.close();
});

test('platform « Oui » with a commission splits the NET pre-arrival (acompte + solde = net)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', platformTakesDeposit: 1, platformCommissionAmount: 30 });
  // net pre-arrival = 200 − 30 = 170 ; acompte = 30% × 170 = 51 ; solde = 119
  assert.equal(q.depositAmount, 51);
  assert.equal(q.balanceAmount, 119);
  assert.equal(round2(q.depositAmount + q.balanceAmount), 170); // = net perçu
  assert.equal(q.platformNetReceivedAmount, 170);
  db.close();
});

test('platform « Oui » with a manual acompte override → solde absorbs the rest of the net', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', platformTakesDeposit: 1, platformCommissionAmount: 30, depositAmountOverride: 40 });
  assert.equal(q.depositAmount, 40);
  assert.equal(q.balanceAmount, 130); // 170 − 40
  assert.equal(round2(q.depositAmount + q.balanceAmount), 170);
  db.close();
});

test('depositDisabled wins over a « Oui » platform (no acompte)', () => {
  const db = createDb();
  const q = calculateReservationQuote({ ...BASE, db, platform: 'Airbnb', platformTakesDeposit: 1, depositDisabled: true });
  assert.equal(q.depositAmount, 0);
  assert.equal(q.balanceAmount, 200);
  db.close();
});

// ── Accounting ────────────────────────────────────────────────────────────────
const acctQuote = {
  finalPrice: 300,
  vatPercentageAccommodation: 10, vatPercentageOptions: 10, vatPercentageResources: 10,
  accommodationNetPrice: 272.73, accommodationVatAmount: 27.27, // 300 TTC @ 10 %
  optionsNetPrice: 0, optionsVatAmount: 0, resourcesNetPrice: 0, resourcesVatAmount: 0,
  touristTaxCollectedOnArrival: false,
};
const commissionContext = {
  defaultAccount: '622600', vatRateCommission: 20,
  platformByName: new Map([['airbnb', { name: 'Airbnb', commissionAccountNumber: '62260300', hasVatOnCommission: 0 }]]),
  paymentMethodById: new Map(),
};
// Platform Airbnb « Oui », commission 30. net = 270 → acompte 81 (30%×270), solde 189 (both NET, as stored).
function depositRow() {
  return {
    id: 1, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Lodge',
    platform: 'Airbnb', finalPrice: 300, totalPrice: 300, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: null, platformCommissionAmount: 30,
    depositAmount: 81, depositPaid: 1, depositPaidDate: '2026-06-04',
    balanceAmount: 189, balancePaid: 1, balancePaidDate: '2026-06-20',
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
  };
}
function sumDebits(rows) { return round2(rows.reduce((s, r) => s + (typeof r[7] === 'number' ? r[7] : 0), 0)); }
function sumCredits(rows) { return round2(rows.reduce((s, r) => s + (typeof r[8] === 'number' ? r[8] : 0), 0)); }

test('accounting: commission split pro rata across acompte + solde; net cash per kind = stored amount', () => {
  const row = depositRow();
  const dep = buildEntry(row, acctQuote, 'deposit', null, commissionContext);
  const bal = buildEntry(row, acctQuote, 'balance', null, commissionContext);
  // commission 30 split 81:189 of 270 → 9 on acompte, 21 on solde.
  assert.equal(round2(dep.commission.ttc), 9);
  assert.equal(round2(bal.commission.ttc), 21);
  // Each échéance's net cash (bank movement) == its stored amount.
  assert.equal(round2(dep.encaissementNetTtc), 81);
  assert.equal(round2(bal.encaissementNetTtc), 189);
  // CA recognised on the gross: deposit 90 + balance 210 = finalPrice 300.
  assert.equal(round2(dep.encaissementTtc + bal.encaissementTtc), 300);
  // Both entries balance.
  for (const e of [dep, bal]) {
    const rows = entryToRows(e);
    assert.equal(sumDebits(rows), sumCredits(rows));
  }
});

test('accounting backward-compat: a no-acompte platform books the whole commission on the solde', () => {
  const row = { ...depositRow(), depositAmount: 0, depositPaid: 0, depositPaidDate: null, balanceAmount: 270 };
  const dep = buildEntry(row, acctQuote, 'deposit', null, commissionContext);
  const bal = buildEntry(row, acctQuote, 'balance', null, commissionContext);
  assert.equal(dep, null); // no acompte encaissement
  assert.equal(round2(bal.commission.ttc), 30); // whole commission on the solde
  assert.equal(round2(bal.encaissementNetTtc), 270);
});
