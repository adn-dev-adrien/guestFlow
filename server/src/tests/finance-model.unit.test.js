const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/finance-overview-rework.md — every revenue figure is Σ « total de séjour » (acompte + solde +
// complément + complément fin de séjour, the two complements EXCLUDED when caisse interne), a reservation
// counted by its DEPARTURE date (endDate). « Encaissé » = the accounting total (paid, excl. caisse
// interne). « En attente » = Σ total-séjour of PAST + non-settled reservations.
const financeModel = require('../models/financeModel');

const DDL = `
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    finalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0,
    depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balanceDueDate TEXT,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT, complementPaidCash INTEGER DEFAULT 0,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
    endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0,
    platformCommissionAmount REAL, acompteCommissionAmount REAL
  );
`;

function iso(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().split('T')[0];
}
const TODAY = new Date().toISOString().split('T')[0];

function freshModel() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite'), (2, 'Tente')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont'), (2, 'Marie', 'Martin')").run();
  return { db, model: financeModel.buildModel(db) };
}

const COLS = [
  'id', 'clientId', 'propertyId', 'startDate', 'endDate', 'platform', 'finalPrice', 'touristTaxTotal',
  'depositAmount', 'depositPaid', 'depositDueDate', 'depositDisabled',
  'balanceAmount', 'balancePaid', 'balanceDueDate',
  'complementAmount', 'complementPaid', 'complementPaidCash',
  'endOfStayComplementAmount', 'endOfStayComplementPaid', 'endOfStayComplementPaidCash',
  'platformCommissionAmount', 'acompteCommissionAmount',
];
const insertRes = (db, r) => db.prepare(
  `INSERT INTO reservations (${COLS.join(', ')}) VALUES (${COLS.map((c) => `@${c}`).join(', ')})`,
).run({
  platform: 'direct', finalPrice: 0, touristTaxTotal: 0,
  depositAmount: 0, depositPaid: 0, depositDueDate: null, depositDisabled: 0,
  balanceAmount: 0, balancePaid: 0, balanceDueDate: null,
  complementAmount: 0, complementPaid: 0, complementPaidCash: 0,
  endOfStayComplementAmount: 0, endOfStayComplementPaid: 0, endOfStayComplementPaidCash: 0,
  platformCommissionAmount: null, acompteCommissionAmount: null,
  ...r,
});

// ── total de séjour + summary totals ──────────────────────────────────────────────────

test('getSummary: revenueTotal = Σ total-de-séjour (acompte+solde+complément+fin de séjour), by endDate', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 150, balanceAmount: 350, complementAmount: 20, endOfStayComplementAmount: 30 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.revenueTotal, 550); // 150 + 350 + 20 + 30
});

test('getSummary: the total de séjour is NET of the platform commission (« total perçu »)', () => {
  // specs/fiche-total-sejour-net-of-commission.md — a platform reservation: acompte 100 + solde 300 +
  // commission (acompte 10 + solde 30 = 40) → total perçu = 400 − 40 = 360. Caisse-interne exclusion kept.
  const { db, model } = freshModel();
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), platform: 'airbnb',
    depositAmount: 100, balanceAmount: 300, platformCommissionAmount: 30, acompteCommissionAmount: 10,
  });
  // A direct reservation (no commission) is unchanged.
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), platform: 'direct', depositAmount: 0, balanceAmount: 200 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.revenueTotal, 560); // platform 360 (net of 40) + direct 200
});

test('getSummary: « Encaissé » (totalCollected) is NET of the commission of each paid échéance', () => {
  const { db, model } = freshModel();
  // Acompte 100 paid (− acompte commission 10 = 90) ; solde 300 NOT paid → not collected.
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), platform: 'airbnb',
    depositAmount: 100, depositPaid: 1, balanceAmount: 300, balancePaid: 0,
    platformCommissionAmount: 30, acompteCommissionAmount: 10,
  });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.totalCollected, 90); // 100 acompte − 10 acompte commission
});

