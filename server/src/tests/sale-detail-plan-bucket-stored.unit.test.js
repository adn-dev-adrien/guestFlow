// specs/pricing/pricing-components.md §3 rule 93 as completed by rule 103 (stabilisation loop t3, T3-5, 2026-11-16) — `saleDetail.buckets.plan` is the stored
// deposit + balance, like the arrival and departure buckets (rule 102 g): a stay whose engine of today prices its plan otherwise reads as stored.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');

test('T3-5 — the plan bucket is the stored deposit + balance, never a live re-quote', () => {
  const id = stay(20);
  db.prepare('UPDATE reservations SET depositAmount = 90.5, balanceAmount = 120.25 WHERE id = ?').run(id);
  const now = new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`);
  assert.equal(extraSale.saleDetailOf(id, now).buckets.plan, 21075);
});
