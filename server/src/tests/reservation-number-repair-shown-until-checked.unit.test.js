// specs/reservation-number-and-search.md rule 15 — review 2026-10-18 (second pass), finding 4: the boot
// repair of rule 14 only wrote to the boot log, which the operator never reads, while a repaired ghost
// keeps blocking its dates and leaves in the iCal export. The repair now stamps the stay, and the
// dashboard lists it until the operator says « Vu ».

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { repairNumberlessReservations, monthPrefix } = require('../utils/reservationNumber');
const reservationsModel = require('../models/reservationsModel');
const { buildController } = require('../controllers/dashboardController');

const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();

test('rule 15 — the boot migration adds the stamp column', () => {
  const cols = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  assert.ok(cols.includes('numberRepairedAt'));
});

test('rule 15 — a repaired stay is listed on the dashboard until « Vu », and only then', () => {
  const ghost = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, createdAt)
                                   VALUES ('reservation', 1, 1, '2027-06-20', '2027-06-22', datetime('now'))`).run().lastInsertRowid);
  const numbered = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, reservationNumber)
                                      VALUES ('reservation', 1, 1, '2027-07-01', '2027-07-03', '209901001')`).run().lastInsertRowid);
  const [repaired] = repairNumberlessReservations(db);
  assert.equal(repaired.id, ghost);
  assert.ok(repaired.reservationNumber.startsWith(monthPrefix(new Date())));

  const controller = buildController();
  const listed = fakeRes();
  controller.repairedReservationNumbers({}, listed);
  assert.equal(listed.body.alerts.length, 1);
  assert.deepEqual({ ...listed.body.alerts[0], repairedAt: undefined }, {
    reservationId: ghost, reservationNumber: repaired.reservationNumber, clientName: 'Jean Dupont',
    propertyName: 'Gîte', startDate: '2027-06-20', endDate: '2027-06-22', repairedAt: undefined,
  });
  assert.ok(listed.body.alerts[0].repairedAt, 'the date of the repair travels with the row');

  const notListed = fakeRes();
  controller.acknowledgeRepairedReservationNumber({ params: { id: String(numbered) } }, notListed);
  assert.equal(notListed.statusCode, 404, 'a stay that was never repaired has nothing to acknowledge');

  const seen = fakeRes();
  controller.acknowledgeRepairedReservationNumber({ params: { id: String(ghost) } }, seen);
  assert.equal(seen.statusCode, 200);
  const after = fakeRes();
  controller.repairedReservationNumbers({}, after);
  assert.deepEqual(after.body.alerts, []);
  assert.equal(db.prepare('SELECT reservationNumber FROM reservations WHERE id = ?').get(ghost).reservationNumber,
    repaired.reservationNumber, '« Vu » keeps the number');
});

test('rule 15 — a bad id is refused; a schema without the stamp lists nothing', () => {
  const bad = fakeRes();
  buildController().acknowledgeRepairedReservationNumber({ params: { id: 'x' } }, bad);
  assert.equal(bad.statusCode, 400);
  const Database = require('better-sqlite3');
  const bare = new Database(':memory:');
  bare.exec("CREATE TABLE reservations (id INTEGER PRIMARY KEY, kind TEXT, reservationNumber TEXT)");
  assert.deepEqual(reservationsModel.create(bare).listRepairedNumbers(), []);
  assert.equal(reservationsModel.create(bare).acknowledgeRepairedNumber(1), false);
});
