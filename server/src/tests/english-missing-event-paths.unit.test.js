// specs/email-language-fr-en.md rule 12 (adversarial review of the 2026-10-27 fixes) — the event paths
// of rule 9. A payment request minted the provider link and only then failed with 502 « Envoi du mail
// impossible : ENGLISH_VERSION_MISSING »; it is now refused 422 with a French message before any link.
// A cancellation whose notice could not leave answered `emailSent: false` that no screen read; it now
// carries `emailWarning`, worded by the server.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-en-missing-')), 'guestflow.db');

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { sendPaymentRequest, sendInstallmentRequest } = require('../utils/paymentRequestService');
const { __test } = require('../controllers/paymentsController');
const { cancel } = require('../controllers/reservationCancellationController');

const PAYMENT_MESSAGE = 'Version anglaise manquante pour ce modèle : la rédiger dans Emails › Modèles, ou passer la langue de la fiche en français.';

db.prepare("INSERT INTO properties (name) VALUES ('La Granja')").run();
const propertyId = db.prepare('SELECT MAX(id) AS id FROM properties').get().id;

function seedStay(lang) {
  const client = db.prepare('INSERT INTO clients (firstName, lastName, email, emailLanguage) VALUES (?, ?, ?, ?)').run('Ann', 'Lee', 'ann@x.test', lang);
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount)
                           VALUES ('reservation', ?, ?, '2027-08-10', '2027-08-12', 2, 600, 180, 420)`).run(propertyId, client.lastInsertRowid);
  return Number(info.lastInsertRowid);
}
const dropEnglish = (stableKey) => db.prepare("UPDATE email_templates SET bodyEn = '', subjectEn = '' WHERE stableKey = ?").run(stableKey);

function stubDeps(over = {}) {
  const minted = [];
  return {
    minted,
    deps: {
      database: db,
      resolveAmountCents: () => 42000,
      paymentLinksModel: { findOpenForReservation: () => null, create: (row) => ({ id: 1, ...row }) },
      provider: { id: 'stub', createLink: async () => { minted.push(1); return { id: 'l1', url: 'https://pay.example/l1', status: 'open' }; } },
      installmentsModel: { findById: () => ({ id: 7, amountCents: 1000, paid: 0 }), listFor: () => [] },
      sendTemplate: async () => ({ sent: false, reason: 'ENGLISH_VERSION_MISSING' }),
      ...over,
    },
  };
}

test('a payment request without its English version is refused 422 before any link is minted', async () => {
  const id = seedStay('en');
  const { deps, minted } = stubDeps({ englishMissing: () => true });
  const out = await sendPaymentRequest(deps, id, 'balance');
  assert.equal(out.httpStatus, 422);
  assert.equal(out.body.error, 'ENGLISH_VERSION_MISSING');
  assert.equal(out.body.message, PAYMENT_MESSAGE);
  assert.equal(minted.length, 0, 'no provider link');
});

test('an installment request is refused the same way, before its link', async () => {
  const id = seedStay('en');
  const { deps, minted } = stubDeps({ englishMissing: () => true });
  const out = await sendInstallmentRequest(deps, id, 7);
  assert.equal(out.httpStatus, 422);
  assert.equal(out.body.message, PAYMENT_MESSAGE);
  assert.equal(minted.length, 0);
});

test('the controller resolves the guest language and the template like the sender', () => {
  dropEnglish('full_request');
  const deps = __test.requestServiceDeps(null);
  assert.equal(deps.englishMissing({ reservationId: seedStay('en'), stableKey: 'full_request' }), true);
  assert.equal(deps.englishMissing({ reservationId: seedStay('fr'), stableKey: 'full_request' }), false);
  assert.equal(deps.englishMissing({ reservationId: seedStay('en'), stableKey: 'deposit_request' }), false, 'shipped English version');
});

function call(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; resolve(this); return this; },
    };
    Promise.resolve(handler(req, res));
  });
}

test('a cancellation whose notice could not leave tells the operator why', async () => {
  dropEnglish('cancellation_notice');
  db.prepare('UPDATE email_templates SET enabled = 1 WHERE stableKey = ?').run('cancellation_notice');
  const id = seedStay('en');
  const res = await call(cancel, { params: { id: String(id) }, body: { reason: 'test', notifyClient: true }, user: { id: 1 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.emailSent, false);
  assert.equal(res.body.emailWarning, 'Mail d’annulation non envoyé : version anglaise manquante.');
});

test('a cancellation without a notice asked for carries no warning', async () => {
  const id = seedStay('en');
  const res = await call(cancel, { params: { id: String(id) }, body: { reason: 'test', notifyClient: false }, user: { id: 1 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.emailWarning, null);
});

