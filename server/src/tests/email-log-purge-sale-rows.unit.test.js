// specs/outside-booking-sas.md rule 42 and specs/pricing-components.md rule 86 (end review R1-4) — a sale's e-mail is logged like every other:
// the rolling purge keeps it for the retention window after the later of its sale day and its send, and never takes it for an orphan of a stay.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { buildModel } = require('../models/emailLogModel');
const { STAY_RETENTION_DAYS } = buildModel;
const sales = require('../models/standaloneSalesModel');

const model = buildModel(db);
const sale = (soldAt) => sales.insertSale({ soldAt, status: 'due', totalCents: 650 });
const log = (saleId, sentAt) => {
  const info = db.prepare("INSERT INTO email_log (templateId, reservationId, saleRef, sentAt, status, renderedSubject, renderedBody) VALUES (NULL, NULL, ?, ?, 'failed', 'S', 'B')")
    .run(`standalone:${saleId}`, sentAt);
  return Number(info.lastInsertRowid);
};
const left = () => db.prepare('SELECT saleRef FROM email_log WHERE saleRef IS NOT NULL ORDER BY id').all().map((r) => r.saleRef);

test('rule 42 — a sale\'s e-mail sent today survives the purge; one past the window after its sale and send is purged', () => {
  const recent = sale('2027-03-10T09:00:00.000Z'); // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  const old = sale('2027-02-01T09:00:00.000Z'); // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  log(recent, '2027-03-10 09:05:00'); // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  log(old, '2027-02-01 09:05:00'); // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  model.purgeRealizedStays('2027-03-10'); // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  assert.deepEqual(left(), [`standalone:${recent}`], `kept ${STAY_RETENTION_DAYS} days, the old one gone`);
  model.purgeRealizedStays(`2027-03-${10 + STAY_RETENTION_DAYS}`);
  assert.deepEqual(left(), [`standalone:${recent}`], 'still inside the window on its last day');
  model.purgeRealizedStays(`2027-03-${11 + STAY_RETENTION_DAYS}`);
  assert.deepEqual(left(), []);
});
