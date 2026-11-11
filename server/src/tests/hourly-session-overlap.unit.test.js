// specs/plugins-phase-3c-hourly-resources.md rule 30 — two sessions of a stay on the same hour of a
// resource that exists once are a double booking. The fiche used to save them (review 2026-10-18,
// F4: « Bain nordique ×2h », both on ven. 13 nov. 11:00–12:00); the save is now refused, as the arrival
// SAS already refuses an overlapping block.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { firstSessionConflict, conflictError } = require('../utils/resourceSessionConflicts');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

// date-literal-ok: an input of the pure conflict check and of the message it formats, never compared with today
const DAY = '2026-11-13';
const NEXT_DAY = addDaysToIsoDate(DAY, 1);
// The fiche stay hangs on today: a literal date becomes a stay in the past.
const inDays = (days) => addDaysToIsoDate(todayIso(), days);

const one = () => 1;
const line = (sessions, resourceId = 4) => ({ resourceId, quantity: 2, sessions });

test('rule 30 — two sessions on the same slot of a single resource are a conflict', () => {
  const conflict = firstSessionConflict([line([
    { date: DAY, start: '11:00', end: '12:00' },
    { date: DAY, start: '11:00', end: '12:00' },
  ])], one);
  assert.deepEqual(conflict, { resourceId: 4, date: DAY, start: '11:00', end: '12:00' });
  const body = conflictError(conflict);
  assert.equal(body.code, 'SESSIONS_OVERLAP');
  assert.equal(body.error, 'Séances qui se chevauchent le 13 novembre 2026 à 11:00.');
});

test('rule 30 — a partial overlap is a conflict, back-to-back sessions are not', () => {
  assert.ok(firstSessionConflict([line([
    { date: DAY, start: '17:00', end: '19:00' },
    { date: DAY, start: '18:00', end: '19:00' },
  ])], one));
  assert.equal(firstSessionConflict([line([
    { date: DAY, start: '17:00', end: '18:00' },
    { date: DAY, start: '18:00', end: '19:00' },
    { date: NEXT_DAY, start: '17:00', end: '18:00' },
  ])], one), null);
});

test('rule 30 — a resource that exists twice takes two sessions at once, not three', () => {
  const two = () => 2;
  const same = { date: DAY, start: '11:00', end: '12:00' };
  assert.equal(firstSessionConflict([line([same, same])], two), null);
  assert.ok(firstSessionConflict([line([same, same, same])], two));
});

test('rule 30 — lines without sessions, or with one, are never a conflict', () => {
  assert.equal(firstSessionConflict([{ resourceId: 1, quantity: 1 }, line([])], one), null);
  assert.equal(firstSessionConflict(undefined, one), null);
});

test('rule 30 — the fiche save is refused with 409 SESSIONS_OVERLAP and writes nothing', () => {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte', 8)").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
  const resourceId = db.prepare("INSERT INTO resources (name, quantity, price) VALUES ('Bain test', 1, 20)").run().lastInsertRowid;
  const before = db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n;

  const body = (sessions) => ({
    propertyId: 1, clientId: 1, startDate: inDays(100), endDate: inDays(103),
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    resources: [{ resourceId, quantity: 1, sessions }],
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  const same = { date: inDays(100), start: '17:00', end: '18:00' };
  controller.create({ body: body([same, same]), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'SESSIONS_OVERLAP');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n, before);

  const ok = { ...res, statusCode: 200, body: null };
  controller.create({ body: body([same, { date: inDays(100), start: '18:00', end: '19:00' }]), user: { role: 'admin' } }, ok);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));

  const updated = controller.performUpdate(ok.body.id, body([same, same]));
  assert.equal(updated.status, 409, JSON.stringify(updated.body));
  assert.equal(updated.body.code, 'SESSIONS_OVERLAP');
});
