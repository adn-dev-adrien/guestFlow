/**
 * Second step of the login (specs/hosting-h2-account-security.md rules 6–10): the method, the TOTP
 * secret, the enrolment in progress, the email code, the failures and the lock, the backup codes,
 * the « Plus tard » of the dashboard card, and the account's security history.
 *
 * The TOTP secrets are encrypted at rest (AES-256-GCM, utils/encryption.js) through
 * `ENCRYPTED_COLUMNS`, as for the settings' secrets: nothing in this model returns them to a client,
 * and an administrator can only turn another user's step off, never read it (rule 9).
 *
 * `buildModel(db, { encrypt, decrypt })` for tests; the default instance is bound to production.
 */

const encryption = require('../utils/encryption');

const ENCRYPTED_COLUMNS = ['secretEncrypted', 'pendingSecretEncrypted'];

function buildModel(db, { encrypt = encryption.encrypt, decrypt = encryption.decrypt } = {}) {
  const getStmt = db.prepare('SELECT * FROM user_two_factor WHERE userId = ?');
  const ensureStmt = db.prepare('INSERT OR IGNORE INTO user_two_factor (userId) VALUES (?)');
  const setPendingStmt = db.prepare(`UPDATE user_two_factor SET pendingMethod = ?, pendingSecretEncrypted = ?, pendingFailures = 0,
    pendingStartedAt = ?, pendingTokenHash = ?, pendingSends = 0, emailCodeHash = NULL, emailCodeExpiresAt = NULL WHERE userId = ?`);
  const switchPendingStmt = db.prepare(`UPDATE user_two_factor SET pendingMethod = ?, pendingSecretEncrypted = ?, pendingFailures = 0,
    emailCodeHash = NULL, emailCodeExpiresAt = NULL WHERE userId = ?`);
  // A slot: lastCodeSentAt becomes now, mailsSent counts within an hour (reset once the hour is over).
  // The hour's budget is counted in `sent`/`since`: the login resend has its own pair, so « Recevoir un
  // code » (a session's own mails) can never use up the budget of the login (rule 55).
  const slot = (sent, since) => ({
    set: `lastCodeSentAt = ?,
    ${sent} = CASE WHEN ${since} IS NULL OR ${since} <= ? THEN 1 ELSE ${sent} + 1 END,
    ${since} = CASE WHEN ${since} IS NULL OR ${since} <= ? THEN ? ELSE ${since} END`,
    where: `(lastCodeSentAt IS NULL OR lastCodeSentAt <= ?)
    AND (${since} IS NULL OR ${since} <= ? OR ${sent} < ?)`,
  });
  const mail = slot('mailsSent', 'mailsSince');
  const loginMail = slot('loginMailsSent', 'loginMailsSince');
  const reserveStmt = db.prepare(`UPDATE user_two_factor SET ${mail.set} WHERE userId = ? AND ${mail.where}`);
  const reserveLoginStmt = db.prepare(`UPDATE user_two_factor SET ${loginMail.set} WHERE userId = ? AND ${loginMail.where}`);
  const reserveEnrolmentStmt = db.prepare(`UPDATE user_two_factor SET pendingSends = pendingSends + 1, ${mail.set}
    WHERE userId = ? AND pendingSends < ? AND ${mail.where}`);
  const setActionStmt = db.prepare('UPDATE user_two_factor SET actionCodeHash = ?, actionCodeExpiresAt = ? WHERE userId = ?');
  const clearActionStmt = db.prepare('UPDATE user_two_factor SET actionCodeHash = NULL, actionCodeExpiresAt = NULL WHERE userId = ?');
  const enrolmentSendStmt = db.prepare('UPDATE user_two_factor SET pendingSends = pendingSends + 1 WHERE userId = ?');
  const codeSentStmt = db.prepare('UPDATE user_two_factor SET lastCodeSentAt = ? WHERE userId = ?');
  const pendingFailStmt = db.prepare('UPDATE user_two_factor SET pendingFailures = pendingFailures + 1 WHERE userId = ?');
  // The email code is dropped only when it belonged to the enrolment (SQLite reads the old row on the right).
  const dropPendingStmt = db.prepare(`UPDATE user_two_factor SET pendingMethod = NULL, pendingSecretEncrypted = NULL, pendingFailures = 0,
    pendingStartedAt = NULL, pendingTokenHash = NULL, pendingSends = 0,
    emailCodeHash = CASE WHEN pendingMethod = 'email' THEN NULL ELSE emailCodeHash END,
    emailCodeExpiresAt = CASE WHEN pendingMethod = 'email' THEN NULL ELSE emailCodeExpiresAt END WHERE userId = ?`);
  const activateStmt = db.prepare(`UPDATE user_two_factor SET method = pendingMethod,
    secretEncrypted = CASE WHEN pendingMethod = 'totp' THEN pendingSecretEncrypted ELSE NULL END,
    enabledAt = CASE WHEN ? = 1 THEN enabledAt ELSE ? END,
    pendingMethod = NULL, pendingSecretEncrypted = NULL, pendingFailures = 0, pendingStartedAt = NULL, pendingTokenHash = NULL,
    pendingSends = 0, failedCount = 0, lockedUntil = NULL,
    lastTotpStep = ?, emailCodeHash = NULL, emailCodeExpiresAt = NULL WHERE userId = ?`);
  const deleteStmt = db.prepare('DELETE FROM user_two_factor WHERE userId = ?');
  const setCodeStmt = db.prepare('UPDATE user_two_factor SET emailCodeHash = ?, emailCodeExpiresAt = ? WHERE userId = ?');
  const clearCodeStmt = db.prepare('UPDATE user_two_factor SET emailCodeHash = NULL, emailCodeExpiresAt = NULL WHERE userId = ?');
  const failStmt = db.prepare('UPDATE user_two_factor SET failedCount = failedCount + 1 WHERE userId = ?');
  const lockStmt = db.prepare('UPDATE user_two_factor SET lockedUntil = ?, failedCount = 0 WHERE userId = ?');
  const resetFailStmt = db.prepare('UPDATE user_two_factor SET failedCount = 0, lockedUntil = NULL WHERE userId = ?');
  const totpStepStmt = db.prepare('UPDATE user_two_factor SET lastTotpStep = ? WHERE userId = ? AND (lastTotpStep IS NULL OR lastTotpStep < ?)');
  const enabledIdsStmt = db.prepare('SELECT userId FROM user_two_factor WHERE enabledAt IS NOT NULL');

  const unusedCodesStmt = db.prepare('SELECT id, codeHash FROM user_backup_codes WHERE userId = ? AND usedAt IS NULL ORDER BY id');
  const useCodeStmt = db.prepare('UPDATE user_backup_codes SET usedAt = ? WHERE id = ? AND usedAt IS NULL');
  const deleteCodesStmt = db.prepare('DELETE FROM user_backup_codes WHERE userId = ?');
  const insertCodeStmt = db.prepare('INSERT INTO user_backup_codes (userId, codeHash) VALUES (?, ?)');

  const snoozeStmt = db.prepare('UPDATE users SET twoFactorSnoozedUntil = ? WHERE id = ?');
  const snoozedStmt = db.prepare('SELECT twoFactorSnoozedUntil AS until FROM users WHERE id = ?');

  const addEventStmt = db.prepare('INSERT INTO user_security_events (userId, at, event, actor) VALUES (?, ?, ?, ?)');
  const eventsStmt = db.prepare('SELECT at, event, actor FROM user_security_events WHERE userId = ? ORDER BY at DESC, id DESC LIMIT ?');

  const decryptRow = (row) => {
    if (!row) return null;
    const out = { ...row };
    ENCRYPTED_COLUMNS.forEach((col) => { out[col] = row[col] ? decrypt(row[col]) : null; });
    return out;
  };

  const replaceCodes = db.transaction((userId, hashes) => {
    deleteCodesStmt.run(userId);
    hashes.forEach((h) => insertCodeStmt.run(userId, h));
  });

  return {
    ENCRYPTED_COLUMNS,

    // The row with its secrets decrypted — for the controller only, never sent to a client.
    get: (userId) => decryptRow(getStmt.get(Number(userId))),
    isEnabled: (userId) => Boolean((getStmt.get(Number(userId)) || {}).enabledAt),
    enabledUserIds: () => enabledIdsStmt.all().map((r) => Number(r.userId)),

    // A new enrolment, opened with the password: its start and the hash of its token (rules 43-44, 54).
    setPending(userId, method, secret, { startedAt, tokenHash = null }) {
      ensureStmt.run(Number(userId));
      setPendingStmt.run(method, secret ? encrypt(secret) : null, startedAt, tokenHash, Number(userId));
    },
    // The same enrolment moving to another method: its start, its session and its sends are kept.
    switchPending(userId, method, secret) {
      switchPendingStmt.run(method, secret ? encrypt(secret) : null, Number(userId));
    },
    ensure: (userId) => ensureStmt.run(Number(userId)),
    markEnrolmentSend: (userId) => enrolmentSendStmt.run(Number(userId)),
    markCodeSent: (userId, nowIso) => codeSentStmt.run(nowIso, Number(userId)),
    // Rule 44/55 — a mail slot is taken BEFORE the mail is sent, in one conditional UPDATE, so parallel
    // requests cannot all pass a check made before the first one writes. `enrolment`: at most `maxSends`
    // per enrolment; always: no send within the gap, and at most `maxPerHour` mails per hour. → true when
    // the slot is yours.
    reserveMailSlot(userId, { nowIso, gapBeforeIso, hourAgoIso, enrolment = false, login = false, maxSends = 5, maxPerHour = 10 }) {
      const stmt = enrolment ? reserveEnrolmentStmt : (login ? reserveLoginStmt : reserveStmt);
      const set = [nowIso, hourAgoIso, hourAgoIso, nowIso];
      const where = [gapBeforeIso, hourAgoIso, maxPerHour];
      const args = enrolment ? [...set, Number(userId), maxSends, ...where] : [...set, Number(userId), ...where];
      return stmt.run(...args).changes === 1;
    },
    // The re-authentication code is kept apart from the login code, so asking for one never cancels the other.
    setActionCode: (userId, codeHash, expiresAt) => setActionStmt.run(codeHash, expiresAt, Number(userId)),
    clearActionCode: (userId) => clearActionStmt.run(Number(userId)),
    recordPendingFailure: (userId) => pendingFailStmt.run(Number(userId)),
    dropPending: (userId) => dropPendingStmt.run(Number(userId)),
    // `totpStep`: the step of the code that confirmed the enrolment, so that code cannot also open a
    // session (specs/hosting-h2-account-security.md rule 28). `keepEnabledAt`: a replacement of the
    // method (rule 48) keeps the date the step was turned on, so the trusted devices stay trusted; the
    // method, the secret and the backup codes change in this one transaction.
    activatePending: db.transaction((userId, nowIso, backupHashes, totpStep = null, { keepEnabledAt = false } = {}) => {
      activateStmt.run(keepEnabledAt ? 1 : 0, nowIso, totpStep == null ? null : Number(totpStep), Number(userId));
      replaceCodes(Number(userId), backupHashes);
    }),
    disable: db.transaction((userId) => {
      deleteStmt.run(Number(userId));
      deleteCodesStmt.run(Number(userId));
    }),

    setEmailCode: (userId, codeHash, expiresAt) => setCodeStmt.run(codeHash, expiresAt, Number(userId)),
    clearEmailCode: (userId) => clearCodeStmt.run(Number(userId)),

    recordFailure: (userId) => failStmt.run(Number(userId)),
    lock: (userId, untilIso) => lockStmt.run(untilIso, Number(userId)),
    resetFailures: (userId) => resetFailStmt.run(Number(userId)),
    // A TOTP time step is accepted once: false when it (or a later one) was already used.
    useTotpStep: (userId, step) => totpStepStmt.run(step, Number(userId), step).changes === 1,

    unusedBackupCodes: (userId) => unusedCodesStmt.all(Number(userId)),
    useBackupCode: (id, nowIso) => useCodeStmt.run(nowIso, Number(id)).changes === 1,
    replaceBackupCodes: (userId, hashes) => replaceCodes(Number(userId), hashes),

    snooze: (userId, untilIso) => snoozeStmt.run(untilIso, Number(userId)),
    snoozedUntil: (userId) => ((snoozedStmt.get(Number(userId)) || {}).until || null),

    addEvent: (userId, event, actor, nowIso) => addEventStmt.run(Number(userId), nowIso, event, actor || ''),
    events: (userId, limit = 10) => eventsStmt.all(Number(userId), limit),
  };
}

let defaultModel = null;
module.exports = {
  ENCRYPTED_COLUMNS,
  buildModel,
  get default() {
    if (!defaultModel) defaultModel = buildModel(require('../database'));
    return defaultModel;
  },
};