// ── COMPREHENSIVE MATRIX: direct vs platform × tax-routing × complements × caisse interne ───────────
// The finance layer reads STORED amounts, so the tax-routing mode is captured by WHERE the tax sits:
//   - direct / reversed → tax baked in the balance (just a bigger balanceAmount);
//   - owner-collect      → tax sits in the arrival complementAmount;
//   - offered            → tax = 0 in the books (not stored at all).
// For each case we assert the three derived figures via getSummary (revenueTotal = Σ totalSejour,
// totalCollected = Σ comptaCollected) and the invariant collected + reste = total via getOperational.
const matrixCase = (label, row, expect) => test(`matrix — ${label}`, () => {
  const { db, model } = freshModel();
  // endDate in the PAST so the row is eligible for the pending list when unsettled.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-2), ...row });
  const summary = model.getSummary({ from: iso(-10), to: iso(10) });
  assert.equal(summary.revenueTotal, expect.total, 'total de séjour (net, caisse interne exclue)');
  assert.equal(summary.totalCollected, expect.collected, 'encaissé (net de commission, caisse interne exclue)');
  const op = model.getOperational();
  const pending = op.pending.reservations.find((x) => x.id === 1);
  if (expect.reste === 0) {
    assert.ok(!pending, 'settled → absent de la liste « en attente »');
  } else {
    assert.equal(pending.totalSejour, expect.total);
    assert.equal(pending.remainingToPay, expect.reste, 'reste à payer (net, caisse interne exclu)');
    assert.equal(round2(expect.collected + expect.reste), expect.total, 'invariant collected + reste = total');
  }
});
const round2 = (n) => Math.round(n * 100) / 100;

// Direct (commission 0) — unchanged behaviour.
matrixCase('direct, acompte payé + solde dû, sans complément', {
  platform: 'direct', depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 0,
}, { total: 300, collected: 100, reste: 200 });

matrixCase('direct + complément d arrivée dû (owner-style tax-in-complement), tout payé sauf complément', {
  platform: 'direct', balanceAmount: 200, balancePaid: 1, complementAmount: 50, complementPaid: 0,
}, { total: 250, collected: 200, reste: 50 });

matrixCase('direct + complément CAISSE INTERNE → exclu partout (settled)', {
  platform: 'direct', balanceAmount: 200, balancePaid: 1, complementAmount: 50, complementPaid: 1, complementPaidCash: 1,
}, { total: 200, collected: 200, reste: 0 });

// Platform with commission (acompte 10 + solde 30).
matrixCase('plateforme + commission, acompte payé + solde dû', {
  platform: 'airbnb', depositAmount: 100, depositPaid: 1, balanceAmount: 300, balancePaid: 0,
  platformCommissionAmount: 30, acompteCommissionAmount: 10,
}, { total: 360, collected: 90, reste: 270 });

matrixCase('plateforme + commission + complément d arrivée dû', {
  platform: 'airbnb', balanceAmount: 300, balancePaid: 1, complementAmount: 50, complementPaid: 0,
  platformCommissionAmount: 30,
}, { total: 320, collected: 270, reste: 50 }); // 300+50−30 ; encaissé 300−30 ; reste 50

matrixCase('plateforme + commission + complément d arrivée CAISSE INTERNE → exclu (settled)', {
  platform: 'airbnb', balanceAmount: 300, balancePaid: 1, complementAmount: 50, complementPaid: 1, complementPaidCash: 1,
  platformCommissionAmount: 30,
}, { total: 270, collected: 270, reste: 0 }); // compl cash exclu ; 300−30

matrixCase('plateforme + commission + complément FIN DE SÉJOUR caisse interne → exclu (settled)', {
  platform: 'airbnb', balanceAmount: 200, balancePaid: 1, endOfStayComplementAmount: 40, endOfStayComplementPaid: 1, endOfStayComplementPaidCash: 1,
  platformCommissionAmount: 20,
}, { total: 180, collected: 180, reste: 0 }); // eos cash exclu ; 200−20

