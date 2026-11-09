// specs/mixed-method-payments.md rule 48 (audit R34-DB-L1) — a release that knew nothing of settlements (a rollback) can
// take a split payment back by writing its paid flag alone; once the release is installed again, every boot re-checks
// the settlements of every stay (`syncAll`) before the server answers: the orphan is dropped, the aggregates refreshed.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../database');
const settlementsModel = require('../models/paymentSettlementsModel');
const { comptaCollected, remainingToPay } = require('../utils/reservationSettlement');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

const TODAY = getTodayIsoDate();
db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (1, 'Gîte', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();

const row = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

// A solde of 1 834,20 € paid as 500 € cash in the caisse + 1 200 € card, 134,20 € left to collect.
function splitSolde() {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, finalPrice,
      depositAmount, balanceAmount, balancePaid, balancePaidDate)
    VALUES (1, 1, date(?, '+30 day'), date(?, '+33 day'), 'direct', 2, 1834.2, 0, 1834.2, 1, ?)`).run(TODAY, TODAY, TODAY).lastInsertRowid);
  settlementsModel.insert({
    reservationId: id, targetKind: 'bucket', targetKey: 'balance', paidDate: TODAY, dueCents: 183420,
    shortfallCents: 13420, shortfallKind: 'due', parts: [{ kind: 'balance', key: 'balance', amountCents: 183420 }],
    lines: [{ method: 'cash', amountCents: 50000, internal: true }, { method: 'card', amountCents: 120000, internal: false }],
  });
  return id;
}

test('specs/mixed-method-payments.md rule 48 — the solde taken back by an older release: the next boot drops its settlement', () => {
  const id = splitSolde();
  const kept = splitSolde();
  // What the older release's « Annuler l'encaissement » writes: the flags alone.
  db.prepare('UPDATE reservations SET balancePaid = 0, balancePaidDate = NULL WHERE id = ?').run(id);
  assert.equal(comptaCollected(row(id)) < 0, true, 'before the boot the stale aggregates read a negative collected');

  assert.equal(settlementsModel.syncAll(), 1);
  const r = row(id);
  assert.equal(settlementsModel.listFor(id).length, 0);
  assert.deepEqual([r.splitOffBooksAmount, r.splitShortfallDue], [0, 0]);
  assert.equal(comptaCollected(r), 0);
  assert.equal(remainingToPay(r), 1834.2);
  // The stay still paid keeps its split payment; a second boot writes nothing.
  assert.equal(settlementsModel.listFor(kept).length, 1);
  assert.equal(settlementsModel.syncAll(), 0);
});

test('specs/mixed-method-payments.md rule 48 — the server runs it at every boot, before it answers', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const call = source.indexOf('.syncAll()');
  assert.ok(call > 0, 'index.js runs the settlements sync');
  assert.ok(call < source.indexOf('serverHandle.listen('), 'before the server listens');
});
