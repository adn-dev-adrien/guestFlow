// specs/pricing-components.md §3 rules 16 and 39 — the fixed amount of a stay discount is persisted beside its target
// (`reservations.discountAmountCents`, nullable): written by a save, journaled, read back by the stored-stay replay.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { discountAmountCentsOf, fixedDiscountEuros } = require('../utils/pricing/discounts');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { buildAuditSnapshotFromPayload, computeAuditChanges } = require('../utils/reservationAudit');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

db.prepare("INSERT INTO properties (id, name) VALUES (9401, 'Montant')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9401, 'Camille', 'Montant')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9401, 'Standard', 100)").run();
const START = addDaysToIsoDate(todayIso(), 120);

test('rule 16 — the column exists, nullable, and an old row reads NULL', () => {
  const column = db.prepare('PRAGMA table_info(reservations)').all().find((c) => c.name === 'discountAmountCents');
  assert.ok(column);
  assert.equal(column.notnull, 0);
  const id = Number(db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind) VALUES (9401, 9401, ?, ?, 'direct', 2, 200, 200, 'reservation')")
    .run(START, addDaysToIsoDate(START, 2)).lastInsertRowid);
  assert.equal(db.prepare('SELECT discountAmountCents FROM reservations WHERE id = ?').get(id).discountAmountCents, null);
});

test('rule 16 — only a positive amount is an amount; the engine reads euros', () => {
  assert.deepEqual([undefined, null, '', 0, -5, 'x'].map(discountAmountCentsOf), [null, null, null, null, null, null]);
  assert.equal(discountAmountCentsOf(1250.4), 1250);
  assert.equal(fixedDiscountEuros(1250), 12.5);
  assert.equal(fixedDiscountEuros(null), null);
});

test('rules 16, 39 — a stored fixed amount lowers the stored stay\'s quote, and its change is journaled', () => {
  const id = Number(db.prepare("INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, discountAmountCents) VALUES (9401, 9401, ?, ?, 'direct', 2, 200, 200, 'reservation', 2500)")
    .run(START, addDaysToIsoDate(START, 2)).lastInsertRowid);
  const quote = quoteStoredReservation(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(id));
  assert.equal(quote.finalPrice, 175);
  const before = buildAuditSnapshotFromPayload({ discountAmountCents: 2500 }, quote);
  const after = buildAuditSnapshotFromPayload({ discountAmountCents: 4000 }, quote);
  const change = computeAuditChanges(before, after).find((c) => c.field === 'discountAmountCents');
  assert.ok(change);
  assert.deepEqual([change.from, change.to], [2500, 4000]);
});
