// specs/deposit-blocks-the-dates.md §3.3 — the SERVER decides what a payment request asks for. A devis
// carrying an acompte gets the acompte email; a last-minute one, which has none, gets the full-payment
// email instead of a 0 € link the API would refuse.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { sendPaymentRequest, resolveRequestType, REQUEST_TEMPLATES } = require('../utils/paymentRequestService');
const { DEFAULT_TEMPLATES, EVENT_TRIGGERED_STABLE_KEYS, PAYMENT_STABLE_KEYS } = require('../utils/defaultEmailTemplatesRegistry');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed({ depositAmount, balanceAmount }) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus)
                           VALUES ('devis', 1, 1, '2026-08-10', '2026-08-12', 2, 300, ?, ?, 'sent')`).run(depositAmount, balanceAmount);
  return { db, devisId: Number(info.lastInsertRowid) };
}

function deps(db, sent, amountCents = 30000) {
  return {
    database: db,
    paymentLinksModel: {
      findOpenForReservation: () => null,
      create: (row) => ({ id: 1, ...row }),
      updateStatus: () => {},
    },
    resolveAmountCents: () => amountCents,
    createLink: async () => ({ id: 'ql_1', url: 'https://pay.qonto/ql_1', mappedStatus: 'open', expirationDate: null }),
    sendTemplate: async (args) => { sent.push(args); return { sent: true, emailLogId: 1, recipientEmail: 'jean@x.fr' }; },
  };
}

// ── The pure resolver ────────────────────────────────────────────────────────

test('with an acompte to collect, a request asks for the acompte', () => {
  assert.equal(resolveRequestType({ depositAmount: 90 }), 'deposit');
});

test('with no acompte, it asks for the whole stay', () => {
  assert.equal(resolveRequestType({ depositAmount: 0 }), 'full');
  assert.equal(resolveRequestType({ depositAmount: null }), 'full');
  assert.equal(resolveRequestType({}), 'full');
});

test('an explicit type wins — the balance flow is unaffected', () => {
  assert.equal(resolveRequestType({ depositAmount: 90 }, 'balance'), 'balance');
  assert.equal(resolveRequestType({ depositAmount: 0 }, 'deposit'), 'deposit');
});

test('an explicit type nobody supports is refused, not silently swapped', () => {
  assert.equal(resolveRequestType({ depositAmount: 90 }, 'tip'), null);
});

// ── End to end through the service ───────────────────────────────────────────

test('a devis with an acompte: the acompte email, as before', async () => {
  const { db, devisId } = seed({ depositAmount: 90, balanceAmount: 210 });
  const sent = [];
  const { httpStatus, body } = await sendPaymentRequest(deps(db, sent), devisId);
  assert.equal(httpStatus, 200);
  assert.equal(body.type, 'deposit');
  assert.equal(sent[0].stableKey, 'deposit_request');
  db.close();
});

test('a last-minute devis: the full-payment email, not a 0 € acompte link', async () => {
  const { db, devisId } = seed({ depositAmount: 0, balanceAmount: 300 });
  const sent = [];
  const { httpStatus, body } = await sendPaymentRequest(deps(db, sent), devisId);
  assert.equal(httpStatus, 200);
  assert.equal(body.type, 'full', 'the response names what was sent, so the UI can too');
  assert.equal(sent[0].stableKey, 'full_request');
  db.close();
});

test('the email is handed the amount the link actually charges', async () => {
  const { db, devisId } = seed({ depositAmount: 0, balanceAmount: 300 });
  const sent = [];
  await sendPaymentRequest(deps(db, sent, 43600), devisId); // 436,00 € — stay + tourist tax
  assert.equal(sent[0].amountCents, 43600, 'so {{paymentAmount}} can never contradict the Qonto page');
  db.close();
});

test('an unknown record → 404, no link, no email', async () => {
  const { db } = seed({ depositAmount: 90, balanceAmount: 210 });
  const sent = [];
  const { httpStatus, body } = await sendPaymentRequest(deps(db, sent), 999);
  assert.equal(httpStatus, 404);
  assert.equal(body.error, 'RESERVATION_NOT_FOUND');
  assert.equal(sent.length, 0);
  db.close();
});

// ── The template it needs ────────────────────────────────────────────────────

test('full_request is a real, bilingual, manual-only template', () => {
  assert.equal(REQUEST_TEMPLATES.full, 'full_request');
  const t = DEFAULT_TEMPLATES.find((x) => x.stableKey === 'full_request');
  assert.ok(t, 'the registry must ship it, or the send would 500 on a missing template');
  assert.equal(t.sendMode, 'manual', 'a request for money is never sent by a cron');
  for (const field of ['subject', 'body', 'subjectEn', 'bodyEn']) {
    assert.ok(String(t[field] || '').trim(), `full_request.${field} must be filled`);
  }
  assert.match(t.body, /\{\{paymentAmount\}\}/, 'it must announce the amount the link charges');
  assert.match(t.body, /\{\{paymentLink\}\}/);
  assert.match(t.body, /bloque vos dates/, 'same promise as the acompte email');
  assert.ok(EVENT_TRIGGERED_STABLE_KEYS.includes('full_request'), 'action-triggered: never in the date-driven queue');
  assert.ok(PAYMENT_STABLE_KEYS.includes('full_request'), 'guarded by the no-auto-dunning rule');
});
