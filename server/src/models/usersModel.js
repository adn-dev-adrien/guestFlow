/**
 * Users model — DB access for the `users` table + the `user_roles` join table (authentication +
 * account management).
 *
 * Exports a default model bound to the production database, plus a `buildModel(db)` factory for
 * tests. Passwords are hashed via utils/passwordHash; this layer never exposes the hash.
 *
 * Safe user shape (returned everywhere):
 *   { id, email, firstName, lastName, companyName, notes, roles: string[], isActive,
 *     mustChangePassword, lastLoginAt }
 *
 * Roles are stored in `user_roles(userId, role)` with ON DELETE CASCADE. Every user MUST have at
 * least one role; setRoles + createUser reject empty role arrays.
 *
 * Key invariants:
 *   - email is stored trimmed + lower-cased (UNIQUE index)
 *   - softDelete: isActive = 0 (preserves history)
 *   - hardDelete: only allowed when the user has never logged in (lastLoginAt IS NULL AND
 *     mustChangePassword = 1) — throws HARD_DELETE_NOT_ELIGIBLE otherwise
 *   - findActiveAdminCount + the guards in the controller protect against last-admin removal
 */

const db = require('../database');
const { hashPassword, verifyPassword } = require('../utils/passwordHash');
const { DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD } = require('../constants/authDefaults');
const { isKnownRole, ADMIN } = require('../constants/roles');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function buildModel(database) {
  // ----- prepared statements (built once per model instance) -----
  const findByEmailStmt = database.prepare('SELECT * FROM users WHERE email = ?');
  const findByIdStmt = database.prepare('SELECT * FROM users WHERE id = ?');
  const listStmt = database.prepare(`
    SELECT * FROM users
    ORDER BY lastName COLLATE NOCASE, firstName COLLATE NOCASE, email COLLATE NOCASE
  `);
  const loadRolesStmt = database.prepare('SELECT role FROM user_roles WHERE userId = ? ORDER BY role');
  const deleteRolesStmt = database.prepare('DELETE FROM user_roles WHERE userId = ?');
  const insertRoleStmt = database.prepare('INSERT OR IGNORE INTO user_roles (userId, role) VALUES (?, ?)');
  const updatePasswordStmt = database.prepare(
    "UPDATE users SET passwordHash = ?, mustChangePassword = 0, updatedAt = datetime('now') WHERE id = ?"
  );
  const resetPasswordStmt = database.prepare(
    "UPDATE users SET passwordHash = ?, mustChangePassword = 1, isActive = 1, updatedAt = datetime('now') WHERE id = ?"
  );
  const insertUserStmt = database.prepare(`
    INSERT INTO users (email, passwordHash, firstName, lastName, companyName, notes, mustChangePassword, isActive)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1)
  `);
  const updateUserStmt = database.prepare(`
    UPDATE users SET firstName = ?, lastName = ?, companyName = ?, notes = ?, updatedAt = datetime('now')
    WHERE id = ?
  `);
  const softDeleteStmt = database.prepare("UPDATE users SET isActive = 0, updatedAt = datetime('now') WHERE id = ?");
  const hardDeleteStmt = database.prepare('DELETE FROM users WHERE id = ?');
  const touchLastLoginStmt = database.prepare("UPDATE users SET lastLoginAt = datetime('now') WHERE id = ?");
  const activeAdminCountStmt = database.prepare(`
    SELECT COUNT(DISTINCT u.id) AS n
    FROM users u
    JOIN user_roles r ON r.userId = u.id
    WHERE u.isActive = 1 AND r.role = ?
  `);

  function loadRoles(userId) {
    return loadRolesStmt.all(Number(userId)).map((r) => r.role);
  }

  function toSafeUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      firstName: row.firstName || '',
      lastName: row.lastName || '',
      companyName: row.companyName || '',
      notes: row.notes || '',
      roles: loadRoles(row.id),
      isActive: Number(row.isActive) === 1,
      mustChangePassword: Number(row.mustChangePassword) === 1,
      lastLoginAt: row.lastLoginAt || null,
    };
  }

  // ----- role management -----
  const setRolesTx = database.transaction((userId, roles) => {
    deleteRolesStmt.run(userId);
    for (const role of roles) {
      insertRoleStmt.run(userId, role);
    }
  });

  function setRoles(userId, roles) {
    const cleaned = Array.from(new Set((roles || []).map((r) => String(r || '').trim()).filter(Boolean)));
    if (cleaned.length === 0) {
      const err = new Error('ROLES_REQUIRED');
      err.code = 'ROLES_REQUIRED';
      throw err;
    }
    for (const role of cleaned) {
      if (!isKnownRole(role)) {
        const err = new Error(`UNKNOWN_ROLE:${role}`);
        err.code = 'UNKNOWN_ROLE';
        err.role = role;
        throw err;
      }
    }
    setRolesTx(Number(userId), cleaned);
    return cleaned;
  }

  return {
    toSafeUser,

    findByEmail(email) {
      const row = findByEmailStmt.get(normalizeEmail(email));
      return row ? toSafeUser(row) : null;
    },

    findById(id) {
      const row = findByIdStmt.get(Number(id));
      return row ? toSafeUser(row) : null;
    },

    verifyCredentials(email, password) {
      const row = findByEmailStmt.get(normalizeEmail(email));
      if (!row || Number(row.isActive) !== 1) return null;
      if (!verifyPassword(String(password || ''), row.passwordHash)) return null;
      return toSafeUser(row);
    },

    list() {
      return listStmt.all().map(toSafeUser);
    },

    // Create a user + roles atomically. Throws ROLES_REQUIRED if `roles` is empty/missing, UNKNOWN_ROLE
    // if any role isn't in constants/roles.js, and EMAIL_ALREADY_EXISTS if the email's already taken.
    createUser({ email, password, firstName = '', lastName = '', companyName = '', notes = '', roles }) {
      if (!Array.isArray(roles) || roles.length === 0) {
        const err = new Error('ROLES_REQUIRED');
        err.code = 'ROLES_REQUIRED';
        throw err;
      }
      const normalizedEmail = normalizeEmail(email);
      const hash = hashPassword(String(password || ''));
      try {
        const tx = database.transaction(() => {
          const result = insertUserStmt.run(
            normalizedEmail,
            hash,
            String(firstName || '').trim(),
            String(lastName || '').trim(),
            String(companyName || '').trim(),
            String(notes || '').trim(),
          );
          const id = Number(result.lastInsertRowid);
          setRoles(id, roles);
          return id;
        });
        const id = tx();
        return toSafeUser(findByIdStmt.get(id));
      } catch (err) {
        if (String(err && err.message || '').includes('UNIQUE') && String(err.message).includes('users.email')) {
          const e = new Error('EMAIL_ALREADY_EXISTS');
          e.code = 'EMAIL_ALREADY_EXISTS';
          throw e;
        }
        throw err;
      }
    },

    // Update identity + roles (atomic when both touched). Email is NOT editable here.
    updateUser(id, { firstName, lastName, companyName, notes, roles }) {
      const numericId = Number(id);
      const existing = findByIdStmt.get(numericId);
      if (!existing) return null;
      const tx = database.transaction(() => {
        updateUserStmt.run(
          firstName === undefined ? existing.firstName : String(firstName || '').trim(),
          lastName === undefined ? existing.lastName : String(lastName || '').trim(),
          companyName === undefined ? existing.companyName : String(companyName || '').trim(),
          notes === undefined ? existing.notes : String(notes || '').trim(),
          numericId,
        );
        if (roles !== undefined) setRoles(numericId, roles);
      });
      tx();
      return toSafeUser(findByIdStmt.get(numericId));
    },

    setRoles,

    updatePassword(id, newPassword) {
      updatePasswordStmt.run(hashPassword(String(newPassword)), Number(id));
    },

    // Admin-side reset: hash the new password, force mustChangePassword=1, reactivate. Returns null
    // if the user is missing; otherwise the safe user. The temp password itself never leaves the
    // controller — this method just stores its hash.
    resetUserPassword(id, newPassword) {
      const numericId = Number(id);
      const existing = findByIdStmt.get(numericId);
      if (!existing) return null;
      const hash = hashPassword(String(newPassword || ''));
      resetPasswordStmt.run(hash, numericId);
      return toSafeUser(findByIdStmt.get(numericId));
    },

    softDelete(id) {
      const numericId = Number(id);
      const existing = findByIdStmt.get(numericId);
      if (!existing) return null;
      softDeleteStmt.run(numericId);
      return toSafeUser(findByIdStmt.get(numericId));
    },

    // Hard delete: only allowed when the user has never logged in AND has never changed their
    // (still-mustChangePassword) password. Cascades to user_roles via the FK. Throws otherwise.
    hardDelete(id) {
      const numericId = Number(id);
      const existing = findByIdStmt.get(numericId);
      if (!existing) return null;
      const eligible = existing.lastLoginAt == null && Number(existing.mustChangePassword) === 1;
      if (!eligible) {
        const err = new Error('HARD_DELETE_NOT_ELIGIBLE');
        err.code = 'HARD_DELETE_NOT_ELIGIBLE';
        throw err;
      }
      // SQLite enforces ON DELETE CASCADE only when foreign_keys is ON. The pragma is enabled in
      // database.js at boot; we set it again here for extra safety on test databases.
      database.pragma('foreign_keys = ON');
      hardDeleteStmt.run(numericId);
      return true;
    },

    touchLastLogin(id) {
      touchLastLoginStmt.run(Number(id));
    },

    // Counts active admin users, used by the controller's last-admin guard.
    findActiveAdminCount() {
      return activeAdminCountStmt.get(ADMIN).n;
    },

    // Recovery: restore the default admin account to the documented default password with a forced
    // change, re-activating (or recreating) it. Used by the `reset-admin` CLI when access is lost.
    resetAdminToDefault() {
      const hash = hashPassword(DEFAULT_ADMIN_PASSWORD);
      const existing = findByEmailStmt.get(DEFAULT_ADMIN_EMAIL);
      const tx = database.transaction(() => {
        if (existing) {
          resetPasswordStmt.run(hash, existing.id);
          setRoles(existing.id, [ADMIN]);
        } else {
          const result = insertUserStmt.run(DEFAULT_ADMIN_EMAIL, hash, '', '', '', '');
          setRoles(Number(result.lastInsertRowid), [ADMIN]);
        }
      });
      tx();
      return DEFAULT_ADMIN_EMAIL;
    },
  };
}

const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
