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
const { createMailDriver } = require('../utils/drivers/mail-platform');
const { readEnv } = require('../utils/instanceEnv');

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

// A minimal GuestFlow instance directory: data/guestflow.db with a `plugins` table, a `users` table
// (the directory reads it) and a couple of tables the export reads.
function makeInstance(root, slug, { installed = [], users = [] } = {}) {
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
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, isActive INTEGER NOT NULL DEFAULT 1)');
  const insertUser = db.prepare('INSERT INTO users (email, isActive) VALUES (?, ?)');
  for (const u of users) insertUser.run(u.email, u.isActive === false ? 0 : 1);
  db.close();
  return dataDir;
}

// A release directory as the host keeps it (specs/hosting-h1-fleet-runtime.md H-D4): enough for the
// console to call it installed.
function makeRelease(releasesDir, version) {
  const dir = path.join(releasesDir, version, 'server', 'src');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.js'), '// fake release\n');
  fs.writeFileSync(path.join(releasesDir, version, 'package.json'), JSON.stringify({ version }));
  return path.join(releasesDir, version);
}

/**
 * The four host drivers in memory (H-D6), recording every call, and the fetch the health checks
 * use: an instance « answers » on its slug while its fake process runs, with the version its env
 * file named when it started; a replica follows the clock unless `replicas.get(key).stalled`.
 * `failNext[name] = Error` makes the next call of that driver method
 * throw; `unhealthy.add(version)` makes that version never answer.
 */
