// Spec review of 2026-10-27 (agent 3, item 8) — `ensurePaymentLink` had no guard against an échéance
// already collected: a link could be minted for a paid acompte or solde and charge the guest twice. The
// service now refuses with 409 ALREADY_PAID before any provider call (specs/online-payments-qonto.md).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { ensurePaymentLink } = require('../utils/paymentRequestService');

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
      const info = db.prepare(`INSERT INTO payment_links (reservationId, type, amountCents, provider, providerLinkId, url, status, expiresAt)
                               VALUES (@reservationId, @type, @amountCents, @provider, @providerLinkId, @url, @status, @expiresAt)`).run({ provider: 'qonto', ...row });
      return { id: Number(info.lastInsertRowid), ...row };
    },
    updateStatus: (id, status) => {
      db.prepare('UPDATE payment_links SET status = ? WHERE id = ?').run(status, id);
      return db.prepare('SELECT * FROM payment_links WHERE id = ?').get(id);
    },
  };
}

// `createLink` keeps the Qonto client's answer shape; the provider stub adapts it the way
// plugins/online-payment/provider.js does (specs/plugins-phase-3a-online-payment.md rule 4).
function baseDeps(db, over = {}) {
  const deps = {
    database: db,
    paymentLinksModel: fakeLinksModel(db),
    resolveAmountCents: () => 9000, // 90.00 €
    createLink: async ({ amountCents }) => ({ id: 'ql_new', url: 'https://pay.qonto/ql_new', mappedStatus: 'open', expirationDate: null, amountCents }),
    sendTemplate: async () => ({ sent: true, emailLogId: 1, recipientEmail: 'jean@x.fr' }),
    deactivateLinks: async () => ({ notDeactivated: 0 }),
    ...over,
  };
  deps.provider = {
    id: 'qonto',
    createLink: async (args) => {
      const link = await deps.createLink(args);
      return { id: link.id, url: link.url, status: link.mappedStatus, expiresAt: link.expirationDate || null };
    },
  };
  return deps;
}


for (const [type, paid] of [['deposit', 'depositPaid'], ['balance', 'balancePaid'], ['full', 'depositPaid'], ['full', 'balancePaid']]) {
  test(`a ${type} link is refused once ${paid} is set — no provider call, no row`, async () => {
    const { db, devisId } = seed();
    db.prepare(`UPDATE reservations SET kind = 'reservation', ${paid} = 1 WHERE id = ?`).run(devisId);
    let createCalls = 0;
    const deps = baseDeps(db, { createLink: async () => { createCalls++; return { id: 'x', url: 'u', mappedStatus: 'open' }; } });
    await assert.rejects(ensurePaymentLink(deps, devisId, type), (err) => err.httpStatus === 409 && err.error === 'ALREADY_PAID');
    assert.equal(createCalls, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payment_links').get().n, 0);
  });
}

test('the solde link of a stay whose acompte only is paid is still minted', async () => {
  const { db, devisId } = seed();
  db.prepare("UPDATE reservations SET kind = 'reservation', depositPaid = 1 WHERE id = ?").run(devisId);
  const link = await ensurePaymentLink(baseDeps(db), devisId, 'balance');
  assert.equal(link.reused, false);
});
