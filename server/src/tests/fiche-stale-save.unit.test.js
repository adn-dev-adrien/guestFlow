// specs/reservation-fiche-concurrency.md rules 1-3 — the fiche save is refused (409 STALE_FICHE) when the
// stored stay changed since the version the form was built on, instead of rewriting every column from a
// stale form and erasing what a plugin, the iCal sync or another tab wrote meanwhile (audit 2026-10-28).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const Database = require('better-sqlite3');

const reservationsModel = require('../models/reservationsModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function setup() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, platform, sourceType, updatedAt)
    VALUES ('reservation', 1, 1, '2099-06-01', '2099-06-04', 2, 'Airbnb', 'ical', '2099-01-01 10:00:00')`).run().lastInsertRowid);
  const model = reservationsModel.create(db);
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(request) {
    if (request === '../models/reservationsModel') return model;
    if (request === '../plugins/sdk/eventBus') return { emit() {} };
    return origRequire.call(this, request);
  };
  let controller;
  try {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    controller = require('../controllers/reservationsController');
  } finally {
    Module.prototype.require = origRequire;
  }
  return { db, id, model, controller };
}

const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

test('rule 1 — a stale version is refused with STALE_FICHE and writes nothing', async () => {
  const { db, id, controller } = setup();
  db.prepare("UPDATE reservations SET adults = 3, updatedAt = '2099-01-01 10:05:00' WHERE id = ?").run(id);
  const res = fakeRes();
  await controller.update({ params: { id: String(id) }, query: {}, body: { loadedUpdatedAt: '2099-01-01 10:00:00', adults: 8 }, user: { roles: ['admin'] } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'STALE_FICHE');
  assert.match(res.body.error, /modifiée entre-temps/);
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = ?').get(id).adults, 3, 'the background write survives');
});

test('rule 2 — the version the form was built on, or none, is not refused here', () => {
  const { id, controller } = setup();
  const { staleFicheRefusal } = controller.__test;
  assert.equal(staleFicheRefusal(id, { loadedUpdatedAt: '2099-01-01 10:00:00' }), null);
  assert.equal(staleFicheRefusal(id, {}), null);
  assert.equal(staleFicheRefusal(id, { loadedUpdatedAt: '' }), null);
  assert.equal(staleFicheRefusal(id, null), null);
  assert.equal(staleFicheRefusal(9999, { loadedUpdatedAt: 'x' }), null, 'an unknown stay is the save\'s own 404');
});

test('rule 3 — the read the fiche loads carries the version', () => {
  const { id, model } = setup();
  assert.equal(model.getByIdWithDetails(id).updatedAt, '2099-01-01 10:00:00');
});
