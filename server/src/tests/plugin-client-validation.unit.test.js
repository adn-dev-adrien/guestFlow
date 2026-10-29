// specs/plugins-phase-1-sdk.md rule 28, specs/gites-de-france-mail-intake.md rule 26 (audit 2026-10-28, F8) —
// a client created by a plugin goes through the client dialog's validation (one e-mail address, a phone of a
// sane shape), and an unverified mail never attaches a stay to a client who already holds its address.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-client-validation-')), 'g.db');
const db = require('../database');
const core = require('../plugins/sdk/coreServices');
const { isValidEmail } = require('../utils/clientValidation');

const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 4)").run().lastInsertRowid;
const placeholder = db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('GdF', 'Réservation')").run().lastInsertRowid;
const rid = db.prepare(`INSERT INTO reservations (clientId, kind, propertyId, startDate, endDate, adults, platform, sourceType, checkInTime, checkOutTime)
  VALUES (?, 'reservation', ?, '2099-07-10', '2099-07-13', 2, 'Gîtes de France', 'ical', '16:00', '10:00')`).run(placeholder, pid).lastInsertRowid;
const clientCount = () => db.prepare('SELECT COUNT(*) AS n FROM clients').get().n;
const guest = (extra) => ({ firstName: 'Camille', lastName: 'Martin', email: 'camille.martin@example.test', phone: '+33600000000', ...extra });

test('rule 28: an e-mail is one address — a list, an angle address or a quote is refused', () => {
  for (const bad of ['a@x.test,b@evil.test', 'a@x.test;b@evil.test', 'Claire <a@x.test>', 'a"b@x.test', 'a@x']) assert.equal(isValidEmail(bad), false, bad);
  for (const good of ['claire.dupont@example.org', 'a+b@sub.example.org', '']) assert.equal(isValidEmail(good), true, good);
});

test('rule 28: findOrCreate refuses an invalid e-mail or phone and creates nothing', () => {
  const before = clientCount();
  for (const bad of [{ email: 'a@x.test,b@evil.test' }, { email: 'nope' }, { phone: '12' }, { phone: '06 12\nIMPORTANT' }]) {
    assert.throws(() => core.clients.findOrCreate(guest(bad)), (err) => err.code === 'INVALID_CLIENT', JSON.stringify(bad));
  }
  assert.equal(clientCount(), before);
});

test('rule 28: an update with an invalid client is a 400 answer, not an exception, and leaves the fiche alone', () => {
  const before = clientCount();
  const result = core.reservations.update(rid, { adults: 3 }, { client: guest({ email: 'a@x.test,b@evil.test' }) });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'INVALID_CLIENT');
  assert.equal(clientCount(), before);
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = ?').get(rid).adults, 2);
});

test('rule 28: updateClient validates the e-mail and phone it is given', () => {
  const own = core.clients.findOrCreate(guest());
  assert.throws(() => core.clients.update(own.id, { email: 'a@x.test,b@evil.test' }), (err) => err.code === 'INVALID_CLIENT');
  assert.equal(core.clients.update(own.id, { phone: '+33611111111' }).phone, '+33611111111');
});

test('rule 26: a known address attaches to the client who holds it; an unverified mail creates a client of its own', () => {
  const holder = core.clients.findOrCreate(guest({ email: 'holder@example.test' }));
  assert.equal(core.clients.findOrCreate(guest({ email: 'holder@example.test' })).id, holder.id);
  const before = clientCount();
  const result = core.reservations.update(rid, { adults: 3 }, { client: guest({ email: 'holder@example.test' }), reuseByEmail: false });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.notEqual(result.clientId, holder.id);
  assert.equal(clientCount(), before + 1);
});
