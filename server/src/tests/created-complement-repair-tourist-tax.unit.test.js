// specs/force-item-to-complement.md rules 18-19 (adversarial review of the 2026-10-27 spec-review
// fixes) — the boot repair proves the lost complement on a property WITH a tourist tax (finalPrice
// excludes it), for both tax routings; it never reopens a stay that has ended; and a devis converted
// to a reservation carries its arrival complement instead of opening a new hole.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const { runCreatedComplementRepair } = require('../utils/createdComplementRepair');
const devisModel = require('../models/devisModel');

const ROUTED = [{ optionId: 50, quantity: 1, inComplement: 1 }];

function withTax() {
  f.seed();
  f.db.prepare("UPDATE properties SET touristTaxMode = 'per_day_per_person', touristTaxPerDayPerPerson = 1.5 WHERE id = 1").run();
}

test('the repair proves the gap with a tourist tax on the solde and on the complement', () => {
  withTax();
  const onSolde = f.createStay({ startDate: f.inDays(220), endDate: f.inDays(223), options: ROUTED });
  const onComplement = f.createStay({ startDate: f.inDays(230), endDate: f.inDays(233), touristTaxInComplement: 1, options: ROUTED });
  assert.equal(f.rowOf(onSolde).touristTaxTotal, 9);
  assert.equal(f.rowOf(onSolde).complementAmount, 80);
  assert.equal(f.rowOf(onComplement).complementAmount, 89);
  f.db.prepare('UPDATE reservations SET complementAmount = 0 WHERE id IN (?, ?)').run(onSolde, onComplement);

  const { repaired } = runCreatedComplementRepair(f.db, { today: f.inDays(60) });
  assert.deepEqual(repaired.map((r) => [r.id, r.amount]), [[onSolde, 80], [onComplement, 89]]);
});

test('a stay that has already ended is left alone', () => {
  withTax();
  const id = f.createStay({ startDate: f.inDays(250), endDate: f.inDays(253), options: ROUTED });
  f.db.prepare('UPDATE reservations SET complementAmount = 0 WHERE id = ?').run(id);
  assert.equal(runCreatedComplementRepair(f.db, { today: f.inDays(254) }).repaired.length, 0);
  assert.equal(runCreatedComplementRepair(f.db, { today: f.inDays(253) }).repaired.length, 1, 'the departure day still counts');
});

function devisWithRoutedLine(over = {}) {
  withTax();
  const created = devisModel.create({
    propertyId: 1, clientId: 1, startDate: f.inDays(281), endDate: f.inDays(284), adults: 2,
    platform: 'direct', selectedOptions: ROUTED, ...over,
  });
  assert.equal(created.error, undefined, created.error);
  return created.data.id;
}

test('a devis stores its arrival complement and the conversion carries it', () => {
  const devisId = devisWithRoutedLine();
  assert.equal(f.rowOf(devisId).complementAmount, 80);
  const converted = devisModel.convertToReservation(devisId);
  assert.equal(converted.error, undefined);
  assert.equal(f.rowOf(converted.data.reservationId).complementAmount, 80);
});

test('a devis stored before it kept the amount converts with the amount its totals prove', () => {
  const devisId = devisWithRoutedLine({ startDate: f.inDays(312), endDate: f.inDays(315), touristTaxInComplement: 1 });
  f.db.prepare('UPDATE reservations SET complementAmount = 0 WHERE id = ?').run(devisId);
  const converted = devisModel.convertToReservation(devisId);
  assert.equal(f.rowOf(converted.data.reservationId).complementAmount, 89);
});
