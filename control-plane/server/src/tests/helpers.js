/**
 * Test fixtures for the console: an in-memory database, a temporary instances root, a throwaway
 * Ed25519 key pair, a clock the test moves, a mailer that records, a fake first-admin runner, and
 * (C2b) a fake Qonto facade whose invoices and links the test pays or fails.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../database');
const { createContext } = require('../context');
const { createSecrets } = require('../utils/secrets');

function makeClock(iso) {
  let current = new Date(iso);
  const now = () => new Date(current);
  now.set = (next) => { current = new Date(next); };
  return now;
}

function makeMailer() {
  const sent = [];
  return { sent, async send(msg) { sent.push(msg); } };
}

// A minimal GuestFlow instance directory: data/guestflow.db with a `plugins` table and a couple of
// tables the export reads.
function makeInstance(root, slug, { installed = [] } = {}) {
  const dataDir = path.join(root, slug, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'guestflow.db'));
  db.exec(`CREATE TABLE plugins (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, source TEXT);
    CREATE TABLE reservations (id INTEGER PRIMARY KEY, guest TEXT, total REAL);
    CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
    INSERT INTO reservations (guest, total) VALUES ('Martin, "Jo"', 420.5);
    INSERT INTO clients (name, email) VALUES ('Jo Martin', 'jo@example.fr');`);
  const insert = db.prepare('INSERT INTO plugins (id, enabled, source) VALUES (?, 1, ?)');
  for (const id of installed) insert.run(id, 'builtin');
  db.close();
  return dataDir;
}

// The facade of utils/qontoBilling.js, in memory. `state.failNext = { step, error }` makes one call
// throw; `pay(link)` / `fail(link, status)` / `payInvoice(id)` are what the customer or the bank does.
function makeFakeQonto({ ready = true } = {}) {
  const calls = [];
  let seq = 0;
  const state = { ready, failNext: null, invoices: {}, links: {}, iban: 'FR7630001007941234567890185' };
  const maybeFail = (step) => {
    if (state.failNext && state.failNext.step === step) {
      const { error } = state.failNext;
      state.failNext = null;
      throw error;
    }
  };
  const record = (name, args) => { calls.push({ name, args }); maybeFail(name); };
  return {
    calls,
    state,
    named: (name) => calls.filter((c) => c.name === name),
    pay: (linkId, paidAt = '2026-10-26T09:00:00Z') => { state.links[linkId].paid = true; state.links[linkId].paidAt = paidAt; },
    fail: (linkId, id, status = 'failed') => { state.links[linkId].failures.push({ id, status }); },
    payInvoice: (id) => { state.invoices[id].status = 'paid'; state.invoices[id].paidAt = '2026-10-26T09:00:00Z'; },
    ready: () => state.ready,
    async iban() { record('iban'); return state.iban; },
    async createClient(args) { record('createClient', args); seq += 1; return { id: `cl_${seq}` }; },
    async createInvoice(args) {
      record('createInvoice', args);
      seq += 1;
      const id = `inv_${seq}`;
      state.invoices[id] = { status: 'unpaid', paidAt: null };
      const totalCents = args.items.reduce((sum, it) => sum + it.amountCents + Math.round((it.amountCents * it.vatRate) / 100), 0);
      return { id, number: `F-2026-${String(seq).padStart(4, '0')}`, invoiceUrl: `https://pay.test/invoices/${id}`, status: 'unpaid', totalCents };
    },
    async createLink(args) {
      record('createLink', args);
      seq += 1;
      const id = `pl_${seq}`;
      state.links[id] = { paid: false, paidAt: null, failures: [] };
      return { id, url: `https://pay.test/links/${id}` };
    },
    async readInvoice(id) { record('readInvoice', id); return { ...state.invoices[id] }; },
    async linkPayments(id) { record('linkPayments', id); const l = state.links[id]; return { paid: l.paid, paidAt: l.paidAt, failures: [...l.failures] }; },
    async cancelInvoice(id) { record('cancelInvoice', id); state.invoices[id].status = 'canceled'; return {}; },
    async deactivateLink(id) { record('deactivateLink', id); return {}; },
  };
}

// The payload of a signed licence, as the instance would read it.
function licencePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function makeContext({ at = '2026-09-29T10:00:00Z', firstAdmin, qonto } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-instances-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-data-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const now = makeClock(at);
  const mailer = makeMailer();
  const firstAdminCalls = [];
  const ctx = createContext({
    db: openDatabase(':memory:'),
    now,
    mailer,
    secrets: createSecrets(crypto.randomBytes(32)),
    privateKey,
    instancesRoot: root,
    dataDir,
    domain: 'guestflow.test',
    consoleUrl: 'https://console.guestflow.test',
    qonto,
    runFirstAdmin: async (args) => {
      firstAdminCalls.push(args);
      return firstAdmin ? firstAdmin(args) : { created: true, temporaryPassword: 'Tmp-Passw0rd' };
    },
  });
  return { ctx, root, dataDir, now, mailer, publicKey, firstAdminCalls, cleanup() {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  } };
}

const NEW_CUSTOMER = {
  companyName: 'Gîte des Aulnes',
  contactName: 'Claire Martin',
  contactEmail: 'claire@aulnes.fr',
  slug: 'aulnes',
  planCode: 'pro',
  billing: 'yearly',
  length: 12,
  startsAt: '2026-10-01',
  trial: false,
  addons: [],
  billingStreet: '4 route des Aulnes',
  billingPostcode: '07140',
  billingCity: 'Les Vans',
  billingCountry: 'FR',
};

module.exports = { makeClock, makeMailer, makeInstance, makeContext, makeFakeQonto, licencePayload, NEW_CUSTOMER };
