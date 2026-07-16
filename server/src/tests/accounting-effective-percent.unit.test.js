const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { create: createAccountingModel, __test: { buildEntry } } = require('../models/accountingModel');
const { entryToRows, buildStructuredEntries } = require('../utils/accountingExport');

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Non-regression suite for specs/accounting-encaissement-effective-percent.md — one test per
// problem (P1..P7) Adrien reported on the Comptabilité page (2026-07-15), pinned on the exact
// prod reference: reservation #22224 (Thomas Vanden wildenberg, Lodgify, Aventura lodge).
//
//   Stored money: finalPrice 131,28 (accommodation 86,28 + options 21 + 24), tourist tax 2,98,
//   depositAmount = balanceAmount = 67,13 (Lodgify charged 50 % of the 134,26 gross),
//   acompteCommissionAmount = platformCommissionAmount = 1,93. Global VAT 10 %.
//
// Expected deposit entry:  CA 67,13 · commission 1,93 · net 65,20 (= CCLIENT debit) ·
//   credits 70600000 40,11 + 70600010 20,92 + 44571100 6,10 (effective % = 67,13/131,28 = 51,14 %).
// Expected balance entry:  CA 67,13 · net 65,20 · credits 38,33 + 19,99 + 5,83 + taxe 2,98.

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL, depositPercent REAL DEFAULT 30);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE pricing_rules (id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL, pricePerNight REAL NOT NULL DEFAULT 100);
    CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT, collectsTouristTax INTEGER DEFAULT 1, touristTaxRemittedByPlatform INTEGER DEFAULT 1);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, propertyId INTEGER, clientId INTEGER, kind TEXT DEFAULT 'reservation',
      startDate TEXT, endDate TEXT, checkInTime TEXT DEFAULT '15:00', checkOutTime TEXT DEFAULT '10:00',
      adults INTEGER DEFAULT 2, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
      platform TEXT DEFAULT 'direct', discountPercent REAL DEFAULT 0, customPrice REAL,
      depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT,
      balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT,
      complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT,
      complementPaidCash INTEGER DEFAULT 0,
      endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0,
      finalPrice REAL DEFAULT 0, clientGrossAmount REAL, platformCommissionAmount REAL, acompteCommissionAmount REAL,
      totalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, touristTaxInComplement INTEGER DEFAULT 0,
      accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL,
      touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL
    );
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, optionId));
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, resourceId));
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, platformKey TEXT, platformLabel TEXT);
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name, depositPercent) VALUES (1, 'Aventura lodge', 30)").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight) VALUES (1, 1, 110)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Thomas', 'Vanden wildenberg')").run();
  // Lodgify collects the tax from the guest and reverses it to us → the tax is a real charge
  // in the schedule (rides the solde), never a check-in complement.
  db.prepare("INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES ('Lodgify', 1, 0)").run();
  return db;
}

