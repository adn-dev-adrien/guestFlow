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
 *   toSafeUser(row)                  → { id, email, role, mustChangePassword }
 */

const db = require('../database');
const { hashPassword, verifyPassword } = require('../utils/passwordHash');

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
  };
}

const defaultModel = createUsersModel(db);
defaultModel.create = createUsersModel;
defaultModel.toSafeUser = toSafeUser;

module.exports = defaultModel;
