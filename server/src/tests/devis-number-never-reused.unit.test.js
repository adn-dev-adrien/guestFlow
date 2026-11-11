// specs/public-request-abuse-and-grouping.md rule 35 (audit R34b N3-2). « A quote number may have gaps, not repeats »
// (rule 10) held for the purge of website requests only: a devis deleted from its fiche (« Supprimer… », allowed again on
// the devis of a cancelled stay by deposit-blocks-the-dates rule 23) or by a client's or a logement's cascade gave its
// number back, and the next devis carried the number a guest already held on a PDF.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const f = require('./ledgerFixture');
const devisModel = require('../models/devisModel');

const { db, inDays } = f;
f.seed();

let slot = 0;
function newDevis(over = {}) {
  slot += 1;
  const created = devisModel.create(f.stayBody({ startDate: inDays(200 + slot * 4), endDate: inDays(202 + slot * 4), ...over }));
  assert.ok(created.ok, JSON.stringify(created));
  const row = db.prepare('SELECT id, devisNumber FROM reservations WHERE id = ?').get(created.data.id);
  assert.match(row.devisNumber, /^\d{4}-\d{2}-\d{3}$/);
  return row;
}
const allNumbers = () => db.prepare("SELECT devisNumber FROM reservations WHERE kind = 'devis'").all().map((r) => r.devisNumber);

test('N3-2 — « Supprimer… » on the latest devis: the next devis never gets its number again', () => {
  newDevis();
  const latest = newDevis();
  assert.ok(devisModel.remove(latest.id).ok);
  const next = newDevis();
  assert.notEqual(next.devisNumber, latest.devisNumber);
  assert.ok(next.devisNumber > latest.devisNumber);
});

test('N3-2 — the devis of a cancelled stay, deleted (rule 23), keeps its number retired', () => {
  const devis = newDevis();
  const rid = devisModel.convertToReservation(devis.id).data.reservationId;
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(rid);
  assert.ok(devisModel.remove(devis.id).ok);
  assert.notEqual(newDevis().devisNumber, devis.devisNumber);
});

test('N3-2 — a client deleted with its devis (cascade) retires their numbers', () => {
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (7, 'Alix', 'Cascade')").run();
  const devis = newDevis({ clientId: 7 });
  db.prepare('DELETE FROM clients WHERE id = 7').run();
  assert.equal(db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(devis.id), undefined, 'cascaded');
  const next = newDevis();
  assert.ok(next.devisNumber > devis.devisNumber);
  assert.ok(!allNumbers().some((n) => allNumbers().filter((m) => m === n).length > 1), 'no number twice');
});
