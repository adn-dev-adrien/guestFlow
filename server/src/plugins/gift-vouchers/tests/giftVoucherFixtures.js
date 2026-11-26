// Shared fixtures for the gift-vouchers suites (specs/gift-vouchers/gift-vouchers.md). Not a test file: an in-memory database with the
// plugin's tables, the plugin's real routers on an ephemeral port, and a clock the test moves.

const express = require('express');
const Database = require('better-sqlite3');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');

const sdk = require('../../sdk');
const { applyPluginSchema } = require('../../sdk/testing');
const { filesDir } = require('./visualFilesFixture');
const { buildGiftVouchersApi, memorySettings } = require('..');

const encryption = sdk.coreModule('encryption');

const PEPPER = 'test-pepper';
const POW_SECRET = 'test-pow-secret';
const METHODS = [
  { value: 'card', label: 'CB' }, { value: 'cash', label: 'Espèces' }, { value: 'cheque', label: 'Chèque' },
  { value: 'transfer', label: 'Virement' }, { value: 'holidayVoucher', label: 'Chèques-vacances' }, { value: 'other', label: 'Autre' },
];

// What a printed card says of the company: the settings' reading, stated by the suite.
const COMPANY = async () => ({
  name: 'Domaine Solio', town: 'Saint-Cirq-Lapopie', website: 'https://site.example.test', logo: null,
});

function freshDb() {
  const db = new Database(':memory:');
  applyPluginSchema(db, 'gift-vouchers');
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, email TEXT)");
  db.prepare('INSERT INTO users (id, firstName, lastName, email) VALUES (7, ?, ?, ?)').run('Adrien', 'Test', 'adrien@example.test');
  return db;
}

// The bounds, validity, VAT rate and ideas of the lodging voucher are the `lodging` campaign's (specs/gift-vouchers/gift-voucher-campaigns.md rule 3): a suite that states them as
// the settings they used to be reads them as that campaign's values.
const LODGING_FIELDS = Object.freeze(['validityMonths', 'minAmountCents', 'maxAmountCents', 'vatRatePercent', 'ideas']);

/** Changes the lodging campaign of `api` (the one the migration made): `{ validityMonths, minAmountCents, maxAmountCents, vatRatePercent, ideas }` as numbers or as the text a form sent. */
function setLodging(api, values) {
  const current = api.campaigns.firstLodging();
  const next = { ...current };
  Object.entries(values).forEach(([key, value]) => {
    if (key === 'ideas') next.ideas = typeof value === 'string' ? JSON.parse(value) : value;
    else next[key] = Number(String(value).replace(',', '.'));
  });
  api.campaigns.update(current.id, next);
  api.offerService.invalidateIdeas();
}

/** A visitor behind the proxy: the address the stand-in `visitorContext` reads from `x-test-ip`. */
const visitorGuard = (req, res, next) => {
  req.visitor = { ip: req.get('x-test-ip') || '', userAgent: '', pluginVersion: '' };
  next();
};

/** The plugin's API on `db`, with a movable clock. `over` replaces any dependency. */
function buildApi(db = freshDb(), over = {}) {
  const clock = { at: new Date('2026-11-15T10:00:00Z') }; // date-literal-ok: the suite runs on its own clock, never the real today
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
    company: COMPANY,
    filesDir: () => filesDir(),
    onCheckLimitsTrip: (event) => trips.push(event),
    ...over.deps,
  });
  // The shop of a suite is set up: its lodging campaign is on sale (a fresh install starts it as a draft).
  const lodgingCampaign = api.campaigns.firstLodging();
  api.campaigns.update(lodgingCampaign.id, { ...lodgingCampaign, state: 'on_sale' });
  const lodging = Object.fromEntries(LODGING_FIELDS.filter((key) => over.settings && over.settings[key] !== undefined).map((key) => [key, over.settings[key]]));
  if (Object.keys(lodging).length) setLodging(api, lodging);
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
// A proof at the base difficulty. The guard raises the difficulty with the requests an address already made in the hour, which these suites make by the hundred: the log is emptied
// first, so every proof stays cheap; `voucher-proof-guard.unit.test.js` judges the raised difficulty itself.
function solvedProof({ difficulty = 12, ip = '' } = {}) {
  const pow = sdk.proofOfWork;
  sdk.proofGuard.store.ensureTables().exec('DELETE FROM public_request_log');
  const ipKey = pow.ipKeyOf(ip);
  const challenge = pow.issue({
    secret: POW_SECRET, ipKey, difficulty, now: Date.now() - 5000,
  });
  return { challenge, nonce: pow.solve(challenge) };
}

module.exports = {
  COMPANY, freshDb, buildApi, setLodging, start, issueManual, revealedCode, solvedProof, PEPPER, METHODS, sdk,
};
