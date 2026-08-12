const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

// specs/fiscal-year-and-nights-sold.md §3.2 — a stay is attached to an accounting window by the date
// its SOLDE was collected, falling back to its departure date. The rule exists twice (a JS helper for
// row-level code, a SQL expression so the windows stay a `WHERE`); this file pins BOTH, and pins them
// against each other.
const { attributionDate } = require('../utils/reservationSettlement');
const financeModel = require('../models/financeModel');

// ── the JS authority ─────────────────────────────────────────────────────────────────────

test('solde collected → the solde payment date carries the stay', () => {
  assert.equal(
    attributionDate({ balancePaid: 1, balancePaidDate: '2026-09-28', endDate: '2026-10-03' }),
    '2026-09-28',
  );
});

test('solde unpaid → the departure date carries the stay', () => {
  assert.equal(
    attributionDate({ balancePaid: 0, balancePaidDate: null, endDate: '2026-10-03' }),
    '2026-10-03',
  );
});

test('solde flagged paid but dateless (legacy rows) → departure date', () => {
  for (const paidDate of [null, undefined, '', '   ']) {
    assert.equal(attributionDate({ balancePaid: 1, balancePaidDate: paidDate, endDate: '2026-10-03' }), '2026-10-03');
  }
});

test('a datetime payment date is normalised to a plain day', () => {
  assert.equal(
    attributionDate({ balancePaid: 1, balancePaidDate: '2026-09-28 14:32:00', endDate: '2026-10-03' }),
    '2026-09-28',
  );
});

test('a stay with NO solde at all falls back to the departure date', () => {
  // specs/fiscal-year-and-nights-sold.md §3 « Edge cases » — fully prepaid on the acompte, or a
  // platform net-payout: nothing was ever collected ON THE SOLDE, so the departure carries it.
  // Attributing it to the acompte could push an August stay into the previous exercise.
  assert.equal(
    attributionDate({ balanceAmount: 0, balancePaid: 0, depositPaid: 1, depositPaidDate: '2025-05-02', endDate: '2026-08-20' }),
    '2026-08-20',
  );
});

// ── the SQL twin must agree with it, row for row ─────────────────────────────────────────

const DDL = `
  CREATE TABLE app_settings (id INTEGER PRIMARY KEY, vatRate REAL DEFAULT 10, fiscalYearEndMonth INTEGER DEFAULT 12);
  CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'reservation', clientId INTEGER, propertyId INTEGER,
    startDate TEXT, endDate TEXT, platform TEXT DEFAULT 'direct',
    finalPrice REAL DEFAULT 0, touristTaxTotal REAL DEFAULT 0,
    depositAmount REAL DEFAULT 0, depositPaid INTEGER DEFAULT 0, depositPaidDate TEXT, depositDueDate TEXT, depositDisabled INTEGER DEFAULT 0,
    balanceAmount REAL DEFAULT 0, balancePaid INTEGER DEFAULT 0, balancePaidDate TEXT, balanceDueDate TEXT,
    complementAmount REAL DEFAULT 0, complementPaid INTEGER DEFAULT 0, complementPaidCash INTEGER DEFAULT 0,
    endOfStayComplementAmount REAL DEFAULT 0, endOfStayComplementPaid INTEGER DEFAULT 0, endOfStayComplementPaidCash INTEGER DEFAULT 0,
    midStaySettledNotes TEXT,
    platformCommissionAmount REAL, acompteCommissionAmount REAL
  );
`;

// One row per interesting case of the rule above.
const ROWS = [
  { id: 1, startDate: '2026-09-25', endDate: '2026-10-03', balanceAmount: 500, balancePaid: 1, balancePaidDate: '2026-09-28' },
  { id: 2, startDate: '2026-09-25', endDate: '2026-10-03', balanceAmount: 500, balancePaid: 0, balancePaidDate: null },
  { id: 3, startDate: '2026-09-25', endDate: '2026-10-03', balanceAmount: 500, balancePaid: 1, balancePaidDate: '' },
  { id: 4, startDate: '2026-09-25', endDate: '2026-10-03', balanceAmount: 500, balancePaid: 1, balancePaidDate: '2026-09-28 14:32:00' },
  { id: 5, startDate: '2026-08-14', endDate: '2026-08-20', balanceAmount: 0, balancePaid: 0, balancePaidDate: null },
];

test('SQL and JS agree on every attribution case', () => {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id, vatRate, fiscalYearEndMonth) VALUES (1, 10, 9)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  for (const r of ROWS) {
    db.prepare(`INSERT INTO reservations
      (id, clientId, propertyId, startDate, endDate, balanceAmount, balancePaid, balancePaidDate)
      VALUES (@id, 1, 1, @startDate, @endDate, @balanceAmount, @balancePaid, @balancePaidDate)`).run(r);
  }

  // The model exposes its window key as `attributionDate` on every summary row; a period wide enough
  // to hold them all lets us read the SQL verdict back.
  const model = financeModel.buildModel(db);
  const summary = model.getSummary({ from: '2000-01-01', to: '2099-12-31' });
  const bySql = new Map(summary.reservations.map((r) => [r.id, r.attributionDate]));

  assert.equal(bySql.size, ROWS.length);
  for (const r of ROWS) {
    assert.equal(bySql.get(r.id), attributionDate(r), `row ${r.id}: SQL and JS must agree`);
  }
  // …and spelled out, so a future refactor can't silently move both in the same wrong direction.
  assert.equal(bySql.get(1), '2026-09-28');
  assert.equal(bySql.get(2), '2026-10-03');
  assert.equal(bySql.get(3), '2026-10-03');
  assert.equal(bySql.get(4), '2026-09-28');
  assert.equal(bySql.get(5), '2026-08-20');
});