matrixCase('plateforme + commission + complément FIN DE SÉJOUR normal (payé, hors caisse)', {
  platform: 'airbnb', balanceAmount: 200, balancePaid: 1, endOfStayComplementAmount: 40, endOfStayComplementPaid: 1,
  platformCommissionAmount: 20,
}, { total: 220, collected: 220, reste: 0 }); // eos compté ; 200−20+40

test('getOperational: « reste à payer » is NET of the commission of unpaid échéances; collected + reste = total', () => {
  // specs/fiche-total-sejour-net-of-commission.md — platform reservation, acompte 100 paid (− 10 = 90),
  // solde 300 unpaid (− 30 = 270). total perçu = 360 ; encaissé = 90 ; reste à payer = 270 ; 90+270=360.
  const { db, model } = freshModel();
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-2), platform: 'airbnb',
    depositAmount: 100, depositPaid: 1, balanceAmount: 300, balancePaid: 0,
    platformCommissionAmount: 30, acompteCommissionAmount: 10,
  });
  const op = model.getOperational();
  const row = op.pending.reservations.find((x) => x.id === 1);
  assert.equal(row.totalSejour, 360);
  assert.equal(row.remainingToPay, 270); // (300 − 30) ; the paid acompte is not owed
  // Invariant: what's collected (net) + what's still owed (net) = the total perçu.
  assert.equal(90 + row.remainingToPay, row.totalSejour); // 90 + 270 = 360
});

test('getSummary: caisse-interne complements are EXCLUDED from the total de séjour', () => {
  const { db, model } = freshModel();
  // Arrival complement 50 + end-of-stay 30, both caisse interne → excluded; only 150+350 count.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 150, balanceAmount: 350, complementAmount: 50, complementPaid: 1, complementPaidCash: 1, endOfStayComplementAmount: 30, endOfStayComplementPaid: 1, endOfStayComplementPaidCash: 1 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.revenueTotal, 500);
});

test('getSummary: totalCollected = accounting total (paid, EXCLUDING caisse interne)', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 150, depositPaid: 1, balanceAmount: 350, balancePaid: 0, complementAmount: 50, complementPaid: 1, complementPaidCash: 1 });
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.totalCollected, 150); // deposit paid; balance unpaid; caisse-interne complement excluded from compta
});

test('getSummary: totalPending = Σ total-de-séjour of PAST + non-settled only', () => {
  const { db, model } = freshModel();
  // Past + unpaid → counts the WHOLE stay total.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-2), depositAmount: 100, depositPaid: 0, balanceAmount: 200, balancePaid: 0 });
  // Future + unpaid → NOT pending (not past).
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), depositAmount: 100, balanceAmount: 200 });
  // Past + fully settled → NOT pending.
  insertRes(db, { id: 3, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-3), depositAmount: 100, depositPaid: 1, balanceAmount: 50, balancePaid: 1 });
  const summary = model.getSummary({ from: iso(-10), to: iso(10) });
  assert.equal(summary.totalPending, 300); // only res1's whole stay total
});

test('getSummary: a caisse-interne complement makes a past reservation settled → not pending', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-2), depositAmount: 100, depositPaid: 1, balanceAmount: 0, complementAmount: 40, complementPaid: 1, complementPaidCash: 1 });
  const summary = model.getSummary({ from: iso(-10), to: iso(10) });
  assert.equal(summary.totalPending, 0);
});

test('getSummary: revenueByProperty sums total-de-séjour per property, sorted desc', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(3), depositAmount: 100, balanceAmount: 200 }); // Gite 300
  insertRes(db, { id: 2, clientId: 1, propertyId: 1, startDate: iso(4), endDate: iso(6), depositAmount: 100, balanceAmount: 100 }); // Gite 200 → 500
  insertRes(db, { id: 3, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(4), depositAmount: 60, balanceAmount: 140 });  // Tente 200
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.deepEqual(summary.revenueByProperty.map((p) => [p.propertyName, p.revenue]), [['Gite', 500], ['Tente', 200]]);
  assert.equal(summary.revenueByProperty[0].collected, undefined); // single value now, no collected/pending split
});

