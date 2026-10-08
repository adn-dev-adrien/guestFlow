/**
 * Tables of the account security (specs/hosting-h2-account-security.md §5). Additive and idempotent:
 * run by database.js on every boot, and by the unit tests on an in-memory database.
 *
 * - `password_reset_tokens` — rules 1–5: only the SHA-256 of a link's token is stored.
 * - `user_two_factor`, `user_backup_codes` — rules 6–10: the TOTP secret is encrypted at rest; the
 *   backup codes are stored with the password hash.
 * - `user_security_events` — the account's history (rule 9): who turned the second step on or off,
 *   a reset by link, a recovery by the command line.
 * - `support_access`, `support_access_links`, `support_access_log` — rules 12–17.
 * - The « Support GuestFlow » user (rule 14): an admin account that is never active and holds a
 *   password nobody knows. Only an open access lets a signed link open a session with it.
 */

const crypto = require('crypto');
const { hashPassword } = require('./passwordHash');
const { SUPPORT_USER_EMAIL } = require('./supportAccess');

function applyAccountSecuritySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tokenHash TEXT NOT NULL UNIQUE,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(userId);

    CREATE TABLE IF NOT EXISTS user_two_factor (
      userId INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      method TEXT,
      secretEncrypted TEXT,
      enabledAt TEXT,
      pendingMethod TEXT,
      pendingSecretEncrypted TEXT,
      pendingFailures INTEGER NOT NULL DEFAULT 0,
      emailCodeHash TEXT,
      emailCodeExpiresAt TEXT,
      failedCount INTEGER NOT NULL DEFAULT 0,
      lockedUntil TEXT,
      lastTotpStep INTEGER
    );

    CREATE TABLE IF NOT EXISTS user_backup_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      codeHash TEXT NOT NULL,
      usedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_user_backup_codes_user ON user_backup_codes(userId);

    CREATE TABLE IF NOT EXISTS user_security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      event TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_user_security_events_user ON user_security_events(userId);

    CREATE TABLE IF NOT EXISTS support_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requestId TEXT NOT NULL UNIQUE,
      reason TEXT NOT NULL,
      requestedAt TEXT NOT NULL,
      decision TEXT,
      decidedBy INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decidedAt TEXT,
      expiresAt TEXT,
      revokedAt TEXT,
      revokedBy INTEGER REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS support_access_links (
      jti TEXT PRIMARY KEY,
      accessId INTEGER NOT NULL REFERENCES support_access(id) ON DELETE CASCADE,
      usedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS support_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      accessId INTEGER NOT NULL REFERENCES support_access(id) ON DELETE CASCADE,
      at TEXT NOT NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_support_access_log_access ON support_access_log(accessId);
  `);

  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('twoFactorSnoozedUntil')) db.exec('ALTER TABLE users ADD COLUMN twoFactorSnoozedUntil TEXT');

  const support = db.prepare('SELECT id FROM users WHERE email = ?').get(SUPPORT_USER_EMAIL);
  if (!support) {
    // A password nobody holds, and never active: the account cannot log in with a password.
    const id = Number(db.prepare(`
      INSERT INTO users (email, passwordHash, firstName, lastName, mustChangePassword, isActive)
      VALUES (?, ?, 'Support', 'GuestFlow', 0, 0)
    `).run(SUPPORT_USER_EMAIL, hashPassword(crypto.randomBytes(32).toString('base64'))).lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO user_roles (userId, role) VALUES (?, 'admin')").run(id);
  }
}

module.exports = { applyAccountSecuritySchema };
