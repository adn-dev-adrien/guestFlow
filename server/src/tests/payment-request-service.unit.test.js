// paymentRequestService — the injectable core behind the payment-request HTTP handlers
// (specs/online-payments-qonto.md §3.2/§3.4). All deps stubbed; no Qonto network, no prod DB.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { ensurePaymentLink, sendPaymentRequest } = require('../utils/paymentRequestService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jean', 'Dupont', 'jean@x.fr')").run();
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus)
                           VALUES ('devis', 1, 1, '2026-08-10', '2026-08-12', 2, 300, 90, 210, 'sent')`).run();
  return { db, devisId: Number(info.lastInsertRowid) };
}

// Minimal in-memory payment_links model — just what the service touches.
function fakeLinksModel(db) {
  return {
    findOpenForReservation: (id, type) =>
      db.prepare("SELECT * FROM payment_links WHERE reservationId = ? AND type = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(id, type),
    create: (row) => {
      const info = db.prepare(`INSERT INTO payment_links (reservationId, type, amountCents, qontoPaymentLinkId, url, status, expiresAt)
                               VALUES (@reservationId, @type, @amountCents, @qontoPaymentLinkId, @url, @status, @expiresAt)`).run(row);
      return { id: Number(info.lastInsertRowid), ...row };
    },
    updateStatus: (id, status) => { db.prepare('UPDATE payment_links SET status = ? WHERE id = ?').run(status, id); },
  };
}

function baseDeps(db, over = {}) {
  return {
    database: db,
    paymentLinksModel: fakeLinksModel(db),
    resolveAmountCents: () => 9000, // 90.00 €
    createLink: async ({ amountCents }) => ({ id: 'ql_new', url: 'https://pay.qonto/ql_new', mappedStatus: 'open', expirationDate: null, amountCents }),
    sendTemplate: async () => ({ sent: true, emailLogId: 1, recipientEmail: 'jean@x.fr' }),
    ...over,
  };
}

test('ensurePaymentLink: creates a link via createLink + persists it', async () => {
  const { db, devisId } = seed();
  let createCalls = 0;
  const deps = baseDeps(db, { createLink: async (a) => { createCalls++; return { id: 'ql_1', url: 'https://pay/ql_1', mappedStatus: 'open' }; } });
  const link = await ensurePaymentLink(deps, devisId, 'deposit');
  assert.equal(createCalls, 1);
  assert.equal(link.reused, false);
  assert.equal(link.url, 'https://pay/ql_1');
  assert.equal(link.amountCents, 9000);
  assert.ok(db.prepare('SELECT 1 FROM payment_links WHERE qontoPaymentLinkId = ?').get('ql_1'));
});

test('ensurePaymentLink: reuses an open link without calling createLink', async () => {
  const { db, devisId } = seed();
  fakeLinksModel(db).create({ reservationId: devisId, type: 'deposit', amountCents: 9000, qontoPaymentLinkId: 'ql_open', url: 'https://pay/open', status: 'open', expiresAt: null });
  let createCalls = 0;
  const deps = baseDeps(db, { createLink: async () => { createCalls++; return {}; } });
  const link = await ensurePaymentLink(deps, devisId, 'deposit');
  assert.equal(createCalls, 0, 'no Qonto create on reuse');
  assert.equal(link.reused, true);
  assert.equal(link.url, 'https://pay/open');
});

test('ensurePaymentLink: an open link whose amount drifted is cancelled + a fresh link is minted at the current amount', async () => {
  const { db, devisId } = seed();
  // A stale open link for 90.00 € (e.g. before the devis was edited).
  const stale = fakeLinksModel(db).create({ reservationId: devisId, type: 'full', amountCents: 9000, qontoPaymentLinkId: 'ql_stale', url: 'https://pay/stale', status: 'open', expiresAt: null });
  let createArgs = null;
  const deps = baseDeps(db, { resolveAmountCents: () => 12000, createLink: async (a) => { createArgs = a; return { id: 'ql_fresh', url: 'https://pay/fresh', mappedStatus: 'open' }; } });

  const link = await ensurePaymentLink(deps, devisId, 'full');

  assert.equal(link.reused, false, 'the stale link is not reused');
  assert.equal(createArgs.amountCents, 12000, 'the fresh link bills the current amount');
  assert.equal(link.url, 'https://pay/fresh');
  assert.equal(db.prepare('SELECT status FROM payment_links WHERE id = ?').get(stale.id).status, 'cancelled', 'the stale link is retired');
});

test('ensurePaymentLink: invalid type → 400', async () => {
  const { db, devisId } = seed();
  await assert.rejects(() => ensurePaymentLink(baseDeps(db), devisId, 'bogus'),
    (e) => { assert.equal(e.httpStatus, 400); assert.equal(e.error, 'INVALID_TYPE'); return true; });
});

test('ensurePaymentLink: unknown reservation → 404', async () => {
  const { db } = seed();
  await assert.rejects(() => ensurePaymentLink(baseDeps(db), 99999, 'deposit'),
    (e) => { assert.equal(e.httpStatus, 404); assert.equal(e.error, 'RESERVATION_NOT_FOUND'); return true; });
});

test('ensurePaymentLink: zero amount → 400', async () => {
  const { db, devisId } = seed();
  await assert.rejects(() => ensurePaymentLink(baseDeps(db, { resolveAmountCents: () => 0 }), devisId, 'deposit'),
    (e) => { assert.equal(e.httpStatus, 400); assert.equal(e.error, 'ZERO_AMOUNT'); return true; });
});

test('sendPaymentRequest: happy path → 200 with link + email metadata', async () => {
  const { db, devisId } = seed();
  let sentArgs = null;
  const deps = baseDeps(db, { sendTemplate: async (a) => { sentArgs = a; return { sent: true, emailLogId: 7, recipientEmail: 'jean@x.fr' }; } });
  const { httpStatus, body } = await sendPaymentRequest(deps, devisId, 'deposit');
  assert.equal(httpStatus, 200);
  assert.deepEqual({ sent: body.sent, emailLogId: body.emailLogId, recipientEmail: body.recipientEmail }, { sent: true, emailLogId: 7, recipientEmail: 'jean@x.fr' });
  assert.equal(sentArgs.stableKey, 'deposit_request');
  assert.equal(sentArgs.paymentLink, 'https://pay.qonto/ql_new');
});

test('sendPaymentRequest: unsupported type → 400 INVALID_TYPE (no link created)', async () => {
  const { db, devisId } = seed();
  let createCalls = 0;
  const deps = baseDeps(db, { createLink: async () => { createCalls++; return {}; } });
  const { httpStatus, body } = await sendPaymentRequest(deps, devisId, 'balance'); // no balance_request template yet
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'INVALID_TYPE');
  assert.equal(createCalls, 0);
});

test('sendPaymentRequest: no client email → 400 EMAIL_NOT_SENT, link still returned', async () => {
  const { db, devisId } = seed();
  const deps = baseDeps(db, { sendTemplate: async () => ({ sent: false, reason: 'no-email' }) });
  const { httpStatus, body } = await sendPaymentRequest(deps, devisId, 'deposit');
  assert.equal(httpStatus, 400);
  assert.equal(body.error, 'EMAIL_NOT_SENT');
  assert.equal(body.reason, 'no-email');
  assert.equal(body.url, 'https://pay.qonto/ql_new');
});

test('sendPaymentRequest: unknown send failure → 502', async () => {
  const { db, devisId } = seed();
  const deps = baseDeps(db, { sendTemplate: async () => ({ sent: false, reason: 'smtp exploded' }) });
  const { httpStatus, body } = await sendPaymentRequest(deps, devisId, 'deposit');
  assert.equal(httpStatus, 502);
  assert.equal(body.reason, 'smtp exploded');
});

test('sendPaymentRequest: a validation throw from ensurePaymentLink bubbles (zero amount)', async () => {
  const { db, devisId } = seed();
  await assert.rejects(() => sendPaymentRequest(baseDeps(db, { resolveAmountCents: () => 0 }), devisId, 'deposit'),
    (e) => { assert.equal(e.httpStatus, 400); return true; });
});