test('getSummary: revenueByProperty is NET of the platform commission', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(3), platform: 'airbnb', depositAmount: 0, balanceAmount: 300, platformCommissionAmount: 50 }); // Gite 300 − 50 = 250
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(4), platform: 'direct', depositAmount: 0, balanceAmount: 200 }); // Tente 200 (direct, unchanged)
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.deepEqual(summary.revenueByProperty.map((p) => [p.propertyName, p.revenue]), [['Gite', 250], ['Tente', 200]]);
  assert.equal(summary.revenueTotal, 450); // 250 + 200
});

test('getSummary: yearToDate (Jan 1 → today) + yearTotal (full year), by endDate', () => {
  const { db, model } = freshModel();
  const Y = new Date().getFullYear();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: `${Y}-01-02`, endDate: `${Y}-01-05`, depositAmount: 100 }); // early this year
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: `${Y}-12-20`, endDate: `${Y}-12-25`, depositAmount: 100 }); // late this year
  const summary = model.getSummary({ from: `${Y}-01-01`, to: `${Y}-12-31` });
  const expectedYtd = (`${Y}-01-05` <= TODAY ? 100 : 0) + (`${Y}-12-25` <= TODAY ? 100 : 0);
  assert.equal(summary.yearToDate, expectedYtd);
  assert.equal(summary.yearTotal, 200);
});

test('getSummary: empty range → empty revenueByProperty (no crash)', () => {
  const { model } = freshModel();
  assert.deepEqual(model.getSummary({ from: iso(0), to: iso(10) }).revenueByProperty, []);
});

test('getSummary: a kind=devis row never leaks into the revenue', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(4), depositAmount: 200, balanceAmount: 300 });
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, depositAmount, balanceAmount) VALUES (99, 'devis', 1, 1, ?, ?, 5000, 4999)").run(iso(1), iso(4));
  const summary = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(summary.revenueTotal, 500);
  assert.ok(!summary.reservations.some((r) => r.id === 99));
});

// ── HT (element-by-element, server-side) ────────────────────────────────────────────────

test('getSummary: HT is element-by-element — finalPrice ÷ (1+vat), tourist tax excluded (no VAT)', () => {
  const { db, model } = freshModel();
  // A: 1100 € accommodation, no taxe de séjour → 1100 € TTC, 1000 € HT. Deposit paid.
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(3), finalPrice: 1100, touristTaxTotal: 0, depositAmount: 1100, depositPaid: 1 });
  // B: 1100 € accommodation + 100 € taxe de séjour → 1200 € TTC, STILL 1000 € HT (tax bears no VAT). Unpaid.
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(4), finalPrice: 1100, touristTaxTotal: 100, depositAmount: 1200 });
  const s = model.getSummary({ from: iso(0), to: iso(10) });
  assert.equal(s.revenueTotal, 2300);
  assert.equal(s.revenueTotalHt, 2000);   // 1000 + 1000 (tax stripped, rest ÷ 1.10)
  assert.equal(s.totalCollected, 1100);   // only A's deposit is paid
  assert.equal(s.totalCollectedHt, 1000); // its HT
});

// ── operational ───────────────────────────────────────────────────────────────────────

test('getOperational: overdue lists DIRECT bookings only (platforms manage their own payments)', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(10), endDate: iso(13), platform: 'direct', depositAmount: 150, depositDueDate: iso(-5), balanceAmount: 350, balanceDueDate: iso(20) });
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(8), endDate: iso(10), platform: 'Airbnb', depositAmount: 120, depositDueDate: iso(-20), balanceAmount: 280, balanceDueDate: iso(-2) });
  const op = model.getOperational();
  assert.deepEqual(op.overdue.reservations.map((r) => r.id), [1]); // the Airbnb one is excluded
});

