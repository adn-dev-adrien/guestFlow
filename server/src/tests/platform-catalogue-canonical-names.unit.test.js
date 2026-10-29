// 2026-10-27 spec review (specs/platforms-and-ical-rework.md rules 15-16) — one platform, one catalogue
// row, one source per property, however its name is sent; and a platform that appears after the boot is
// on Paramètres › Plateformes at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-platform-canonical-')), 'g.db');
const silent = console.log;
console.log = () => {};
const db = require('../database');
const propertyIcalModel = require('../models/propertyIcalModel');
const { globalFetch } = require('./icalFetchFixture');
const platformsController = require('../controllers/platformsController');
console.log = silent;

const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Gîte', 6)").run().lastInsertRowid;
const cid = db.prepare("INSERT INTO clients (firstName, lastName) VALUES ('Jean', 'Dupont')").run().lastInsertRowid;
const ical = propertyIcalModel.buildModel(db, { fetchImpl: globalFetch });
const platformNames = () => db.prepare('SELECT name FROM platforms ORDER BY name').all().map((r) => r.name);
const sources = () => db.prepare('SELECT platformKey, platformLabel, url FROM ical_sources WHERE propertyId = ? ORDER BY id').all(pid);

function listSettings() {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  platformsController.listSettings({ params: {}, query: {}, body: {} }, res);
  return res.body.platforms.map((p) => p.name);
}

test('a platform first used by a reservation after the boot is listed on « Plateformes »', () => {
  db.prepare(`INSERT INTO reservations (clientId, kind, propertyId, startDate, endDate, platform)
    VALUES (?, 'reservation', ?, '2027-05-10', '2027-05-13', 'Pitchup')`).run(cid, pid);
  assert.ok(listSettings().includes('Pitchup'));
});

test('a reservation spelling of a known platform adds no second row', () => {
  db.prepare(`INSERT INTO reservations (clientId, kind, propertyId, startDate, endDate, platform)
    VALUES (?, 'reservation', ?, '2027-06-10', '2027-06-13', 'pitchup')`).run(cid, pid);
  assert.deepEqual(listSettings().filter((n) => n.toLowerCase() === 'pitchup'), ['Pitchup']);
});

test('POST ical-sources with `BookingCom` lands on Booking, its existing source included', () => {
  assert.equal(ical.createSource(pid, { platformKey: 'booking', platformLabel: 'Booking', url: 'https://example.test/b1.ics' }).error, undefined);
  const res = ical.createSource(pid, { platformKey: 'BookingCom', platformLabel: 'BookingCom', url: 'https://example.test/b2.ics' });
  assert.equal(res.error, undefined);
  const booking = sources().filter((s) => /booking/i.test(s.platformLabel));
  assert.deepEqual(booking, [{ platformKey: 'booking', platformLabel: 'Booking', url: 'https://example.test/b2.ics' }]);
  assert.equal(listSettings().includes('BookingCom'), false);
});

test('POST ical-sources with `gites-de-france` updates the `gitesdefrance` source', () => {
  ical.createSource(pid, { platformKey: 'gitesdefrance', platformLabel: 'GitesDeFrance', url: 'https://example.test/g1.ics' });
  ical.createSource(pid, { platformKey: 'gites-de-france', platformLabel: 'gites-de-france', url: 'https://example.test/g2.ics' });
  const gdf = sources().filter((s) => /gites/i.test(s.platformLabel));
  assert.deepEqual(gdf, [{ platformKey: 'gitesdefrance', platformLabel: 'GitesDeFrance', url: 'https://example.test/g2.ics' }]);
  assert.deepEqual(platformNames().filter((n) => /gite/i.test(n)), ['GitesDeFrance']);
});

test('« Ajouter une plateforme » with « Booking.com » registers no second Booking', () => {
  const before = platformNames().length;
  const row = require('../models/platformsModel').create(db).setColor('Booking.com', '');
  assert.equal(row.name, 'Booking');
  assert.equal(platformNames().length, before);
});

test('a genuinely new platform keeps its own canonical name and key', () => {
  ical.createSource(pid, { platformKey: 'vrbo-tente', platformLabel: 'Vrbo tente', url: '' });
  assert.deepEqual(sources().filter((s) => /vrbo/i.test(s.platformLabel)).map((s) => [s.platformKey, s.platformLabel]), [['vrbotente', 'VrboTente']]);
});
