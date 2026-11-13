// specs/pricing-components.md §3 rules 14 and 25 (PR C, C21); specs/reopen-completed-sas.md §4 rule 4 (amended): reopening the arrival SAS
// changes the lines it wrote in place (same row, same identity), appends the new ones and flags them « Ajoutée à la réouverture »;
// it never deletes a line to write it again.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const { create } = require('../models/ports/stayRepository');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const PILLOW = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Taie d''oreiller', 3.3, 'bed')").run().lastInsertRowid);
const SHEET = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Drap', 12, 'bed')").run().lastInsertRowid);

let nextId = 700;
function stay() {
  const id = nextId++;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, complementAmount)
    VALUES (?, 'reservation', 1, 1, '2027-07-10', '2027-07-12', 'direct', 2, 0)`).run(id);
  return id;
}
const commit = (id, linenItems) => model.commitArrivalSas(id, { complementItems: model.resolveSasArrivalItems(id, { linenItems }) });
const journal = (id) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id)
  .flatMap((r) => JSON.parse(r.changedFields)).filter((c) => c.field === 'sasReopen');
const rows = (id) => db.prepare('SELECT id, lineId, description, quantity, addedOnReopen, soldAt FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1 ORDER BY id').all(id);

test('the first run flags nothing: no line is « ajoutée à la réouverture »', () => {
  const id = stay();
  commit(id, [{ itemId: PILLOW, qty: 2 }]);
  assert.deepEqual(rows(id).map((r) => r.addedOnReopen), [0]);
});

test('a reopened run changes a line in place and keeps its identity', () => {
  const id = stay();
  commit(id, [{ itemId: PILLOW, qty: 2 }]);
  const [first] = rows(id);
  commit(id, [{ itemId: PILLOW, qty: 3 }]);
  const [again] = rows(id);
  assert.equal(again.id, first.id);
  assert.equal(again.lineId, first.lineId);
  assert.equal(again.quantity, 3);
  assert.equal(again.soldAt, first.soldAt, 'the sale date is the first run’s');
  assert.equal(again.addedOnReopen, 0);
});

test('a reopened run appends the new line, flags it, and journals it', () => {
  const id = stay();
  commit(id, [{ itemId: PILLOW, qty: 1 }]);
  commit(id, [{ itemId: PILLOW, qty: 1 }, { itemId: SHEET, qty: 1 }]);
  const byLabel = Object.fromEntries(rows(id).map((r) => [r.description, r]));
  assert.equal(byLabel["Taie d'oreiller"].addedOnReopen, 0);
  assert.equal(byLabel.Drap.addedOnReopen, 1);
  assert.equal(journal(id).length, 1);
  assert.match(journal(id)[0].to, /Ajoutée à la réouverture : Drap/);
  const facts = Object.values(create(db).lineFacts(id)).filter((f) => f.table === 'custom');
  assert.deepEqual(facts.map((f) => f.addedOnReopen).sort(), [false, true]);
});

test('an identical re-run changes nothing: same rows, no flag, no journal line', () => {
  const id = stay();
  commit(id, [{ itemId: PILLOW, qty: 2 }, { itemId: SHEET, qty: 1 }]);
  const before = rows(id);
  commit(id, [{ itemId: PILLOW, qty: 2 }, { itemId: SHEET, qty: 1 }]);
  assert.deepEqual(rows(id), before);
  assert.equal(journal(id).length, 0);
});

test('a line the new selection no longer holds is removed, the others keep their rows', () => {
  const id = stay();
  commit(id, [{ itemId: PILLOW, qty: 1 }, { itemId: SHEET, qty: 1 }]);
  const sheet = rows(id).find((r) => r.description === 'Drap');
  commit(id, [{ itemId: SHEET, qty: 1 }]);
  assert.deepEqual(rows(id).map((r) => r.id), [sheet.id]);
});

test('an option the reopened SAS appended is flagged too, an existing one is not', () => {
  const id = stay();
  const kept = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Ménage fictif', 40, 'per_stay')").run().lastInsertRowid);
  const added = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Linge fictif', 8, 'per_stay')").run().lastInsertRowid);
  const insert = db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, sasArrivalOrigin, soldAt) VALUES (?, ?, 1, 10, 1, 'flat', 10, 1, 1, ?)");
  insert.run(id, kept, '2027-07-10T08:00:00.000Z');
  insert.run(id, added, null);
  const labels = require('../models/extraSalesModel').stampSasLines(id, '2027-07-10T09:00:00.000Z', { reopened: true });
  assert.deepEqual(labels, ['Linge fictif']);
  const flags = db.prepare('SELECT optionId, addedOnReopen FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(id);
  assert.deepEqual(flags.map((f) => [f.optionId, f.addedOnReopen]), [[kept, 0], [added, 1]]);
});
