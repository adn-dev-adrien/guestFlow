// specs/direct-installments.md rules 4, 5, 8, 22 and §4.1 — what a plan does to the money readers: the
// pricing engine (acompte and solde replaced, the rise on a settled plan goes to the arrival complement),
// the settlement figures, the ledger, the accounting export and the collection alert.
const test = require('node:test');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { calculateReservationQuote } = require('../utils/pricing');
const { remainingToPay, comptaCollected, isSettled, bucketStates } = require('../utils/reservationSettlement');
const { computePaymentStatus } = require('../utils/paymentStatus');
const { buildLedger } = require('../utils/reservationLedger');
const { buildPlanPayload } = require('../utils/installmentPlan');
const { buildPaymentDeadlineRows } = require('../utils/paymentDeadlines');
const financeModel = require('../models/financeModel');
const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));
const { migrateInstallmentsSchema } = require('../utils/installmentsMigration');

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// ── The pricing engine ──────────────────────────────────────────────────────────────────────────────
function engineDb() {
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
    CREATE TABLE options (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      priceType TEXT NOT NULL DEFAULT 'per_stay', price REAL NOT NULL DEFAULT 0,
      optionProgressiveTiers TEXT NOT NULL DEFAULT '[]', autoOptionType TEXT,
      autoEnabled INTEGER NOT NULL DEFAULT 0, autoPricingMode TEXT NOT NULL DEFAULT 'fixed', autoFullNightThreshold TEXT
    );
    CREATE TABLE property_options ( propertyId INTEGER NOT NULL, optionId INTEGER NOT NULL, PRIMARY KEY (propertyId, optionId) );
    CREATE TABLE resources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0, priceType TEXT NOT NULL DEFAULT 'per_stay',
      isComplex INTEGER NOT NULL DEFAULT 0, propertyIds TEXT DEFAULT '[]'
    );
    CREATE TABLE property_resource_prices ( propertyId INTEGER NOT NULL, resourceId INTEGER NOT NULL, price REAL, freeMinutes INTEGER DEFAULT 0, PRIMARY KEY (propertyId, resourceId) );
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE reservation_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, number INTEGER NOT NULL, dueDate TEXT NOT NULL,
      amountCents INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name, depositPercent, balanceDaysBefore) VALUES (1, 'Maison', 30, 7)").run();
  db.prepare('INSERT INTO pricing_rules (id, propertyId, pricePerNight, minNights) VALUES (1, 1, 100, 1)').run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (1, 'Ménage', 'per_stay', 50)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 1)').run();
  return db;
}

const STAY = {
  propertyId: 1, startDate: '2027-07-10', endDate: '2027-07-13', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 2, children: 0, teens: 0, selectedOptions: [], customOptions: [], selectedResources: [],
  depositPaid: false, balancePaid: false, discountPercent: 0, customPrice: '', bookingDate: '2026-10-01',
};

function planOn(db, bookingId, rows) {
  rows.forEach(([amountCents, paid], i) => db.prepare(
    'INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid) VALUES (?, ?, ?, ?, ?)',
  ).run(bookingId, i + 1, `2026-1${i}-27`, amountCents, paid ? 1 : 0));
}

test('rules 4, 5, 26 — without a plan the usual split stands; with one, acompte and solde are 0 and the pre-arrival amount is handed over', () => {
  const db = engineDb();
  const plain = calculateReservationQuote({ ...STAY, db, bookingId: 42 });
  assert.deepEqual([plain.depositAmount, plain.balanceAmount], [90, 210]);

  planOn(db, 42, [[10000, true], [10000, false], [10000, false]]);
  const planned = calculateReservationQuote({ ...STAY, db, bookingId: 42 });
  assert.deepEqual([planned.depositAmount, planned.balanceAmount], [0, 0]);
  assert.equal(planned.preArrivalAmount, 300, 'what the plan covers');
  assert.equal(planned.depositDueDate, null);
  assert.equal(planned.balanceDueDate, null, 'no acompte / solde deadline: no reminder, no cancellation clock');
  assert.equal(planned.complementAmount, 0, 'plan not settled: nothing rises to the complement');

  const other = calculateReservationQuote({ ...STAY, db, bookingId: 43 });
  assert.deepEqual([other.depositAmount, other.balanceAmount], [90, 210], 'another booking keeps its split');
});

