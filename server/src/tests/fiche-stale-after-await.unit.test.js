// specs/reservation-fiche-concurrency.md rule 7 (audit R2 F) — the stale check is repeated right before the
// write, after the payment-provider await, so a foreign write landing during that await is not overwritten.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const fakeRes = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

test('rule 7 — a foreign write landing during the provider await refuses the save', async () => {
  const db = require('../database');
  const ledgerLinks = require('../utils/ledgerLinks');
  db.prepare("INSERT OR IGNORE INTO properties (id, name, maxGuests) VALUES (1, 'Gite', 6)").run();
  db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, platform, sourceType, updatedAt)
    VALUES ('reservation', 1, 1, '2099-06-01', '2099-06-04', 2, 'Airbnb', 'ical', '2099-01-01 10:00:00')`).run().lastInsertRowid);

  const realLinks = require('../models/paymentLinksModel');
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(request) {
    if (request === '../models/paymentLinksModel') return { ...realLinks, listForReservation: () => [{ id: 1, status: 'open', amountCents: 100 }] };
    return origRequire.call(this, request);
  };
  const origFind = ledgerLinks.findPaidStaleLink;
  try {
    const controller = require('../controllers/reservationsController');
    ledgerLinks.findPaidStaleLink = async () => {
      db.prepare("UPDATE reservations SET adults = 3, updatedAt = '2099-01-01 10:05:00' WHERE id = ?").run(id);
      return null;
    };
    const res = fakeRes();
    await controller.update({
      params: { id: String(id) }, query: {}, user: { roles: ['admin'] },
      body: { loadedUpdatedAt: '2099-01-01 10:00:00', adults: 5, startDate: '2099-06-01', endDate: '2099-06-04', propertyId: 1, clientId: 1 },
    }, res);
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, 'STALE_FICHE');
    assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = ?').get(id).adults, 3, 'the foreign write survives');
  } finally {
    ledgerLinks.findPaidStaleLink = origFind;
    Module.prototype.require = origRequire;
  }
});