function makeFakeDrivers({ domain = 'guestflow.test', now = () => new Date() } = {}) {
  const calls = [];
  const procs = new Map();
  const routes = {};
  const replicas = new Map();
  const failNext = {};
  const unhealthy = new Set();
  const certs = {};
  const memory = {};
  // Like a replica: a copy taken while replication runs, kept after it stops, until the purge.
  const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-fake-replicas-'));
  const copyOf = (key) => path.join(copies, `${key}.db`);
  const takeCopy = async (inst) => {
    if (!fs.existsSync(inst.dbPath)) return;
    const src = new Database(inst.dbPath, { readonly: true });
    try { await src.backup(copyOf(inst.key)); } finally { src.close(); }
  };
  const record = (name, arg) => {
    calls.push({ name, slug: arg && (arg.slug || arg) });
    if (failNext[name]) {
      const err = failNext[name];
      delete failNext[name];
      throw err;
    }
  };
  const startProc = (inst) => procs.set(inst.slug, { running: true, version: (readEnv(inst.dir) || {}).GUESTFLOW_VERSION, dir: inst.dir });
  const stopProc = (inst) => { const p = procs.get(inst.slug); if (p) p.running = false; };
  const drivers = {
    process: {
      name: 'fake',
      async initDatabase(inst) {
        record('process.initDatabase', inst);
        if (!fs.existsSync(inst.dbPath)) makeInstance(path.dirname(inst.dir), inst.slug);
      },
      async enableNow(inst) { record('process.enableNow', inst); startProc(inst); },
      async disableNow(inst) { record('process.disableNow', inst); stopProc(inst); },
      async start(inst) { record('process.start', inst); startProc(inst); },
      async stop(inst) { record('process.stop', inst); stopProc(inst); },
      async restart(inst) { record('process.restart', inst); startProc(inst); },
      async remove(inst) { record('process.remove', inst); procs.delete(inst.slug); },
      async state(inst) { const p = procs.get(inst.slug); return p ? (p.running ? 'running' : 'stopped') : 'absent'; },
      async memory(inst) { return memory[inst.slug] || null; },
      async resumeEnabled() {},
    },
    proxy: {
      name: 'fake',
      async writeSite(inst) { record('proxy.writeSite', inst); routes[inst.slug] = { kind: 'site', port: inst.port }; },
      async writeClosed(slug) { record('proxy.writeClosed', slug); routes[slug] = { kind: 'closed' }; },
      async writeRedirect(from, to) { record('proxy.writeRedirect', from); routes[from] = { kind: 'redirect', to }; },
      async remove(slug) { record('proxy.remove', slug); delete routes[slug]; },
      route: (slug) => routes[slug] || null,
      healthUrl: (inst) => `http://fake.${domain}/${inst.slug}/api/version`,
      certExpiry: (slug) => certs[slug] || null,
      instanceEnv: () => ({ GUESTFLOW_LISTEN_HOST: '127.0.0.1' }),
    },
    backup: {
      name: 'fake',
      async addReplica(inst) { record('backup.addReplica', inst); replicas.set(inst.key, { active: true, last: now().toISOString(), dbPath: inst.dbPath }); await takeCopy(inst); },
      async removeReplica(inst) { record('backup.removeReplica', inst); const r = replicas.get(inst.key); if (r) r.active = false; },
      async purge(inst) { record('backup.purge', inst); replicas.delete(inst.key); fs.rmSync(copyOf(inst.key), { force: true }); },
      async snapshotNow(inst) { record('backup.snapshotNow', inst); return null; },
      // Litestream ships continuously: an active replica is always current.
      async tick(inst) { const r = replicas.get(inst.key); if (r && r.active && !r.stalled) { r.last = now().toISOString(); await takeCopy(inst); } return null; },
      async lastReplicatedAt(inst) { return (replicas.get(inst.key) || {}).last || null; },
      async window(inst) { const r = replicas.get(inst.key); return r ? { from: '2026-09-01T00:00:00.000Z', to: r.last } : null; },
      async restore(inst, { output }) {
        record('backup.restore', inst);
        if (failNext.restoreCorrupt) { delete failNext.restoreCorrupt; fs.writeFileSync(output, 'not a database'); return null; }
        if (!fs.existsSync(copyOf(inst.key))) throw new Error('Aucune sauvegarde.');
        fs.copyFileSync(copyOf(inst.key), output);
        return null;
      },
      async syncUploads(inst) { record('backup.syncUploads', inst); },
    },
    mail: createMailDriver({ kind: 'local', domain, env: { CP_MAIL_DAILY_LIMIT: '300' } }),
  };
  async function fetchImpl(url) {
    const slug = String(url).split('/')[3];
    const p = procs.get(slug);
    if (!p || !p.running || unhealthy.has(p.version)) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    return { ok: true, status: 200, json: async () => ({ version: p.version }) };
  }
  return { drivers, fetchImpl, calls, procs, routes, replicas, failNext, unhealthy, certs, memory, named: (n) => calls.filter((c) => c.name === n) };
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

function makeContext({ at = '2026-09-29T10:00:00Z', firstAdmin, qonto, versions = ['3.9.0'], hostingEnv = {}, pluginInstaller = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-host-'));
  const root = path.join(base, 'instances');
  const releasesDir = path.join(base, 'releases');
  fs.mkdirSync(root);
  for (const v of versions) makeRelease(releasesDir, v);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-data-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const now = makeClock(at);
  const host = makeFakeDrivers({ domain: 'guestflow.test', now });
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
    directoryKey: crypto.randomBytes(32),
    runFirstAdmin: async (args) => {
      firstAdminCalls.push(args);
      return firstAdmin ? firstAdmin(args) : { created: true, temporaryPassword: 'Tmp-Passw0rd' };
    },
    drivers: host.drivers,
    fetchImpl: host.fetchImpl,
    releasesDir,
    hostingEnv: { CP_HEALTH_TIMEOUT_MS: '200', ...hostingEnv },
    pluginInstaller,
    isPortFree: async () => true,
    diskRatio: () => 0.5,
  });
  return { ctx, root, releasesDir, dataDir, exportsDir: ctx.exportsDir, now, mailer, publicKey, firstAdminCalls, host, cleanup() {
    fs.rmSync(base, { recursive: true, force: true });
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

module.exports = { makeClock, makeMailer, makeInstance, makeContext, makeFakeQonto, makeFakeDrivers, makeRelease, licencePayload, NEW_CUSTOMER };
