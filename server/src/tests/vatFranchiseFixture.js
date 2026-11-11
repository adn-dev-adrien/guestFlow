// Shared fixture of the franchise-threshold suites (specs/vat-optional-mode.md rules 35-44): the finance
// dashboard's in-memory schema completed with what the follow-up reads — VAT periods, installments,
// compensations and the threshold columns. Not a test file.

const financeFixture = require('./financeDashboardFixture');
const vatFranchiseModel = require('../models/vatFranchiseModel');

const TODAY = '2026-10-28';

const EXTRA_DDL = `
  ALTER TABLE app_settings ADD COLUMN vatFranchiseThreshold REAL;
  ALTER TABLE app_settings ADD COLUMN vatFranchiseThresholdSetAt TEXT;
  ALTER TABLE reservations ADD COLUMN vatPeriodId INTEGER;
  ALTER TABLE reservations ADD COLUMN installmentsPaidAmount REAL DEFAULT 0;
  ALTER TABLE reservations ADD COLUMN installmentsUnpaidAmount REAL DEFAULT 0;
  ALTER TABLE reservations ADD COLUMN platformPenaltyAmount REAL DEFAULT 0;
  CREATE TABLE vat_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT, regime TEXT NOT NULL, rate REAL NOT NULL DEFAULT 0, legalMention TEXT,
    basis TEXT NOT NULL, effectiveFrom TEXT, createdAt TEXT DEFAULT (datetime('now')), createdBy INTEGER, note TEXT
  );
  CREATE TABLE reservation_installments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, number INTEGER, dueDate TEXT, amountCents INTEGER,
    paid INTEGER DEFAULT 0, paidDate TEXT
  );
  CREATE TABLE cancellation_compensations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER, receivedAmount REAL, receivedDate TEXT, status TEXT,
    expectedAmount REAL, expectedDate TEXT, origin TEXT
  );
`;

/** A database whose regime in force is the given one (default: franchise en base, art. 293 B). */
function franchiseDb({ regime = 'not_subject', mention = 'art_293_b', threshold = null } = {}) {
  const fixture = financeFixture.freshDb();
  fixture.db.exec(EXTRA_DDL);
  fixture.db.prepare('INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES (?, ?, ?, ?)')
    .run(regime, regime === 'subject' ? 10 : 0, regime === 'subject' ? null : mention, 'all');
  if (threshold != null) fixture.db.prepare('UPDATE app_settings SET vatFranchiseThreshold = ?, vatFranchiseThresholdSetAt = ? WHERE id = 1').run(threshold, '2026-03-12');
  return { ...fixture, model: vatFranchiseModel.buildModel(fixture.db) };
}

const addPeriod = (db, regime, rate, mention = null) => Number(db
  .prepare('INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES (?, ?, ?, ?)').run(regime, rate, mention, 'all').lastInsertRowid);

const addRefund = (db, reservationId, refundDate, totalTtc, method = 'transfer') => db
  .prepare('INSERT INTO reservation_refunds (reservationId, refundDate, method, totalTtc) VALUES (?, ?, ?, ?)')
  .run(reservationId, refundDate, method, totalTtc);

module.exports = { ...financeFixture, TODAY, franchiseDb, addPeriod, addRefund };
