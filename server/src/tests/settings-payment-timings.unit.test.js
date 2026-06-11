// settingsModel.paymentTimings() — parses the JSON offset arrays + applies defaults so no caller
// hard-codes a payment delay. See specs/online-payments-qonto.md §3.1.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');

// Minimal app_settings with the payment-timing columns (SQL defaults mirror database.js).
const DDL = `
  CREATE TABLE app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    companyLogoPath TEXT DEFAULT '',
    paymentDepositReminderOffsets  TEXT DEFAULT '[-5,0]',
    paymentDepositAbandonOffset    INTEGER NOT NULL DEFAULT 1,
    paymentDepositLinkExpiryDays   INTEGER NOT NULL DEFAULT 1,
    paymentBalanceReminderOffsets  TEXT DEFAULT '[-10,-5,0]',
    paymentBalanceAbandonOffset    INTEGER NOT NULL DEFAULT 1,
    paymentBalanceLinkExpiryDays   INTEGER NOT NULL DEFAULT 1,
    paymentLastMinuteDays          INTEGER NOT NULL DEFAULT 30,
    paymentFullPaymentDueDaysBefore INTEGER NOT NULL DEFAULT 7,
    createdAt TEXT, updatedAt TEXT
  );
`;

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  return { db, model: settingsModel.create(db) };
}

test('defaults: the documented values when nothing is customised', () => {
  const { model } = fresh();
  assert.deepEqual(model.paymentTimings(), {
    depositReminderOffsets: [-5, 0],
    depositAbandonOffset: 1,
    depositLinkExpiryDays: 1,
    balanceReminderOffsets: [-10, -5, 0],
    balanceAbandonOffset: 1,
    balanceLinkExpiryDays: 1,
    lastMinuteDays: 30,
    fullPaymentDueDaysBefore: 7,
  });
});

test('custom values are read back through upsert', () => {
  const { model } = fresh();
  model.upsert({
    paymentDepositReminderOffsets: '[-7,-2,0]',
    paymentBalanceReminderOffsets: '[-14,-7,0]',
    paymentLastMinuteDays: 21,
    paymentFullPaymentDueDaysBefore: 3,
    paymentDepositAbandonOffset: 2,
  });
  const t = model.paymentTimings();
  assert.deepEqual(t.depositReminderOffsets, [-7, -2, 0]);
  assert.deepEqual(t.balanceReminderOffsets, [-14, -7, 0]);
  assert.equal(t.lastMinuteDays, 21);
  assert.equal(t.fullPaymentDueDaysBefore, 3);
  assert.equal(t.depositAbandonOffset, 2);
});

test('malformed offsets JSON falls back to the default (never throws)', () => {
  const { db, model } = fresh();
  db.prepare("UPDATE app_settings SET paymentDepositReminderOffsets = 'not json', paymentBalanceReminderOffsets = '{}' WHERE id = 1").run();
  const t = model.paymentTimings();
  assert.deepEqual(t.depositReminderOffsets, [-5, 0]);
  assert.deepEqual(t.balanceReminderOffsets, [-10, -5, 0]);
});

test('empty offsets array falls back to the default', () => {
  const { db, model } = fresh();
  db.prepare("UPDATE app_settings SET paymentDepositReminderOffsets = '[]' WHERE id = 1").run();
  assert.deepEqual(model.paymentTimings().depositReminderOffsets, [-5, 0]);
});
