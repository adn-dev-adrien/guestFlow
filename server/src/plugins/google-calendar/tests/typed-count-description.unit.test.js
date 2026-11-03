// specs/non-card-option-served-persons.md rule 27 + specs/google-calendar-oauth-rework.md rule 31 — the
// event description prints the count the fiche shows, not `quantity`, which stays 1 on a typed line.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildEventDescription, optionDisplayCount } = require('../events');
const { buildModel } = require('../model');
const { displayCountOf } = require('../../../utils/typedCounts');


function seededDb(start, end) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, propertyId INTEGER, clientId INTEGER, kind TEXT, startDate TEXT, endDate TEXT,
      checkInTime TEXT, checkOutTime TEXT, adults INTEGER, children INTEGER, teens INTEGER, babies INTEGER,
      singleBeds INTEGER, doubleBeds INTEGER, babyBeds INTEGER);
    CREATE TABLE options (id INTEGER PRIMARY KEY, title TEXT, showsPlanningCard INTEGER, isCancellationInsurance INTEGER);
    CREATE TABLE reservation_options (reservationId INTEGER, optionId INTEGER, quantity REAL, billedUnits REAL, priceType TEXT);
    INSERT INTO properties VALUES (1, 'Gîte');
    INSERT INTO clients VALUES (1, 'Test', 'Client');
  `);
  db.prepare("INSERT INTO reservations VALUES (1, 1, 1, 'reservation', ?, ?, '15:00', '10:00', 4, 0, 0, 0, 0, 0, 0)").run(start, end);
  const option = db.prepare('INSERT INTO options VALUES (?, ?, ?, ?)');
  option.run(1, 'Bois', 0, 0);
  option.run(2, 'Linge de bain', 0, 0);
  option.run(3, 'Repas', 0, 0);
  option.run(4, 'Ménage', 0, 0);
  option.run(5, 'Dîner', 1, 0);
  option.run(6, 'Assurance', 0, 1);
  const line = db.prepare('INSERT INTO reservation_options VALUES (1, ?, ?, ?, ?)');
  line.run(1, 1, 2, 'per_night');
  line.run(2, 1, 3, 'per_person');
  line.run(3, 1, 10, 'per_person_per_night');
  line.run(4, 2, 2, 'per_stay');
  line.run(5, 3, 9, 'per_person');
  line.run(6, 1, 5, 'per_night');
  return db;
}

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const EXPECTED = ['- Assurance x1', '- Bois x2', '- Dîner x3', '- Linge de bain x3', '- Ménage x2', '- Repas x2'];
const optionLinesOf = (reservation) => buildEventDescription(reservation, reservation.options)
  .split('\n').filter((l) => l.startsWith('- '));

test('rule 27 — a targeted push prints the typed people and nights', () => {
  const reservation = buildModel(seededDb(day(10), day(15))).getReservationForSync(1);
  assert.deepEqual(optionLinesOf(reservation), EXPECTED);
});

test('rule 27 — a full reconcile prints the same figures', () => {
  const [reservation] = buildModel(seededDb(day(10), day(15))).listReservationsForSync();
  assert.deepEqual(optionLinesOf(reservation), EXPECTED);
});

test('rule 27 — the plugin reads a line exactly as the core does', () => {
  const stay = { startDate: day(10), endDate: day(15) };
  const rows = [
    { priceType: 'per_person', quantity: 1, billedUnits: 3 },
    { priceType: 'per_night', quantity: 1, billedUnits: 2 },
    { priceType: 'per_person_per_night', quantity: 1, billedUnits: 10 },
    { priceType: 'per_person', quantity: 1.1, billedUnits: 12.1 },
    { priceType: 'per_stay', quantity: 2, billedUnits: 2 },
    { priceType: 'per_person', quantity: 2, billedUnits: null },
  ];
  for (const row of rows) {
    assert.equal(optionDisplayCount({ ...row, ...stay }), displayCountOf(row, stay), JSON.stringify(row));
  }
  assert.equal(optionDisplayCount({ priceType: 'per_person', quantity: 3, billedUnits: 9, isCard: 1, ...stay }), 3);
  assert.equal(optionDisplayCount({ priceType: 'per_night', quantity: 1, billedUnits: 5, isInsurance: 1, ...stay }), 1);
});