test('rules 1, 26 — a stay that left the own channels ignores the plan, whatever the table still holds', () => {
  const db = engineDb();
  planOn(db, 42, [[15000, false], [15000, false]]);
  const onPlatform = calculateReservationQuote({ ...STAY, db, bookingId: 42, platform: 'Booking' });
  assert.notEqual(onPlatform.balanceAmount, 0);
});

test('rule 8 — a rise while the plan is not settled stays out of the arrival complement', () => {
  const db = engineDb();
  planOn(db, 42, [[10000, true], [10000, false], [10000, false]]);
  const quote = calculateReservationQuote({ ...STAY, db, bookingId: 42, selectedOptions: [{ optionId: 1, quantity: 1 }] });
  assert.equal(quote.preArrivalAmount, 350);
  assert.equal(quote.complementAmount, 0, 'the plan will absorb it (rebalanced after the save)');
});

test('rule 8 — a rise once every installment is paid goes to the arrival complement, as with acompte and solde', () => {
  const db = engineDb();
  planOn(db, 42, [[15000, true], [15000, true]]);
  const quote = calculateReservationQuote({ ...STAY, db, bookingId: 42, selectedOptions: [{ optionId: 1, quantity: 1 }] });
  assert.equal(quote.complementAmount, 50);
  assert.equal(quote.overCollectedTtc, 0);
});

test('rule 8 — a price drop below what was collected shows as trop-perçu, like a paid solde', () => {
  const db = engineDb();
  planOn(db, 42, [[15000, true], [15000, true]]);
  const quote = calculateReservationQuote({ ...STAY, db, bookingId: 42, endDate: '2027-07-12' });
  assert.equal(quote.finalPrice, 200);
  assert.equal(quote.overCollectedTtc, 100);
});

// ── Settlement ──────────────────────────────────────────────────────────────────────────────────────
const stay = (extra = {}) => ({
  finalPrice: 1000, depositAmount: 0, balanceAmount: 0, installmentsPaidAmount: 0, installmentsUnpaidAmount: 1000, ...extra,
});

test('rule 5 — remaining to pay and collected count the installments, the plan is a bucket of its own', () => {
  const none = stay();
  assert.equal(remainingToPay(none), 1000);
  assert.equal(comptaCollected(none), 0);
  const half = stay({ installmentsPaidAmount: 334, installmentsUnpaidAmount: 666 });
  assert.equal(remainingToPay(half), 666);
  assert.equal(comptaCollected(half), 334);
  assert.equal(round2(remainingToPay(half) + comptaCollected(half)), 1000, 'the invariant of the finance readers holds');
  assert.equal(isSettled(half), false);
  const done = stay({ installmentsPaidAmount: 1000, installmentsUnpaidAmount: 0 });
  assert.equal(isSettled(done), true);
  assert.equal(remainingToPay(done), 0);
  assert.deepEqual(bucketStates(done).installments, { amount: 1000, applicable: true, settled: true });
  assert.equal(bucketStates({ finalPrice: 500, depositAmount: 150 }).installments.applicable, false, 'no plan: not applicable, nothing changes');
});

test('rule 5 — the shared payment status takes the collected installments off what is due', () => {
  const status = computePaymentStatus(stay({ installmentsPaidAmount: 334, installmentsUnpaidAmount: 666 }), '2026-11-01');
  assert.equal(status.remainingDue, 666);
  assert.equal(status.paymentComplete, false);
  assert.equal(computePaymentStatus(stay({ installmentsPaidAmount: 1000, installmentsUnpaidAmount: 0 })).paymentComplete, true);
});

// ── Ledger ──────────────────────────────────────────────────────────────────────────────────────────
function payloadOf(overrides = {}) {
  const rows = [
    { id: 1, number: 1, dueDate: '2026-10-27', amountCents: 33400, paid: 1, paidDate: '2026-10-27', paidMethod: 'link', amountEdited: 0 },
    { id: 2, number: 2, dueDate: '2027-02-04', amountCents: 33400, paid: 0, amountEdited: 0 },
    { id: 3, number: 3, dueDate: '2027-05-15', amountCents: 33350, paid: 0, amountEdited: 0 },
  ];
  return buildPlanPayload({
    eligibility: { eligible: true, canCreate: false },
    rows, targetCents: 100150, today: '2026-11-02', startDate: '2027-06-14', balanceDaysBefore: 30, ...overrides,
  });
}

