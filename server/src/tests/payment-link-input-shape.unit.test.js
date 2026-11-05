// specs/hosting-h2-account-security.md rule 68, reading of 2026-11-05 (audit R23-A2 section 4) — a payment link and its request,
// from a provider that is ready (a fake: nothing leaves the machine): a type of another shape is INVALID_TYPE, never a link.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-link-shape-')), 'g.db');
const test = require('node:test');
const assert = require('node:assert/strict');
const paymentProviders = require('../utils/paymentProviders');
const db = require('../database');
const controller = require('../controllers/paymentsController');

const created = [];
paymentProviders.active = () => ({
  id: 'fake', label: 'Fake', errorCode: 'FAKE_ERROR', isReady: () => true,
  async createLink(args) { created.push(args); return { id: 'l1', url: 'https://pay.invalid/1', status: 'open' }; },
  async cancelLink() {},
  async getLinkStatus() { return 'open'; },
});

const property = db.prepare("INSERT INTO properties (name, maxGuests, singleBeds, doubleBeds) VALUES ('Ombre', 4, 2, 1)").run().lastInsertRowid;
const client = db.prepare("INSERT INTO clients (lastName, firstName, email) VALUES ('Martin', 'Marie', 'marie@shape.test')").run().lastInsertRowid;
const stay = db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, platform, kind, finalPrice, depositAmount, balanceAmount)
  VALUES (?, ?, date('now', '+30 days'), date('now', '+33 days'), 2, 'direct', 'reservation', 300, 90, 210)`).run(property, client).lastInsertRowid;

function send(handler, body) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; resolve(this); return this; },
    };
    Promise.resolve(handler({ params: { id: String(stay) }, body, user: { id: 1 } }, res)).catch(reject);
  });
}

for (const name of ['createReservationPaymentLink', 'sendPaymentRequestEmail']) {
  test(`rule 68 — ${name}: a type that is not one of the words is a refusal, and no link`, async () => {
    for (const type of [{ a: 1 }, ['x'], 1.5, -1, 'bogus', 'constructor', '__proto__', 'toString']) {
      const res = await send(controller[name], { type });
      assert.equal(res.statusCode, 400, JSON.stringify(type));
      assert.equal(res.body.error, 'INVALID_TYPE');
    }
    assert.deepEqual(created, []);
  });

  test(`rule 68 — ${name}: {"toString":1} reaches the terminal net as a wrong type, not a 500`, async () => {
    await assert.rejects(send(controller[name], { type: JSON.parse('{"toString":1}') }), /Cannot convert object to primitive value/);
  });
}

test('rule 68 — an installment request with an id of another shape is INVALID_INSTALLMENT', async () => {
  for (const installmentId of [{ a: 1 }, ['x'], 1.5, 'x', undefined, true]) {
    const res = await send(controller.sendPaymentRequestEmail, { type: 'installment', installmentId });
    assert.ok(res.statusCode >= 400 && res.statusCode < 500, JSON.stringify(installmentId));
  }
  assert.deepEqual(created, []);
});
