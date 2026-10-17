// @ts-check
// E2E helpers of specs/hosting-h2-account-security.md: the dev mail catcher (GUESTFLOW_MAIL_OUTBOX),
// a dedicated account seeded in SQLite so the suite's own admin never gets a second step, the TOTP
// helpers shared with the server, and the console's side of support access signed with a fixed
// TEST-ONLY key pair (playwright.config.js gives its public half to the server).
//
// CommonJS on purpose, like the other fixtures.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { hashPassword } = require('../../server/src/utils/passwordHash');
const totp = require('../../server/src/utils/totp');
const supportAccess = require('../../server/src/utils/supportAccess');

const DB_PATH = process.env.GUESTFLOW_E2E_DB_PATH || '/tmp/guestflow-e2e.db';
const OUTBOX = path.join(os.tmpdir(), 'guestflow-e2e-outbox');
// TEST-ONLY Ed25519 pair — never used outside the E2E suite.
const SUPPORT_PUBLIC_KEY = 'MCowBQYDK2VwAyEA021QF2PhmPPOl5YUpe0mb4+a4RNkz1AsczLbtRJw9Yw=';
const SUPPORT_PRIVATE_KEY = crypto.createPrivateKey({
  key: Buffer.from('MC4CAQAwBQYDK2VwBCIEIGXcFJthz7tPpnCPda38/UaKuc4+Y5/myic8iv2Nd5Z2', 'base64'), format: 'der', type: 'pkcs8',
});

function withDb(fn) {
  const db = new Database(DB_PATH);
  try { return fn(db); } finally { db.close(); }
}

// A fresh admin account, unique per call.
function seedAccount(prefix) {
  const email = `${prefix}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}@guestflow.test`;
  const password = 'e2e-account-1234';
  withDb((db) => {
    const id = Number(db.prepare('INSERT INTO users (email, passwordHash, firstName, lastName, mustChangePassword, isActive) VALUES (?, ?, ?, ?, 0, 1)')
      .run(email, hashPassword(password), 'E2E', prefix).lastInsertRowid);
    db.prepare("INSERT INTO user_roles (userId, role) VALUES (?, 'admin')").run(id);
  });
  return { email, password };
}

function lastMailTo(email) {
  if (!fs.existsSync(OUTBOX)) return null;
  const mails = fs.readdirSync(OUTBOX).sort().map((f) => JSON.parse(fs.readFileSync(path.join(OUTBOX, f), 'utf8')));
  return mails.filter((m) => m.to === email).pop() || null;
}

const codeFor = (secret) => totp.totp(totp.base32Decode(secret.replace(/\s/g, '')), new Date());

function writeSupportRequest(reason) {
  const token = supportAccess.signRequest({ slug: 'e2e', requestId: crypto.randomUUID(), reason, requestedAt: new Date().toISOString() }, SUPPORT_PRIVATE_KEY);
  fs.writeFileSync(path.join(path.dirname(DB_PATH), supportAccess.REQUEST_FILE), token);
}

function openAccessId() {
  return withDb((db) => db.prepare("SELECT id FROM support_access WHERE decision = 'accepted' AND revokedAt IS NULL ORDER BY id DESC").get().id);
}

const supportLinkPath = (accessId) => `/api/auth/support?token=${encodeURIComponent(supportAccess.signLink({ slug: 'e2e', accessId, jti: crypto.randomUUID(), now: new Date() }, SUPPORT_PRIVATE_KEY))}`;

module.exports = { OUTBOX, SUPPORT_PUBLIC_KEY, seedAccount, lastMailTo, codeFor, writeSupportRequest, openAccessId, supportLinkPath };