test('rule 5 — the ledger shows one row per installment instead of the acompte and solde rows', () => {
  const row = { id: 9, kind: 'reservation', platform: 'direct', startDate: '2027-06-14', finalPrice: 1001.5, ...stay({ installmentsPaidAmount: 334, installmentsUnpaidAmount: 667.5 }) };
  const ledger = buildLedger({ row, installmentPlan: payloadOf(), today: '2026-11-02' });
  const keys = ledger.rows.map((r) => r.key);
  assert.deepEqual(keys.slice(0, 3), ['installment-1', 'installment-2', 'installment-3']);
  assert.ok(!keys.includes('deposit') && !keys.includes('balance'));
  assert.deepEqual(ledger.rows.slice(0, 3).map((r) => r.label), ['Échéance 1/3', 'Échéance 2/3', 'Échéance 3/3']);
  assert.deepEqual(ledger.rows.slice(0, 3).map((r) => r.amount), [334, 334, 333.5]);
  assert.equal(ledger.rows[0].state, 'paid');
  assert.equal(ledger.rows[0].paidDate, '2026-10-27');
  assert.match(ledger.rows[0].stateLabel, /Payée le 27\/10 · lien/);
  assert.match(ledger.rows[1].stateLabel, /^À percevoir avant le 04\/02$/);
  assert.equal(ledger.remaining, 667.5, 'reservationSettlement.remainingToPay, no arithmetic of its own');
  assert.equal(ledger.settled, false);
});

test('rule 14 — a late installment reads « En retard depuis le … » in the ledger', () => {
  const row = { id: 9, kind: 'reservation', platform: 'direct', startDate: '2027-06-14', finalPrice: 1001.5, ...stay({ installmentsPaidAmount: 334, installmentsUnpaidAmount: 667.5 }) };
  const ledger = buildLedger({ row, installmentPlan: payloadOf({ today: '2027-02-10' }), today: '2027-02-10' });
  assert.equal(ledger.rows[1].state, 'late');
  assert.equal(ledger.rows[1].stateLabel, 'En retard depuis le 04/02');
});

test('rule 8 — a plan above the stay adds the warning row « Échéancier au-dessus du séjour »', () => {
  const row = { id: 9, kind: 'reservation', platform: 'direct', startDate: '2027-06-14', finalPrice: 976.5, ...stay({ installmentsPaidAmount: 334, installmentsUnpaidAmount: 667.5 }) };
  const ledger = buildLedger({ row, installmentPlan: payloadOf({ targetCents: 97650 }), today: '2026-11-02' });
  const gap = ledger.rows.find((r) => r.key === 'installmentGap');
  assert.deepEqual([gap.label, gap.amount, gap.tone], ['Échéancier au-dessus du séjour', 25, 'warning']);
});

test('rule 13 — an installment brought back to the arrival day is flagged', () => {
  const row = { id: 9, kind: 'reservation', platform: 'direct', startDate: '2027-03-01', finalPrice: 1001.5, ...stay({ installmentsUnpaidAmount: 1001.5 }) };
  const rows = [
    { id: 1, number: 1, dueDate: '2026-10-27', amountCents: 50000, paid: 0, amountEdited: 0 },
    { id: 2, number: 2, dueDate: '2027-03-01', amountCents: 50150, paid: 0, amountEdited: 0 },
  ];
  const ledger = buildLedger({ row, installmentPlan: payloadOf({ rows, startDate: '2027-03-01' }), today: '2026-11-02' });
  assert.deepEqual(ledger.rows[1].detail.warnings, [{ tone: 'warning', label: 'Date ramenée à l\'arrivée' }]);
});

test('without a plan the ledger keeps its acompte and solde rows', () => {
  const row = { id: 9, kind: 'reservation', platform: 'direct', startDate: '2027-06-14', finalPrice: 500, depositAmount: 150, balanceAmount: 350 };
  const ledger = buildLedger({ row, installmentPlan: { eligible: true, installments: [] }, today: '2026-11-02' });
  assert.deepEqual(ledger.rows.slice(0, 2).map((r) => r.key), ['deposit', 'balance']);
});

