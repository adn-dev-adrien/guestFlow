/**
 * Operator accounts of the console and their second factor (rule 31). Secrets are stored encrypted
 * (TOTP seed) or hashed (backup codes, email code); nothing here returns them to a client.
 */

function buildOperatorsModel(db) {
  const byEmailStmt = db.prepare('SELECT * FROM operators WHERE email = ?');
  const byIdStmt = db.prepare('SELECT * FROM operators WHERE id = ?');
  const insertStmt = db.prepare('INSERT INTO operators (email, name, passwordHash) VALUES (?, ?, ?)');
  const setPasswordStmt = db.prepare('UPDATE operators SET passwordHash = ? WHERE id = ?');
  const failStmt = db.prepare('UPDATE operators SET failedCount = failedCount + 1 WHERE id = ?');
  const lockStmt = db.prepare('UPDATE operators SET failedCount = 0, lockedUntil = ? WHERE id = ?');
  const resetFailStmt = db.prepare('UPDATE operators SET failedCount = 0, lockedUntil = NULL WHERE id = ?');
  const setPendingStmt = db.prepare('UPDATE operators SET pendingMethod = ?, pendingTotpSecret = ? WHERE id = ?');
  const activateStmt = db.prepare(`UPDATE operators SET mfaMethod = pendingMethod, totpSecret = CASE WHEN pendingMethod = 'totp' THEN pendingTotpSecret ELSE NULL END,
    pendingMethod = NULL, pendingTotpSecret = NULL, backupCodes = ? WHERE id = ?`);
  const setBackupStmt = db.prepare('UPDATE operators SET backupCodes = ? WHERE id = ?');
  const setCodeStmt = db.prepare(`INSERT INTO mfa_codes (operatorId, codeHash, expiresAt) VALUES (?, ?, ?)
    ON CONFLICT (operatorId) DO UPDATE SET codeHash = excluded.codeHash, expiresAt = excluded.expiresAt`);
  const getCodeStmt = db.prepare('SELECT * FROM mfa_codes WHERE operatorId = ?');
  const clearCodeStmt = db.prepare('DELETE FROM mfa_codes WHERE operatorId = ?');

  return {
    byEmail: (email) => byEmailStmt.get(String(email || '').trim().toLowerCase()) || null,
    byId: (id) => byIdStmt.get(id) || null,
    create: ({ email, name, passwordHash }) => Number(insertStmt.run(String(email).trim().toLowerCase(), name || '', passwordHash).lastInsertRowid),
    setPassword: (id, hash) => setPasswordStmt.run(hash, id),
    recordFailure: (id) => failStmt.run(id),
    lock: (id, until) => lockStmt.run(until, id),
    resetFailures: (id) => resetFailStmt.run(id),
    setPending: (id, method, totpSecret) => setPendingStmt.run(method, totpSecret || null, id),
    activatePending: (id, backupCodesJson) => activateStmt.run(backupCodesJson, id),
    setBackupCodes: (id, json) => setBackupStmt.run(json, id),
    setCode: (id, hash, expiresAt) => setCodeStmt.run(id, hash, expiresAt),
    getCode: (id) => getCodeStmt.get(id) || null,
    clearCode: (id) => clearCodeStmt.run(id),
  };
}

module.exports = { buildOperatorsModel };
