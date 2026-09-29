/**
 * Test fixtures for the console: an in-memory database, a temporary instances root, a throwaway
 * Ed25519 key pair, a clock the test moves, a mailer that records, and a fake first-admin runner.
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

function makeContext({ at = '2026-09-29T10:00:00Z', firstAdmin } = {}) {
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
};

module.exports = { makeClock, makeMailer, makeInstance, makeContext, NEW_CUSTOMER };