// ── Finance and accounting ──────────────────────────────────────────────────────────────────────────
function booksDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
    CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL NOT NULL DEFAULT 10);
    CREATE TABLE reservations (
      requestOrigin TEXT, attributionChannel TEXT, devisStatus TEXT, createdAt TEXT,
      id INTEGER PRIMARY KEY, propertyId INTEGER, clientId INTEGER, kind TEXT DEFAULT 'reservation',
      startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
      checkInTime TEXT DEFAULT '15:00', checkOutTime TEXT DEFAULT '10:00',
      adults INTEGER DEFAULT 2, children INTEGER DEFAULT 0, teens INTEGER DEFAULT 0, babies INTEGER DEFAULT 0,
      discountPercent REAL DEFAULT 0, customPrice REAL,
      depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT,
      balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT,
      complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidDate TEXT,
      complementPaidCash INTEGER DEFAULT 0, depositDueDate TEXT, balanceDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
      depositPaidCash INTEGER NOT NULL DEFAULT 0, balancePaidCash INTEGER NOT NULL DEFAULT 0, arrivalPaymentGroup TEXT,
      endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0,
      endOfStayComplementPaidDate TEXT, endOfStayComplementPaidCash INTEGER DEFAULT 0,
      endOfStayComplementDetail TEXT, arrivalExtrasBaseline TEXT, midStaySettledNotes TEXT,
      finalPrice REAL DEFAULT 0, clientGrossAmount REAL, platformCommissionAmount REAL, acompteCommissionAmount REAL,
      totalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0, touristTaxRate REAL DEFAULT 0,
      touristTaxInComplement INTEGER DEFAULT 0, extraGuestSurchargeOffered INTEGER DEFAULT 0,
      accommodationAcompteContribTtc REAL, accommodationSoldeContribTtc REAL,
      touristTaxAcompteContribTtc REAL, touristTaxSoldeContribTtc REAL, arrivalPaymentReduction REAL, arrivalPaymentTip REAL
    );
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, billedUnits REAL, unitPrice REAL, priceType TEXT, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, optionId));
    CREATE TABLE reservation_custom_options (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, description TEXT, amount REAL, offered INTEGER DEFAULT 0, sortOrder INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL);
    CREATE TABLE reservation_resources (reservationId INTEGER, resourceId INTEGER, quantity REAL, billedUnits REAL, unitPrice REAL, priceType TEXT, totalPrice REAL DEFAULT 0, offered INTEGER DEFAULT 0, inComplement INTEGER DEFAULT 0, acompteContribTtc REAL, soldeContribTtc REAL, PRIMARY KEY (reservationId, resourceId));
    CREATE TABLE ical_sources (id INTEGER PRIMARY KEY, propertyId INTEGER, platformKey TEXT, collectsTouristTax INTEGER DEFAULT 1);
  `);
  migrateInstallmentsSchemaOnBooks(db);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  return db;
}

// The minimal books schema above has no payment_links / email tables: only the plan's own table and columns.
function migrateInstallmentsSchemaOnBooks(db) {
  migrateInstallmentsSchema(db);
  db.exec(`CREATE TABLE reservation_installments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, number INTEGER NOT NULL, dueDate TEXT NOT NULL,
    amountCents INTEGER NOT NULL, paid INTEGER NOT NULL DEFAULT 0, paidDate TEXT, paidMethod TEXT, requestedAt TEXT,
    dateEdited INTEGER NOT NULL DEFAULT 0, amountEdited INTEGER NOT NULL DEFAULT 0
  )`);
}

function plannedStay(db, { tax = 0 } = {}) {
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, finalPrice, totalPrice, touristTaxTotal,
      installmentsPaidAmount, installmentsUnpaidAmount, installmentsTarget)
    VALUES (1, 1, 1, '2027-06-14', '2027-06-17', 600, 600, ?, 200, 400, 600 + ?)`).run(tax, tax);
  const add = db.prepare('INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid, paidDate, paidMethod) VALUES (1, ?, ?, ?, ?, ?, ?)');
  add.run(1, '2027-01-10', 20000, 1, '2027-01-10', 'transfer');
  add.run(2, '2027-03-10', 20000, 1, '2027-03-12', 'link');
  add.run(3, '2027-05-10', 20000, 0, null, null);
  return db;
}
// installmentsPaidAmount above is kept in step with the rows by the model: here, two paid out of three.

test('rule 5 — the finance readers see the installments collected as money received', () => {
  const db = plannedStay(booksDb());
  db.prepare('UPDATE reservations SET installmentsPaidAmount = 400, installmentsUnpaidAmount = 200 WHERE id = 1').run();
  const summary = financeModel.buildModel(db).getSummary({ from: '2027-01-01', to: '2027-12-31' });
  assert.equal(summary.totalCollected, 400);
});