test('getOperational: pending = PAST + non-settled, amount = total de séjour; caisse interne settles it', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-5), endDate: iso(-2), depositAmount: 100, balanceAmount: 200 }); // past unpaid
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(5), depositAmount: 100, balanceAmount: 200 });   // future → not pending
  insertRes(db, { id: 3, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-3), depositAmount: 100, depositPaid: 1, balanceAmount: 0, complementAmount: 40, complementPaid: 1, complementPaidCash: 1 }); // past but caisse-interne → settled
  const op = model.getOperational();
  assert.deepEqual(op.pending.reservations.map((r) => r.id), [1]);
  assert.equal(op.pending.reservations[0].totalSejour, 300);
});

test('getOperational: upcoming = endDate >= today, carries totalSejour + nights, caps at 5 per property', () => {
  const { db, model } = freshModel();
  for (let i = 1; i <= 7; i += 1) insertRes(db, { id: i, clientId: 1, propertyId: 1, startDate: iso(i), endDate: iso(i + 2), balanceAmount: 100 });
  const op = model.getOperational();
  assert.equal(op.upcoming.reservations.length, 5);
  assert.equal(op.upcoming.reservations[0].totalSejour, 100);
  assert.equal(op.upcoming.reservations[0].nights, 2);
});

test('getOperational: pending totals sum the columns; a disabled deposit is excluded from its total', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-2), finalPrice: 300, depositAmount: 100, balanceAmount: 200 }); // remainingDue 300, totalSejour 300
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(-5), endDate: iso(-1), finalPrice: 200, depositAmount: 50, depositDisabled: 1, balanceAmount: 150 }); // deposit disabled → not in deposit total
  const op = model.getOperational();
  assert.equal(op.pending.totals.depositAmount, 100); // 100 + (disabled 50 excluded)
  assert.equal(op.pending.totals.balanceAmount, 350);
  assert.equal(op.pending.totals.totalSejour, 500);
  assert.equal(op.pending.totals.remainingDue, 500);
});

// specs/finance-operational-remaining-to-pay.md §3 — « reste à payer » = Σ still-owed buckets only.
test('getOperational: remainingToPay sums only the UNPAID buckets, incl. both complements', () => {
  const { db, model } = freshModel();
  // Deposit + balance PAID, but an arrival complement (60) + end-of-stay (40) still owed → 100 left.
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-2), finalPrice: 300,
    depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 1,
    complementAmount: 60, complementPaid: 0, endOfStayComplementAmount: 40, endOfStayComplementPaid: 0,
  });
  const r = model.getOperational().pending.reservations.find((x) => x.id === 1);
  assert.equal(r.remainingToPay, 100, 'only the two unpaid complements remain');
  // The legacy deposit+balance-only field would wrongly say 0 here.
  assert.equal(r.remainingDue, 0);
});

test('getOperational: caisse-interne complement + disabled deposit are NOT counted in remainingToPay', () => {
  const { db, model } = freshModel();
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-2), finalPrice: 200,
    depositAmount: 50, depositDisabled: 1,                       // disabled → not owed
    balanceAmount: 150, balancePaid: 0,                          // owed
    complementAmount: 80, complementPaid: 1, complementPaidCash: 1, // caisse interne → settled
  });
  const r = model.getOperational().pending.reservations.find((x) => x.id === 1);
  assert.equal(r.remainingToPay, 150, 'only the unpaid balance; disabled deposit + cash complement excluded');
});

test('getOperational: remainingToPay is 0 exactly when the reservation is settled (drops from pending)', () => {
  const { db, model } = freshModel();
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-2),
    depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 1,
    complementAmount: 50, complementPaid: 1, endOfStayComplementAmount: 30, endOfStayComplementPaid: 1,
  });
  const op = model.getOperational();
  assert.equal(op.pending.reservations.length, 0, 'fully settled → not pending');
});

