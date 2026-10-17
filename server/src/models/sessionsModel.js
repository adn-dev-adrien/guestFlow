/**
 * Sessions model — server-side session revocation.
 *
 * The session rows are written and read by `better-sqlite3-session-store`
 * (table `sessions(sid TEXT PK, sess JSON, expire TEXT)`, declared in schema.sql). This model
 * only REVOKES sessions: it deletes rows so a cookie still held by a browser or a script stops
 * authenticating on its next request.
 *
 * It is called from the account lifecycle (deactivation, role change, password reset/change) so
 * the control an admin reaches for after an employee leaves actually ends the live session, not
 * only future logins. See specs/security-auth-encryption.md rule 3 (Revocation) and the
 * 2026-10-08 infrastructure audit, finding AUTH-1.
 *
 * `buildModel(db)` factory for tests; a default instance is bound to the production database.
 *
 * The user id is stored at `sess.user.id` (a number, set at login), so it is read with
 * `json_extract(sess, '$.user.id')`. Every statement is prepared lazily and wrapped in try/catch:
 * a unit database that never installed the session store has no `sessions` table, and revocation
 * there is simply a no-op rather than a crash.
 */

const db = require('../database');

function buildModel(database) {
  let revokeForUserStmt;
  let revokeOthersForUserStmt;
  let revokeAllStmt;

  function prepare() {
    if (revokeForUserStmt) return;
    revokeForUserStmt = database.prepare(
      "DELETE FROM sessions WHERE CAST(json_extract(sess, '$.user.id') AS INTEGER) = ?"
    );
    revokeOthersForUserStmt = database.prepare(
      "DELETE FROM sessions WHERE CAST(json_extract(sess, '$.user.id') AS INTEGER) = ? AND sid <> ?"
    );
    revokeAllStmt = database.prepare('DELETE FROM sessions');
  }

  // Revoke every session belonging to a user. Returns the number of rows deleted (0 if the user
  // has no live session or the table is absent).
  function revokeAllForUser(userId) {
    const id = Number(userId);
    if (!Number.isInteger(id)) return 0;
    try {
      prepare();
      return revokeForUserStmt.run(id).changes;
    } catch {
      return 0;
    }
  }

  // Revoke a user's sessions EXCEPT one `keepSid` (the caller's current session). Used after a
  // voluntary password change so the actor keeps working while every other device is logged out.
  function revokeOtherSessionsForUser(userId, keepSid) {
    const id = Number(userId);
    if (!Number.isInteger(id)) return 0;
    if (!keepSid) return revokeAllForUser(id);
    try {
      prepare();
      return revokeOthersForUserStmt.run(id, String(keepSid)).changes;
    } catch {
      return 0;
    }
  }

  // Revoke every session (admin recovery). Mirrors reset-admin.js.
  function revokeAll() {
    try {
      prepare();
      return revokeAllStmt.run().changes;
    } catch {
      return 0;
    }
  }

  return { revokeAllForUser, revokeOtherSessionsForUser, revokeAll };
}

const defaultModel = buildModel(db);
defaultModel.buildModel = buildModel;

module.exports = defaultModel;
