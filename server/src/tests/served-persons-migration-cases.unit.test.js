// specs/non-card-option-served-persons.md rules 14, 16 and 19 (audit R21-S5) — the migration's ceiling and its
// « equal, so it follows » on the cases that tell people from nights, and the boot that really runs it. Each line
// starts as a stored base quantity, what a release before v3.20.0 wrote.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');

function boot(file) {
  return spawnSync(process.execPath, ['-e', "require('./src/database'); process.exit(0);"], {
    cwd: ROOT, env: { ...process.env, DB_PATH: file, SKIP_MIGRATIONS: '' }, encoding: 'utf8',
  });
}

function bootedDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-typed-mig-'));
  const file = path.join(dir, 'boot.db');
  const first = boot(file);
  assert.equal(first.status, 0, first.stderr);
  const db = new Database(file);
  db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (900, 'Granja', 13)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (900, 'Test', 'Client')").run();
  db.prepare(`INSERT INTO options (id, title, price, priceType) VALUES
    (909, 'Linge de toilette', 8, 'per_person'), (910, 'Panier', 10, 'per_person_per_night'), (911, 'Bois', 5, 'per_night')`).run();
  return { db, file, dir };
}

let nextId = 9000;
function seedLine(db, optionId, { adults, nights = 2, quantity, billedUnits, priceType = 'per_person' }) {
  nextId += 1;
  const end = String(1 + nights).padStart(2, '0');
  db.prepare(`INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, adults, children, teens, kind)
              VALUES (?, 900, 900, '2099-03-01', ?, ?, 0, 0, 'reservation')`).run(nextId, `2099-03-${end}`, adults);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice)
              VALUES (?, ?, ?, 8, ?, ?, ?)`).run(nextId, optionId, quantity, billedUnits, priceType, billedUnits * 8);
  return nextId;
}

const stored = (db, id) => db.prepare('SELECT quantity, cardPersons, cardNights, billedUnits, totalPrice FROM reservation_options WHERE reservationId = ?').get(id);

test('rules 14, 16, 19 — the boot of a release runs the migration on the stored lines, once, and moves no amount', () => {
  const { db, file, dir } = bootedDb();
  const typed = seedLine(db, 909, { adults: 4, quantity: 0.75, billedUnits: 3 });
  const aboveTheParty = seedLine(db, 909, { adults: 2, quantity: 2.5, billedUnits: 5 });
  const atTheCeiling = seedLine(db, 909, { adults: 2, quantity: 6.5, billedUnits: 13 });
  const aboveTheCeiling = seedLine(db, 909, { adults: 2, quantity: 7, billedUnits: 14 });
  const perPersonPerNight = seedLine(db, 910, { adults: 2, nights: 3, quantity: 1.5, billedUnits: 15, priceType: 'per_person_per_night' });
  const nightsLikeTheParty = seedLine(db, 911, { adults: 4, nights: 2, quantity: 2, billedUnits: 4, priceType: 'per_night' });
  const nightsLikeTheStay = seedLine(db, 911, { adults: 4, nights: 2, quantity: 2.5, billedUnits: 2, priceType: 'per_night' });
  const nightsAboveCapacity = seedLine(db, 911, { adults: 2, nights: 2, quantity: 7, billedUnits: 14, priceType: 'per_night' });
  db.prepare("DELETE FROM migrations WHERE name = 'non_card_served_persons_v1'").run();
  db.close();

  const second = boot(file);
  assert.equal(second.status, 0, second.stderr);

  const after = new Database(file);
  assert.ok(after.prepare("SELECT 1 FROM migrations WHERE name = 'non_card_served_persons_v1'").get());
  assert.deepEqual(stored(after, typed), { quantity: 1, cardPersons: 3, cardNights: null, billedUnits: 3, totalPrice: 24 });
  assert.deepEqual([stored(after, aboveTheParty).quantity, stored(after, aboveTheParty).cardPersons], [1, 5], 'rule 16: party 2 < count 5 ≤ capacity 13');
  assert.deepEqual([stored(after, atTheCeiling).quantity, stored(after, atTheCeiling).cardPersons], [1, 13], 'rule 16: the ceiling is the capacity');
  assert.deepEqual([stored(after, aboveTheCeiling).quantity, stored(after, aboveTheCeiling).cardPersons], [7, null], 'rule 16: above it, left as it is');
  assert.deepEqual([stored(after, perPersonPerNight).quantity, stored(after, perPersonPerNight).cardPersons], [1, 5], 'rule 14: 15 units over 3 nights');
  assert.deepEqual([stored(after, nightsLikeTheParty).quantity, stored(after, nightsLikeTheParty).cardNights], [1, 4], 'rule 19: a night count equal to the party is still frozen');
  assert.deepEqual([stored(after, nightsLikeTheStay).quantity, stored(after, nightsLikeTheStay).cardNights], [1, null], 'rule 19: equal to the stay, it follows the stay');
  assert.deepEqual([stored(after, nightsAboveCapacity).quantity, stored(after, nightsAboveCapacity).cardNights], [1, 14], 'rule 19: the people ceiling says nothing about nights');
  for (const id of [nightsAboveCapacity, nightsLikeTheParty]) assert.equal(stored(after, id).totalPrice, stored(after, id).billedUnits * 8);

  // Behind its flag: a line written afterwards is left for what it is.
  const late = seedLine(after, 909, { adults: 4, quantity: 0.5, billedUnits: 2 });
  after.close();
  assert.equal(boot(file).status, 0);
  const third = new Database(file);
  assert.equal(stored(third, late).quantity, 0.5);
  third.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
