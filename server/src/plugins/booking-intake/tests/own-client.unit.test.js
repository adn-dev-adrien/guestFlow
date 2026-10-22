// specs/booking-extranet-intake.md rule 25 — the guest gets a client of their own. The iCal import gave
// one placeholder client to every stay of a feed (« Closed Not available » on Booking's), so filling a
// fiche used to rename every other stay sharing it, e-mail included (review 2026-10-18, B1).
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel, TABLE_SQL } = require('../intakesModel');
const { createIntakeService } = require('../intakeService');
const { PAGE_6392081711 } = require('./fixtures');

const DAVID = { name: 'David Roux', email: 'droux.4444@guest.booking.com' };
const EMMA = { name: 'Emma Leroy', email: 'eleroy.5555@guest.booking.com' };

const pageFor = (guest) => ({
  hotelId: '14407976',
  resId: '6392081711',
  text: PAGE_6392081711.split('Camille Garnier').join(guest.name).split('cgarnier.123456@guest.booking.com').join(guest.email),
});

// A database with the two tables the intake touches, and a core that writes them the way the real one does.
function setup() {
  const db = new Database(':memory:');
  db.exec(TABLE_SQL);
  db.exec(`
    CREATE TABLE clients (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT, phone TEXT, emailLanguage TEXT);
    CREATE TABLE reservations (
      id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'reservation', propertyId INTEGER, clientId INTEGER,
      startDate TEXT, endDate TEXT, platform TEXT, reservationNumber TEXT, adults INTEGER, children INTEGER,
      teens INTEGER, babies INTEGER, checkInTime TEXT, notes TEXT, platformGrossAmount REAL,
      platformTouristTaxAmount REAL, platformPayoutAmount REAL
    );
    INSERT INTO clients (id, firstName, lastName) VALUES (140, 'Closed', 'Not available');
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, platform, adults, children, teens, babies, notes)
      VALUES (22307, 1, 140, '2026-11-06', '2026-11-08', 'Booking', 1, 0, 0, 0, ''),
             (22308, 1, 140, '2026-11-06', '2026-11-08', 'Booking', 1, 0, 0, 0, '');
  `);
  const RES_COLUMNS = ['clientId', 'platform', 'reservationNumber', 'adults', 'children', 'teens', 'babies', 'checkInTime', 'notes',
    'platformGrossAmount', 'platformTouristTaxAmount', 'platformPayoutAmount'];
  const target = { id: 22307 };
  const service = createIntakeService({
    intakes: buildModel(db),
    hotelIds: () => ({ 1: '14407976' }),
    today: () => '2026-10-16',
    now: () => new Date(2026, 9, 16, 9, 0),
    findReservations: () => [{ id: target.id }],
    getReservation: (id) => db.prepare(`
      SELECT r.*, c.firstName, c.lastName, c.email, c.phone FROM reservations r LEFT JOIN clients c ON c.id = r.clientId WHERE r.id = ?
    `).get(id),
    clientShared: (clientId, reservationId) => Boolean(db
      .prepare('SELECT 1 FROM reservations WHERE clientId = ? AND id != ? LIMIT 1').get(clientId, reservationId == null ? -1 : reservationId)),
    core: {
      updateReservation: (id, patch) => {
        const cols = RES_COLUMNS.filter((c) => c in patch);
        db.prepare(`UPDATE reservations SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
          .run({ ...Object.fromEntries(cols.map((c) => [c, patch[c]])), id });
        return { status: 200, body: { ok: true } };
      },
      findOrCreateClient: (p) => db.prepare('SELECT * FROM clients WHERE lower(email) = lower(?)').get(p.email)
        || db.prepare('SELECT * FROM clients WHERE id = ?').get(db.prepare(
          'INSERT INTO clients (firstName, lastName, email, phone, emailLanguage) VALUES (?, ?, ?, ?, ?)',
        ).run(p.firstName, p.lastName, p.email, p.phone || null, p.emailLanguage).lastInsertRowid),
      updateClient: (id, p) => db.prepare('UPDATE clients SET firstName = ?, lastName = ?, email = ? WHERE id = ?').run(p.firstName, p.lastName, p.email, id),
      suggestBeds: () => ({ singleBeds: 6, doubleBeds: 4 }),
      platformCommission: (f) => Math.round((f.gross - f.payout - f.touristTax) * 100) / 100,
      withholdsTouristTax: () => true,
    },
  });
  const guestOf = (id) => db.prepare('SELECT c.id, c.firstName, c.lastName, c.email FROM reservations r JOIN clients c ON c.id = r.clientId WHERE r.id = ?').get(id);
  const fill = (id, guest) => { target.id = id; return service.handlePage(pageFor(guest)); };
  return { db, service, guestOf, fill };
}

test('specs/booking-extranet-intake.md rule 25: two stays sharing the placeholder client, filled in turn, each get their own guest', () => {
  const { fill, guestOf, db } = setup();
  assert.equal(fill(22307, DAVID).status, 'applied');
  assert.equal(guestOf(22307).email, DAVID.email);
  assert.equal(guestOf(22308).email, null, 'the other stay keeps its placeholder');
  assert.equal(fill(22308, EMMA).status, 'applied', 'the second stay is still untouched, not « déjà remplie »');
  assert.deepEqual([guestOf(22307).firstName, guestOf(22307).email], ['David', DAVID.email]);
  assert.deepEqual([guestOf(22308).firstName, guestOf(22308).email], ['Emma', EMMA.email]);
  assert.deepEqual(db.prepare('SELECT firstName, lastName, email FROM clients WHERE id = 140').get(),
    { firstName: 'Closed', lastName: 'Not available', email: null }, 'the shared placeholder is never written');
});

test('specs/booking-extranet-intake.md rule 25: a shared client already carrying another guest’s e-mail counts as untouched', () => {
  const { db, fill, guestOf } = setup();
  db.prepare("UPDATE clients SET firstName = 'David', lastName = 'Roux', email = ? WHERE id = 140").run(DAVID.email);
  assert.equal(fill(22308, EMMA).status, 'applied');
  assert.equal(guestOf(22308).email, EMMA.email);
  assert.equal(guestOf(22307).email, DAVID.email, 'the other stay is left as it was');
});

test('specs/booking-extranet-intake.md rule 25: « Appliquer » on a proposal relinks the fiche, never renames the other guest', () => {
  const { db, service, fill, guestOf } = setup();
  fill(22307, DAVID);
  db.prepare('UPDATE reservations SET clientId = (SELECT clientId FROM reservations WHERE id = 22307), platformGrossAmount = 1 WHERE id = 22308').run();
  const proposed = fill(22308, EMMA);
  assert.equal(proposed.status, 'proposed');
  const intake = db.prepare("SELECT id FROM booking_intakes WHERE status = 'proposed'").get();
  assert.equal(service.applyProposal(intake.id).status, 'applied');
  assert.equal(guestOf(22308).email, EMMA.email);
  assert.deepEqual([guestOf(22307).firstName, guestOf(22307).email], ['David', DAVID.email]);
});

test('specs/booking-extranet-intake.md rule 25: a client found by e-mail that another stay uses is linked, not rewritten', () => {
  const { db, fill, guestOf } = setup();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (200, 'Dave', 'Roux-Martin', ?)").run(DAVID.email);
  db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate) VALUES (21000, 1, 200, '2025-07-01', '2025-07-04')").run();
  assert.equal(fill(22307, DAVID).status, 'applied');
  assert.equal(guestOf(22307).id, 200);
  assert.deepEqual([guestOf(21000).firstName, guestOf(21000).lastName], ['Dave', 'Roux-Martin']);
});
