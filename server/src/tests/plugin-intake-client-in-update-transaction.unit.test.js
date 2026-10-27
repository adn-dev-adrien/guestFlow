// specs/airbnb-mail-intake.md rule 21, gites-de-france-mail-intake.md rule 19, booking-extranet-intake.md rule 32
// (2026-10-27 spec review) — an intake's guest client is found or created by the core IN THE SAME
// TRANSACTION as the fiche's update (`ctx.core.reservations.update(id, patch, { client })`, SDK 2.7.0):
// a fiche the core refuses leaves no client behind holding the guest's personal data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-intake-client-tx-')), 'g.db');
const db = require('../database');
const core = require('../plugins/sdk/coreServices');

const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 4)").run().lastInsertRowid;
const placeholder = db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Airbnb', 'Réservation')").run().lastInsertRowid;
const rid = db.prepare(`INSERT INTO reservations (clientId, kind, propertyId, startDate, endDate, adults, platform, sourceType, checkInTime, checkOutTime)
  VALUES (?, 'reservation', ?, '2099-07-10', '2099-07-13', 2, 'Airbnb', 'ical', '16:00', '10:00')`).run(placeholder, pid).lastInsertRowid;
const clientCount = () => db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
const guest = { firstName: 'Camille', lastName: 'Martin', email: 'camille.martin@example.test', phone: '+33600000000' };

test('a refused fiche leaves no client behind', () => {
  const before = clientCount();
  const result = core.reservations.update(rid, { adults: 40 }, { label: 'Mail Airbnb du 24/10', client: guest });
  assert.notEqual(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.clientId, undefined);
  assert.equal(clientCount(), before, 'the guest client was rolled back with the refused update');
  assert.equal(db.prepare('SELECT clientId FROM reservations WHERE id = ?').get(rid).clientId, placeholder);
});

test('an accepted fiche points to the guest client, created once', () => {
  const before = clientCount();
  const result = core.reservations.update(rid, { adults: 3 }, { label: 'Mail Airbnb du 24/10', client: guest });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const created = db.prepare('SELECT * FROM clients WHERE email = ?').get(guest.email);
  assert.equal(result.clientId, created.id);
  assert.equal(clientCount(), before + 1);
  assert.equal(db.prepare('SELECT clientId, adults FROM reservations WHERE id = ?').get(rid).clientId, created.id);
});

test('without `client` the update behaves as before', () => {
  const result = core.reservations.update(rid, { adults: 2 });
  assert.equal(result.status, 200);
  assert.equal(result.clientId, undefined);
});
