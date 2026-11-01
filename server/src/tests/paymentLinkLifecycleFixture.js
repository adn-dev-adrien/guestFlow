// Shared fixture of the specs/payment-link-lifecycle.md suites: an in-memory database on the baseline
// schema, a stay, and a fake payment provider that records every call. Nothing leaves the process.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

function seedDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Test', 'Client', 'client@example.test')").run();
  return { db, links: paymentLinksModel.buildModel(db), devis: devisModel.buildModel(db) };
}

function addStay(db, { kind = 'reservation', startDate = '2027-07-10', endDate = '2027-07-14', depositAmount = 90, balanceAmount = 210, convertedReservationId = null } = {}) {
  const info = db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, convertedReservationId)
                           VALUES (?, 1, 1, ?, ?, 2, ?, ?, ?, ?)`).run(kind, startDate, endDate, depositAmount + balanceAmount, depositAmount, balanceAmount, convertedReservationId);
  return Number(info.lastInsertRowid);
}

// `createdAt` as SQLite writes it (UTC, no zone).
const sqliteAt = (date) => date.toISOString().replace('T', ' ').slice(0, 19);

let seq = 0;
function addLink(links, db, reservationId, { type = 'deposit', amountCents = 9000, createdAt = null, expiresAt = null, providerLinkId, status = 'open', installmentId = null } = {}) {
  seq += 1;
  const row = links.create({
    reservationId, type, amountCents, provider: 'qonto', providerLinkId: providerLinkId === undefined ? `pl_${seq}` : providerLinkId,
    url: `https://pay.example.test/${seq}`, status, installmentId,
    ...(createdAt ? { createdAt: sqliteAt(createdAt) } : {}), ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
  });
  return links.findById(row.id);
}

/**
 * A provider stub: `paid` (bool or (linkId, origin) → bool), `failCancel` (an Error to throw from cancelLink),
 * `failPayment` (an Error to throw from getPayment), `linkStatus` (what getLinkStatus answers).
 */
function fakeProvider({ paid = false, pending = false, paidAt = '2026-10-29T09:15:00Z', failCancel = null, failPayment = null, linkStatus = 'open' } = {}) {
  const calls = [];
  const isPaid = typeof paid === 'function' ? paid : () => paid;
  return {
    calls,
    id: 'qonto',
    label: 'Qonto',
    isReady: () => true,
    createLink: async ({ amountCents }) => {
      calls.push(['createLink', amountCents]);
      seq += 1;
      // What Qonto answers in production: its zero-time sentinel, never a real expiry.
      return { id: `pl_new_${seq}`, url: `https://pay.example.test/new/${seq}`, status: 'open', expiresAt: '0001-01-01T00:00:00Z' };
    },
    getPayment: async (linkId, opts) => {
      calls.push(['getPayment', linkId, opts && opts.origin]);
      if (failPayment) throw failPayment;
      if (isPaid(linkId, opts && opts.origin)) return { paid: true, paymentId: `pay_${linkId}`, paidAt };
      return { paid: false, ...((typeof pending === 'function' ? pending(linkId, opts && opts.origin) : pending) ? { pending: true } : {}) };
    },
    getLinkStatus: async (linkId) => { calls.push(['getLinkStatus', linkId]); return linkStatus; },
    cancelLink: async (linkId) => {
      calls.push(['cancelLink', linkId]);
      if (failCancel) throw failCancel;
    },
  };
}

const rateLimited = () => Object.assign(new Error('429 Too Many Requests'), { code: 'RATE_LIMITED' });

function spies() {
  const notified = [];
  const confirmed = [];
  const stuck = [];
  return {
    notified,
    confirmed,
    stuck,
    notifyPaidAfterCancel: async (l, o) => { notified.push([l.id, o]); },
    sendConfirmation: async (id) => { confirmed.push(id); },
    notifyDeactivationStuck: async (l, o) => { stuck.push([l.id, o]); },
    emitPluginEvent: () => {},
  };
}

module.exports = { seedDb, addStay, addLink, fakeProvider, rateLimited, spies, sqliteAt, HOUR, MINUTE };
