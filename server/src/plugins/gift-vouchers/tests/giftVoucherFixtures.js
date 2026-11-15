// Shared fixtures for the gift-vouchers suites (specs/gift-vouchers.md). Not a test file: an in-memory database with the
// plugin's tables, the plugin's real routers on an ephemeral port, and a clock the test moves.

const express = require('express');
const Database = require('better-sqlite3');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const sdk = require('../../sdk');
const { applyPluginSchema } = require('../../sdk/testing');
const { buildGiftVouchersApi, memorySettings } = require('..');

const encryption = sdk.coreModule('encryption');

const PEPPER = 'test-pepper';
const POW_SECRET = 'test-pow-secret';
const METHODS = ['card', 'cash', 'cheque', 'transfer', 'holidayVoucher', 'other'];

function freshDb() {
  const db = new Database(':memory:');
  applyPluginSchema(db, 'gift-vouchers');
  return db;
}

/** A visitor behind the proxy: the address the stand-in `visitorContext` reads from `x-test-ip`. */
const visitorGuard = (req, res, next) => {
  req.visitor = { ip: req.get('x-test-ip') || '', userAgent: '', pluginVersion: '' };
  next();
};

/** The plugin's API on `db`, with a movable clock. `over` replaces any dependency. */
function buildApi(db = freshDb(), over = {}) {
  const clock = { at: new Date('2026-11-15T10:00:00Z') };
  const sent = [];
  const trips = [];
  const settingsStore = memorySettings(over.settings);
  const api = buildGiftVouchersApi({
    db,
    pepper: () => PEPPER,
    encrypt: encryption.encrypt,
    decrypt: encryption.safeDecrypt,
    settingsStore: () => settingsStore,
    now: () => clock.at,
    quote: () => null,
    pow: sdk.proofOfWork,
    powSecret: () => POW_SECRET,
    guard: visitorGuard,
    sendMail: async (mail) => { if (over.mailFails) throw new Error('SMTP down'); sent.push(mail); return { messageId: 'm1' }; },
    paymentMethods: () => METHODS,
    companyName: () => 'Domaine Solio',
    pageUrl: () => 'https://site.example.test/bon-cadeau',
    bookingUrl: () => 'https://site.example.test/reserver',
    onCheckLimitsTrip: (event) => trips.push(event),
    ...over.deps,
  });
  return {
    api, db, clock, sent, trips, settingsStore,
  };
}

async function start(fixture, { user = { id: 7, roles: ['admin'] } } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/public/v1/gift-vouchers', fixture.api.publicRouter);
  app.use('/api/gift-vouchers', (req, res, next) => { req.user = user; next(); }, fixture.api.adminRouter);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const type = res.headers.get('content-type') || '';
    return {
      status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()),
    };
  };
  return { base, call, close: () => new Promise((resolve) => { server.close(resolve); }) };
}

/** A manual voucher through the admin API → the detail the API answers (with `id`). */
async function issueManual(server, body = {}) {
  const res = await server.call('POST', '/api/gift-vouchers', {
    amountCents: 15000, recipientName: 'Marie', senderName: 'Paul', message: 'Joyeux anniversaire', paymentMethod: 'transfer', ...body,
  });
  if (res.status !== 201) throw new Error(`manual issue refused: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** The clear code of a voucher, read back the way the operator does (« Afficher le code »), as 16 characters. */
async function revealedCode(server, id) {
  const res = await server.call('POST', `/api/gift-vouchers/${id}/reveal`, {});
  return res.body.code.replace(/-/g, '');
}

/** A solved proof-of-work, as the site's drawer sends it: fetched 5 s ago, base difficulty. */
function solvedProof({ difficulty = 12, ip = '' } = {}) {
  const pow = sdk.proofOfWork;
  const challenge = pow.issue({
    secret: POW_SECRET, ipKey: pow.ipKeyOf(ip), difficulty, now: Date.now() - 5000,
  });
  return { challenge, nonce: pow.solve(challenge) };
}

module.exports = {
  freshDb, buildApi, start, issueManual, revealedCode, solvedProof, PEPPER, METHODS, sdk,
};
