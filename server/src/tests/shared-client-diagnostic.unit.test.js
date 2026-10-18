// specs/booking-extranet-intake.md rule 28 — the read-only report of the reservations whose client was
// overwritten through a client shared with other stays.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const { findOverwrittenClients, formatReport } = require('../../scripts/diagnose-shared-clients');

function fixtureDb(file = ':memory:') {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE properties (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', propertyId INTEGER, clientId INTEGER,
      startDate TEXT, endDate TEXT, platform TEXT, sourceType TEXT, reservationNumber TEXT, platformGrossAmount REAL);
    CREATE TABLE booking_intakes (id INTEGER PRIMARY KEY, resId TEXT, hotelId TEXT, reservationId INTEGER, status TEXT,
      error TEXT, parsed TEXT, createdAt TEXT);
    INSERT INTO properties VALUES (1, 'La Granja');
    INSERT INTO clients VALUES (140, 'Emma', 'Leroy', 'emma.5@guest.booking.com', NULL),
                               (141, 'Reserved', 'Ical', NULL, NULL),
                               (300, 'Jean', 'Fidèle', 'jean@exemple.fr', NULL);
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, platform, sourceType, reservationNumber, platformGrossAmount) VALUES
      (22307, 1, 140, '2027-02-05', '2027-02-07', 'Booking', 'ical', '4444444444', 300),
      (22308, 1, 140, '2027-02-26', '2027-02-28', 'Booking', 'ical', '5555555555', 400),
      (22309, 1, 140, '2027-03-05', '2027-03-07', 'Booking', 'ical', '202610001', NULL),
      (22400, 1, 141, '2027-04-01', '2027-04-03', 'Airbnb', 'ical', NULL, NULL),
      (22401, 1, 141, '2027-04-10', '2027-04-12', 'Airbnb', 'ical', NULL, NULL),
      (21000, 1, 300, '2025-07-01', '2025-07-04', 'Direct', 'manual', NULL, 900),
      (21001, 1, 300, '2026-07-01', '2026-07-04', 'Direct', 'manual', NULL, 900);
    INSERT INTO booking_intakes (resId, hotelId, reservationId, status, parsed, createdAt) VALUES
      ('4444444444', '1', 22307, 'applied', '{"booking":{"guest":{"firstName":"David","lastName":"Roux","email":"david.4@guest.booking.com"}}}', '2026-10-18 02:09'),
      ('5555555555', '1', 22308, 'applied', '{"booking":{"guest":{"firstName":"Emma","lastName":"Leroy","email":"emma.5@guest.booking.com"}}}', '2026-10-18 02:10');
  `);
  return db;
}

test('specs/booking-extranet-intake.md rule 28: a client shared by iCal stays and carrying a guest’s e-mail is reported with its stays', () => {
  const { suspects } = findOverwrittenClients(fixtureDb());
  assert.deepEqual(suspects.map((s) => s.client.id), [140]);
  assert.deepEqual(suspects[0].reservations.map((r) => r.id), [22307, 22308, 22309]);
  assert.equal(suspects[0].owner, 22308, 'the applied intake whose guest has this e-mail owns the client');
  assert.equal(suspects[0].reservations[0].intake.guest.email, 'david.4@guest.booking.com');
});

test('specs/booking-extranet-intake.md rule 28: an untouched shared placeholder and a repeat direct guest are not suspects', () => {
  const ids = findOverwrittenClients(fixtureDb()).suspects.map((s) => s.client.id);
  assert.equal(ids.includes(141), false);
  assert.equal(ids.includes(300), false);
});

test('specs/booking-extranet-intake.md rule 28: the report names what to keep and what to check, in French', () => {
  const text = formatReport(findOverwrittenClients(fixtureDb()));
  assert.match(text, /Client 140 — Emma Leroy — emma\.5@guest\.booking\.com/);
  assert.match(text, /fiche 22308 \(n° 5555555555\).*à garder/);
  assert.match(text, /fiche 22307 .*saisie Booking 4444444444 : David Roux <david\.4@guest\.booking\.com>/);
  assert.match(text, /fiche 22309 .*à vérifier/);
  assert.equal(formatReport({ suspects: [] }), 'Aucun client partagé portant les coordonnées d’un voyageur : rien à réparer.');
});

test('specs/booking-extranet-intake.md rule 28: a database without the intake table is still diagnosed', () => {
  const db = fixtureDb();
  db.exec('DROP TABLE booking_intakes');
  const { suspects } = findOverwrittenClients(db);
  assert.equal(suspects[0].owner, null);
});

test('specs/booking-extranet-intake.md rule 28: the script opens the file read-only and leaves it byte-identical', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-diag-'));
  const file = path.join(dir, 'copy.db');
  fixtureDb(file).close();
  const before = fs.readFileSync(file);
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'diagnose-shared-clients.js'), file, '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(out).suspects.length, 1);
  assert.ok(before.equals(fs.readFileSync(file)));
  fs.rmSync(dir, { recursive: true, force: true });
});