function insertThomas(db, overrides = {}) {
  const r = {
    propertyId: 1, clientId: 1, startDate: '2026-07-19', endDate: '2026-07-20',
    platform: 'Lodgify', finalPrice: 131.28, totalPrice: 110, touristTaxTotal: 2.98,
    depositAmount: 67.13, depositPaid: 1, depositPaidDate: '2026-06-22',
    balanceAmount: 67.13, balancePaid: 1, balancePaidDate: '2026-06-29',
    acompteCommissionAmount: 1.93, platformCommissionAmount: 1.93,
    ...overrides,
  };
  const cols = Object.keys(r);
  const id = db.prepare(
    `INSERT INTO reservations (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).run(...cols.map((k) => r[k])).lastInsertRowid;
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (?, 8, 1, 21)').run(id);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, totalPrice) VALUES (?, 6, 1, 24)').run(id);
  return id;
}

function thomasEntries(db) {
  const entries = createAccountingModel(db).encaissementsByMonth({ month: 6, year: 2026 });
  return {
    deposit: entries.find((e) => e.kind === 'deposit'),
    balance: entries.find((e) => e.kind === 'balance'),
  };
}

function creditByAccount(entry, account) {
  const line = entryToRows(entry).find((r) => r[6] === account && typeof r[8] === 'number' && r[8] > 0);
  return line ? line[8] : null;
}

test('P1 — deposit CA (encaissementTtc) = the stored depositAmount, not a grossRatio-shrunk value', () => {
  // Pre-fix: 65,64 (= 67,13 × 131,28/134,26 — the ratio numerator forgot the tourist tax).
  const db = createDb();
  insertThomas(db);
  const { deposit } = thomasEntries(db);
  assert.equal(round2(deposit.encaissementTtc), 67.13);
});

test('P2 — deposit net perçu = depositAmount − acompteCommissionAmount (the fiche résa « Acompte » line)', () => {
  // Pre-fix: 63,71. Expected: 67,13 − 1,93 = 65,20.
  const db = createDb();
  insertThomas(db);
  const { deposit } = thomasEntries(db);
  assert.equal(round2(deposit.encaissementNetTtc), 65.20);
  const structured = buildStructuredEntries([deposit])[0];
  assert.equal(structured.platform.net, 65.20);
});

test('P3 — the CCLIENT debit line = the net perçu (bank movement)', () => {
  const db = createDb();
  insertThomas(db);
  const { deposit } = thomasEntries(db);
  const rows = entryToRows(deposit);
  const clientRow = rows.find((r) => String(r[6]).startsWith('C'));
  assert.equal(clientRow[7], 65.20);
});

test('P4 — the commission debit = acompteCommissionAmount; VAT split when the platform has VAT on commission', () => {
  const db = createDb();
  insertThomas(db);
  const { deposit, balance } = thomasEntries(db);
  assert.equal(round2(deposit.commission.ttc), 1.93);
  assert.equal(round2(balance.commission.ttc), 1.93);
  // Lodgify has no VAT on its commission → single HT debit.
  assert.equal(deposit.commission.hasVat, false);
  assert.equal(round2(deposit.commission.ht), 1.93);

  // VAT-on-commission variant (pure-function, synthetic context): the 1,93 splits into
  // HT + a 44566000 deductible-VAT debit at vatRateCommission (20 %).
  const vatContext = {
    defaultAccount: '622600', vatRateCommission: 20, vatRate: 10,
    platformByName: new Map([['greengo', { name: 'Greengo', commissionAccountNumber: '62260600', hasVatOnCommission: 1 }]]),
  };
  const row = {
    id: 9, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Lodge',
    platform: 'Greengo', finalPrice: 131.28, totalPrice: 131.28, touristTaxTotal: 2.98, touristTaxInComplement: 0,
    clientGrossAmount: null, acompteCommissionAmount: 1.93, platformCommissionAmount: 1.93,
    depositAmount: 67.13, depositPaid: 1, depositPaidDate: '2026-06-22',
    balanceAmount: 67.13, balancePaid: 1, balancePaidDate: '2026-06-29',
    complementAmount: 0, complementPaid: 0, complementPaidDate: null,
    accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
    touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
  };
  const entry = buildEntry(row, 'deposit', null, vatContext);
  assert.equal(entry.commission.hasVat, true);
  assert.equal(entry.commission.account, '62260600');
  assert.equal(round2(entry.commission.ht), 1.61);   // 1,93 / 1,20
  assert.equal(round2(entry.commission.vat), 0.32);  // 1,93 − 1,61
  assert.equal(entry.commission.vatAccount, '44566000');
  // The entry still balances: net + commission HT + commission VAT = CA.
  const rows = entryToRows(entry);
  const sumDebits = round2(rows.reduce((s, r) => s + (typeof r[7] === 'number' ? r[7] : 0), 0));
  const sumCredits = round2(rows.reduce((s, r) => s + (typeof r[8] === 'number' ? r[8] : 0), 0));
  assert.equal(sumDebits, 67.13);
  assert.equal(sumCredits, 67.13);
});

test('P5 — « Location gîte » credit = STORED accommodation HT × effective %, immune to pricing-rule drift', () => {
  // Pre-fix: 48,50 — the bucket came from a quote recomputed with CURRENT pricing rules, which
  // had drifted since the booking was paid. Expected: (131,28 − 45)/1,10 × 51,14 % = 40,11.
  const db = createDb();
  insertThomas(db);
  const before = creditByAccount(thomasEntries(db).deposit, '70600000');
  assert.equal(before, 40.11);

  // Drift the pricing rules wildly after the booking was paid → the entry must not move.
  db.prepare('UPDATE pricing_rules SET pricePerNight = pricePerNight * 3').run();
  const after = creditByAccount(thomasEntries(db).deposit, '70600000');
  assert.equal(after, 40.11);
});

test('P6 — options credit = STORED options HT × effective %', () => {
  // Pre-fix: 9,55 (drift + residue absorption garbage). Expected: 45/1,10 × 51,14 % = 20,92.
  const db = createDb();
  insertThomas(db);
  const { deposit } = thomasEntries(db);
  assert.equal(creditByAccount(deposit, '70600010'), 20.92);
});

test('P7 — VAT credit = global vatRate on (gîte HT + options HT) shares', () => {
  // Expected: 10 % × (40,11 + 20,92) = 6,10, on the 44571100 account.
  const db = createDb();
  insertThomas(db);
  const { deposit } = thomasEntries(db);
  assert.equal(creditByAccount(deposit, '44571100'), 6.10);
});

test('balance entry mirror — CA 67,13 / net 65,20 / 38,33 + 19,99 + 5,83 + taxe 2,98, balanced', () => {
  const db = createDb();
  insertThomas(db);
  const { balance } = thomasEntries(db);
  assert.equal(round2(balance.encaissementTtc), 67.13);
  assert.equal(round2(balance.encaissementNetTtc), 65.20);
  assert.equal(round2(balance.taxTtc), 2.98, 'the WHOLE tourist tax rides the solde (tourist-tax-on-solde)');
  assert.equal(creditByAccount(balance, '70600000'), 38.33);
  assert.equal(creditByAccount(balance, '70600010'), 19.99);
  assert.equal(creditByAccount(balance, '44571100'), 5.83);
  assert.equal(creditByAccount(balance, '46710000'), 2.98);
  const structured = buildStructuredEntries([balance])[0];
  assert.equal(structured.balanced, true);
  assert.equal(structured.sumDebits, 67.13);
});

test('stayShare — the « % du séjour » caption value: 51 % on the deposit, 49 % on the balance', () => {
  const db = createDb();
  insertThomas(db);
  const { deposit, balance } = thomasEntries(db);
  const [sd, sb] = buildStructuredEntries([deposit, balance]);
  assert.equal(Math.round(sd.stayShare * 100), 51);   // 67,13 / 131,28
  assert.equal(Math.round(sb.stayShare * 100), 49);   // (67,13 − 2,98) / 131,28
});

test('back-compat — « solde = net » era row grosses up to the guest-paid total, WITH a tax in the schedule', () => {
  // Shape of prod #7 (GitesDeFrance) + a tourist tax to pin the fixed ratio numerator
  // (finalPrice + tax): finalPrice 994, tax 6, commission 91, stored balance = NET 909
  // (= 994 + 6 − 91). Expected: CA 1000 (guest-paid), net 909 (bank), tax 6 on the solde.
  const db = createDb();
  insertThomas(db, {
    platform: 'Lodgify', finalPrice: 994, totalPrice: 994, touristTaxTotal: 6,
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 909, balancePaid: 1, balancePaidDate: '2026-06-29',
    acompteCommissionAmount: 0, platformCommissionAmount: 91,
  });
  const { balance } = thomasEntries(db);
  assert.equal(round2(balance.encaissementTtc), 1000);
  assert.equal(round2(balance.encaissementNetTtc), 909);
  assert.equal(round2(balance.commission.ttc), 91);
  assert.equal(round2(balance.taxTtc), 6);
  const structured = buildStructuredEntries([balance])[0];
  assert.equal(structured.balanced, true);
});

test('back-compat — clientGrossAmount era row is unchanged (CA on gross, commission = gross − finalPrice)', () => {
  const db = createDb();
  insertThomas(db, {
    platform: 'Lodgify', finalPrice: 569, totalPrice: 569, touristTaxTotal: 0,
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 569, balancePaid: 1, balancePaidDate: '2026-06-29',
    acompteCommissionAmount: null, platformCommissionAmount: null, clientGrossAmount: 614,
  });
  const { balance } = thomasEntries(db);
  assert.equal(round2(balance.encaissementTtc), 614);
  assert.equal(round2(balance.encaissementNetTtc), 569);
  assert.equal(round2(balance.commission.ttc), 45);
});

test('direct reservation with automatic deposit — effective % equals the property depositPercent exactly', () => {
  // Direct, no override: depositAmount = 30 % × finalPrice (tax-free), balance = rest + tax.
  const db = createDb();
  insertThomas(db, {
    platform: 'direct', finalPrice: 200, totalPrice: 200, touristTaxTotal: 4.80,
    depositAmount: 60, depositPaid: 1, depositPaidDate: '2026-06-22',
    balanceAmount: 144.80, balancePaid: 1, balancePaidDate: '2026-06-29',
    acompteCommissionAmount: null, platformCommissionAmount: null,
  });
  const { deposit, balance } = thomasEntries(db);
  assert.equal(round2(deposit.fraction * 100), 30);
  assert.equal(round2(balance.fraction * 100), 70);
  assert.equal(deposit.taxTtc, 0);
  assert.equal(round2(balance.taxTtc), 4.80);
  for (const e of [deposit, balance]) {
    const s = buildStructuredEntries([e])[0];
    assert.equal(s.balanced, true);
  }
});

test('BRUT convention (Damien Nicolet) — the entered deposit/balance is the client-paid GROSS → CA = gross, net perçu = gross − commission', () => {
  // Resolved with Adrien 2026-07-16 (prod investigation on résa #22226, Lodgify). The amount the
  // operator enters for a platform échéance is the GROSS (what the guest pays). The accounting CA =
  // that stored amount; the « net perçu » (owner take = the fiche summary Acompte/Solde line) =
  // gross − the échéance commission. Damien's guest pays 126,38 per échéance (= Adrien's 122,97 net
  // take + 3,41 Lodgify commission), split evenly deposit = balance → CA 126,38 / net 122,97 each.
  // This is the SAME convention as Thomas (deposit = gross): it locks that a per-échéance-commission
  // reservation entered as gross never gets its CA grossed a second time.
  const db = createDb();
  insertThomas(db, {
    finalPrice: 250.38, totalPrice: 110, touristTaxTotal: 2.38,
    depositAmount: 126.38, depositPaid: 1, depositPaidDate: '2026-06-22',
    balanceAmount: 126.38, balancePaid: 1, balancePaidDate: '2026-06-29',
    acompteCommissionAmount: 3.41, platformCommissionAmount: 3.41,
  });
  const { deposit, balance } = thomasEntries(db);
  assert.equal(round2(deposit.encaissementTtc), 126.38, 'deposit CA = entered gross');
  assert.equal(round2(deposit.encaissementNetTtc), 122.97, 'deposit net = gross − commission');
  assert.equal(round2(balance.encaissementTtc), 126.38, 'balance CA = entered gross');
  assert.equal(round2(balance.encaissementNetTtc), 122.97, 'balance net = gross − commission');
  assert.equal(round2(deposit.commission.ttc), 3.41);
  assert.equal(round2(balance.commission.ttc), 3.41);
  // Tourist tax rides the solde only (Lodgify reverses it to us).
  assert.equal(deposit.taxTtc, 0);
  assert.equal(round2(balance.taxTtc), 2.38);
  for (const e of [deposit, balance]) {
    const s = buildStructuredEntries([e])[0];
    assert.equal(s.balanced, true, `${e.kind} entry must balance`);
  }
});
