/**
 * Users model — DB access for the `users` table (authentication).
 *
 * Exports a default model bound to the production database, plus a `create(db)` factory for tests.
 * Passwords are hashed via utils/passwordHash; this layer never exposes the hash.
 *
 * API:
 *   findByEmail(email)               → raw row | undefined
 *   findById(id)                     → raw row | undefined
 *   verifyCredentials(email, pw)     → safe user | null   (active users only; constant-time password check)
 *   updatePassword(id, newPassword)  → hashes, clears mustChangePassword
 *   resetAdminToDefault()            → recovery: restore the default admin (default password + forced change)
 *   toSafeUser(row)                  → { id, email, role, mustChangePassword }
 */

const db = require('../database');
const { hashPassword, verifyPassword } = require('../utils/passwordHash');
const { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } = require('../constants/authDefaults');

function toSafeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    mustChangePassword: Boolean(row.mustChangePassword),
  };
}

function createUsersModel(databaseInstance) {
  const findByEmailStmt = databaseInstance.prepare('SELECT * FROM users WHERE email = ?');
  const findByIdStmt = databaseInstance.prepare('SELECT * FROM users WHERE id = ?');
  const updatePasswordStmt = databaseInstance.prepare(
    "UPDATE users SET passwordHash = ?, mustChangePassword = 0, updatedAt = datetime('now') WHERE id = ?"
  );

  return {
    toSafeUser,

    findByEmail(email) {
      return findByEmailStmt.get(String(email || '').trim().toLowerCase());
    },

    findById(id) {
      return findByIdStmt.get(Number(id));
    },

    verifyCredentials(email, password) {
      const row = findByEmailStmt.get(String(email || '').trim().toLowerCase());
      if (!row || !row.isActive) return null;
      if (!verifyPassword(String(password || ''), row.passwordHash)) return null;
      return toSafeUser(row);
    },

    updatePassword(id, newPassword) {
      updatePasswordStmt.run(hashPassword(String(newPassword)), Number(id));
    },

    // Recovery: restore the default admin account to the documented default password with a forced
    // change, re-activating (or recreating) it. Used by the `reset-admin` CLI when access is lost.
    resetAdminToDefault() {
      const hash = hashPassword(DEFAULT_ADMIN_PASSWORD);
      const existing = findByEmailStmt.get(DEFAULT_ADMIN_EMAIL);
      if (existing) {
        databaseInstance
          .prepare("UPDATE users SET passwordHash = ?, mustChangePassword = 1, isActive = 1, updatedAt = datetime('now') WHERE email = ?")
          .run(hash, DEFAULT_ADMIN_EMAIL);
      } else {
        databaseInstance
          .prepare("INSERT INTO users (email, passwordHash, role, mustChangePassword) VALUES (?, ?, 'admin', 1)")
          .run(DEFAULT_ADMIN_EMAIL, hash);
      }
      return DEFAULT_ADMIN_EMAIL;
    },
  };
}

const defaultModel = createUsersModel(db);
defaultModel.create = createUsersModel;
defaultModel.toSafeUser = toSafeUser;

module.exports = defaultModel;