test('rule 29 — accounting: each paid installment is an encaissement of its own, at its paid date, booked like a solde', { skip: skipWithout(['accounting-export']) }, () => {
  const db = plannedStay(booksDb());
  const accounting = createAccountingModel(db);
  const january = accounting.encaissementsByMonth({ month: 1, year: 2027 });
  const march = accounting.encaissementsByMonth({ month: 3, year: 2027 });
  const may = accounting.encaissementsByMonth({ month: 5, year: 2027 });
  assert.deepEqual([january.length, march.length, may.length], [1, 1, 0], 'the unpaid one books nothing');
  const [entry] = january;
  assert.equal(entry.kind, 'installment');
  assert.deepEqual(entry.installment, { number: 1, count: 3 });
  assert.equal(entry.paidDate, '2027-01-10');
  assert.equal(entry.encaissementTtc, 200);
  assert.equal(entry.taxTtc, 0);
  const structured = entryToStructured(entry);
  const debit = structured.lines.filter((l) => Number(l.debit) > 0).reduce((s, l) => s + Number(l.debit), 0);
  const credit = structured.lines.filter((l) => Number(l.credit) > 0).reduce((s, l) => s + Number(l.credit), 0);
  assert.equal(round2(debit), 200);
  assert.equal(round2(credit), 200, 'the entry balances');
});

test('accounting — the tourist tax rides every installment in proportion; the last one takes what is left, so the books add up to the tax', { skip: skipWithout(['accounting-export']) }, () => {
  const db = plannedStay(booksDb(), { tax: 31 });
  db.prepare('UPDATE reservation_installments SET amountCents = 21000, paid = 1, paidDate = ? WHERE reservationId = 1').run('2027-01-10');
  db.prepare('UPDATE reservation_installments SET paidDate = ? WHERE reservationId = 1 AND number = 2').run('2027-03-10');
  db.prepare('UPDATE reservation_installments SET paidDate = ? WHERE reservationId = 1 AND number = 3').run('2027-05-10');
  db.prepare('UPDATE reservations SET installmentsTarget = 631, installmentsPaidAmount = 630, installmentsUnpaidAmount = 0 WHERE id = 1').run();
  const accounting = createAccountingModel(db);
  const entries = [1, 3, 5].flatMap((month) => accounting.encaissementsByMonth({ month, year: 2027 }));
  assert.deepEqual(entries.map((e) => e.encaissementTtc), [210, 210, 210]);
  assert.deepEqual(entries.map((e) => e.taxTtc), [10.33, 10.33, 10.34], 'the share of the last installment closes the tax');
  assert.equal(round2(entries.reduce((sum, e) => sum + e.taxTtc, 0)), 31);
});

// ── The collection alert ────────────────────────────────────────────────────────────────────────────
test('rule 22 — an installment unpaid three days after its due date joins the payment-deadline card, one row per stay', () => {
  const late = [
    { id: 2, reservationId: 9, number: 2, dueDate: '2027-02-04', amountCents: 33400, reservationNumber: '2026-10-001', startDate: '2027-06-14', endDate: '2027-06-21', firstName: 'Camille', lastName: 'Martin', email: 'c@example.com', propertyName: 'La Granja' },
    { id: 3, reservationId: 9, number: 3, dueDate: '2027-02-10', amountCents: 33350, reservationNumber: '2026-10-001', startDate: '2027-06-14', endDate: '2027-06-21', firstName: 'Camille', lastName: 'Martin', email: 'c@example.com', propertyName: 'La Granja' },
  ];
  const rows = buildPaymentDeadlineRows([], '2027-02-12', late);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    [rows[0].state, rows[0].severity, rows[0].totalDue, rows[0].installmentsDue, rows[0].dueDate, rows[0].daysLate, rows[0].canRemind, rows[0].canCancel],
    ['installment_overdue', 'warning', 667.5, 2, '2027-02-04', 8, false, false],
  );
});

test('rule 22 — a snoozed card, or a stay over for more than a month, hides the installment row', () => {
  const base = { id: 2, reservationId: 9, number: 2, dueDate: '2027-02-04', amountCents: 33400, startDate: '2027-06-14', endDate: '2027-06-21', firstName: 'C', lastName: 'M', propertyName: 'P' };
  assert.equal(buildPaymentDeadlineRows([], '2027-02-12', [{ ...base, paymentAlertSnoozedUntil: '2027-02-20' }]).length, 0);
  assert.equal(buildPaymentDeadlineRows([], '2027-08-12', [base]).length, 0);
});
