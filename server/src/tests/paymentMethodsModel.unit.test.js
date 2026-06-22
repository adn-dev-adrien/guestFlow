const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/paymentMethodsModel');

// specs/direct-payment-method-commission.md §3.1 — payment-method catalogue invariants:
// single default, deactivate-not-delete when referenced, default neither deletable nor deactivatable.

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function freshModel() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  // Mirror the boot seed: four 0 % methods, Virement is the default.
  const seed = db.prepare('INSERT INTO payment_methods (name, commissionPercent, isDefault, sortOrder) VALUES (?, 0, ?, ?)');
  seed.run('Virement', 1, 0);
  seed.run('Espèces', 0, 1);
  seed.run('Chèque', 0, 2);
  seed.run('Carte bancaire', 0, 3);
  return { db, model: buildModel(db) };
}

test('listActive returns the seeded methods; exactly one is default', () => {
  const { model } = freshModel();
  const active = model.listActive();
  assert.equal(active.length, 4);
  assert.equal(active.filter((m) => m.isDefault === 1).length, 1);
  assert.equal(model.getDefault().name, 'Virement');
});

test('create clamps the rate and can claim the default (clearing the previous one)', () => {
  const { model } = freshModel();
  const created = model.create({ name: 'Stripe', commissionPercent: 150, isDefault: true });
  assert.equal(created.commissionPercent, 99.99); // clamped to max
  assert.equal(created.isDefault, 1);
  assert.equal(model.getDefault().name, 'Stripe');
  assert.equal(model.listAll().filter((m) => m.isDefault === 1).length, 1);
});

test('create rejects a duplicate name', () => {
  const { model } = freshModel();
  assert.throws(() => model.create({ name: 'Virement' }), /NAME_TAKEN/);
});

test('update can change the rate; setting default moves it', () => {
  const { model } = freshModel();
  const cb = model.listActive().find((m) => m.name === 'Carte bancaire');
  const updated = model.update(cb.id, { commissionPercent: 1.5, isDefault: true });
  assert.equal(updated.commissionPercent, 1.5);
  assert.equal(model.getDefault().id, cb.id);
});

test('the default method cannot be deactivated', () => {
  const { model } = freshModel();
  const def = model.getDefault();
  assert.throws(() => model.setActive(def.id, false), /DEFAULT_NOT_DEACTIVATABLE/);
});

test('the default method cannot be deleted', () => {
  const { model } = freshModel();
  const def = model.getDefault();
  assert.throws(() => model.remove(def.id), /DEFAULT_NOT_DELETABLE/);
});

test('an unreferenced non-default method is hard-deleted', () => {
  const { model } = freshModel();
  const cheque = model.listActive().find((m) => m.name === 'Chèque');
  const result = model.remove(cheque.id);
  assert.deepEqual(result, { deleted: true });
  assert.equal(model.findById(cheque.id), null);
});

test('a referenced method is deactivated, not deleted (snapshot preserved)', () => {
  const { db, model } = freshModel();
  const cb = model.listActive().find((m) => m.name === 'Carte bancaire');
  // Minimal reservation row referencing the method on its balance.
  db.prepare('INSERT INTO clients (id, firstName, lastName) VALUES (1, \'A\', \'B\')').run();
  db.prepare('INSERT INTO properties (id, name) VALUES (1, \'P\')').run();
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, balancePaymentMethodId)
              VALUES (1, 1, 1, '2026-07-10', '2026-07-12', ?)`).run(cb.id);
  const result = model.remove(cb.id);
  assert.equal(result.deactivated, true);
  assert.equal(model.findById(cb.id).isActive, 0);
  assert.equal(model.listActive().some((m) => m.id === cb.id), false);
});

test('rateMap includes inactive methods so historical snapshots still resolve', () => {
  const { model } = freshModel();
  const cheque = model.listActive().find((m) => m.name === 'Chèque');
  model.setActive(cheque.id, false);
  const map = model.rateMap();
  assert.ok(map[cheque.id], 'inactive method present in rateMap');
});