test('getOperational: pending totals expose remainingToPay + complement columns', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-6), endDate: iso(-2), depositAmount: 100, balanceAmount: 200, complementAmount: 60, endOfStayComplementAmount: 40 });
  const t = model.getOperational().pending.totals;
  assert.equal(t.complementAmount, 60);
  assert.equal(t.endOfStayComplementAmount, 40);
  assert.equal(t.remainingToPay, 400); // 100 + 200 + 60 + 40, nothing paid
});

test('getOperational: upcoming totals sum every component column + total de séjour', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(1), endDate: iso(3), depositAmount: 100, balanceAmount: 200, complementAmount: 30, endOfStayComplementAmount: 20 }); // totalSejour 350
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(2), endDate: iso(4), depositAmount: 50, balanceAmount: 150 }); // totalSejour 200
  const op = model.getOperational();
  assert.equal(op.upcoming.totals.depositAmount, 150);
  assert.equal(op.upcoming.totals.balanceAmount, 350);
  assert.equal(op.upcoming.totals.complementAmount, 30);
  assert.equal(op.upcoming.totals.endOfStayComplementAmount, 20);
  assert.equal(op.upcoming.totals.totalSejour, 550);
  // Nothing paid → reste à payer = Σ of all owed buckets = totalSejour (specs/finance-upcoming-payments-table.md §3 rule 6).
  assert.equal(op.upcoming.totals.remainingToPay, 550);
});

// ── projection ────────────────────────────────────────────────────────────────────────

test('getProjection: Σ total-de-séjour of reservations whose endDate ≤ target; collected = compta', () => {
  const { db, model } = freshModel();
  insertRes(db, { id: 1, clientId: 1, propertyId: 1, startDate: iso(-3), endDate: iso(-1), depositAmount: 100, depositPaid: 1, balanceAmount: 200, balancePaid: 0 }); // before target
  insertRes(db, { id: 2, clientId: 2, propertyId: 2, startDate: iso(20), endDate: iso(40), depositAmount: 500, balanceAmount: 500 }); // after target
  const proj = model.getProjection({ date: iso(10) });
  assert.equal(proj.total, 300);      // only res1's stay total (endDate ≤ target)
  assert.equal(proj.collected, 100);  // deposit paid
  assert.equal(proj.pending, 200);
});

test('getProjection: total + per-row total-de-séjour + collected are NET of the platform commission', () => {
  const { db, model } = freshModel();
  // Platform reservation: acompte 100 paid (− 10 = 90 collected), solde 300 unpaid (− 30). Net total 360.
  insertRes(db, {
    id: 1, clientId: 1, propertyId: 1, startDate: iso(-3), endDate: iso(-1), platform: 'airbnb',
    depositAmount: 100, depositPaid: 1, balanceAmount: 300, balancePaid: 0,
    platformCommissionAmount: 30, acompteCommissionAmount: 10,
  });
  const proj = model.getProjection({ date: iso(10) });
  assert.equal(proj.total, 360);                 // 400 − 40 commission
  assert.equal(proj.details[0].totalSejour, 360);
  assert.equal(proj.collected, 90);              // acompte 100 − 10
  assert.equal(proj.pending, 270);               // solde 300 − 30
});

// ── tourist-tax extraction (unchanged) ──────────────────────────────────────────────────

test('getTouristTaxExtraction rejects a future or malformed month (current-month acceptance: see tourist-tax-collection-coverage)', () => {
  const { model } = freshModel();
  // Malformed month → 400.
  assert.equal(model.getTouristTaxExtraction({ month: 'bad' }).status, 400);
  // A future month is still rejected (the guard short-circuits before any SQL).
  const now = new Date();
  const future = `${now.getFullYear() + 1}-01`;
  assert.equal(model.getTouristTaxExtraction({ month: future }).status, 400);
});
