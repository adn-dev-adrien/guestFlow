/**
 * Guest email send ledger — sole DB access for `guest_email_sends` (specs/guest-email-sequence.md
 * §3.3 rules 11-14 + §5).
 *
 * One row per dedup key, never purged. The UNIQUE `dedupKey` is the whole idempotence guarantee:
 * `claim` is a single INSERT … ON CONFLICT statement, so two concurrent paths on the same key cannot
 * both win — whichever inserts first owns the send, the other gets `false` and sends nothing.
 *
 * API:
 *   claim({ dedupKey, stableKey, reservationId?, clientId?, seasonKey? }) → boolean
 *       true when this call now owns the key: a fresh row, or a `failed` row re-claimed. A `claimed`,
 *       `sent` or `skipped` row is never re-claimed.
 *   markSent(dedupKey, { recipientEmail, emailLogId }) / markFailed(dedupKey, errorMessage)
 *   recordOutsideSend({ …claim fields, status: 'sent'|'skipped', recipientEmail, note }) → boolean
 *       the operator marked the email as sent by hand, or chose to skip it: the key is closed so the
 *       sequence never sends it afterwards. A no-op when the key is already closed.
 *   findByKey(dedupKey) → row | undefined
 *   findByKeys(keys[]) → Map(dedupKey → row)
 *   nextResendKey(dedupKey) → "<dedupKey>:resend:<n>" (rule 13bis)
 *   countPostStayContacts(clientId, sinceIso) → number of post-stay emails sent to the client since
 *       that instant, deliberate resends excluded (rule 8)
 *   listStaleClaims(olderThanMinutes) → rows stuck in `claimed` (rule 14)
 */

const { POST_STAY_STABLE_KEYS } = require('../utils/guestEmailSequence');

const RESEND_MARK = ':resend:';

function buildModel(database) {
  const claimStmt = database.prepare(`
    INSERT INTO guest_email_sends (dedupKey, stableKey, reservationId, clientId, seasonKey, status)
    VALUES (@dedupKey, @stableKey, @reservationId, @clientId, @seasonKey, 'claimed')
    ON CONFLICT(dedupKey) DO UPDATE SET
      status = 'claimed', claimedAt = datetime('now'), errorMessage = ''
    WHERE guest_email_sends.status = 'failed'
  `);
  const markSentStmt = database.prepare(`
    UPDATE guest_email_sends
       SET status = 'sent', sentAt = datetime('now'), recipientEmail = @recipientEmail,
           emailLogId = @emailLogId, errorMessage = ''
     WHERE dedupKey = @dedupKey
  `);
  const markFailedStmt = database.prepare(`
    UPDATE guest_email_sends SET status = 'failed', errorMessage = @errorMessage WHERE dedupKey = @dedupKey
  `);
  const findStmt = database.prepare('SELECT * FROM guest_email_sends WHERE dedupKey = ?');
  const countResendsStmt = database.prepare('SELECT COUNT(*) AS n FROM guest_email_sends WHERE dedupKey LIKE ?');

  function claim({ dedupKey, stableKey, reservationId = null, clientId = null, seasonKey = null }) {
    const info = claimStmt.run({
      dedupKey: String(dedupKey),
      stableKey: String(stableKey),
      reservationId: reservationId == null ? null : Number(reservationId),
      clientId: clientId == null ? null : Number(clientId),
      seasonKey: seasonKey == null ? null : String(seasonKey),
    });
    return info.changes > 0;
  }

  function markSent(dedupKey, { recipientEmail = '', emailLogId = null } = {}) {
    markSentStmt.run({
      dedupKey: String(dedupKey),
      recipientEmail: String(recipientEmail || ''),
      emailLogId: emailLogId == null ? null : Number(emailLogId),
    });
  }

  function markFailed(dedupKey, errorMessage) {
    markFailedStmt.run({ dedupKey: String(dedupKey), errorMessage: String(errorMessage || 'unknown') });
  }

  function recordOutsideSend({ dedupKey, stableKey, reservationId = null, clientId = null, seasonKey = null, status, recipientEmail = '', note = '' }) {
    if (!claim({ dedupKey, stableKey, reservationId, clientId, seasonKey })) return false;
    database.prepare(`
      UPDATE guest_email_sends
         SET status = @status, sentAt = datetime('now'), recipientEmail = @recipientEmail, errorMessage = @note
       WHERE dedupKey = @dedupKey
    `).run({ dedupKey: String(dedupKey), status: status === 'skipped' ? 'skipped' : 'sent', recipientEmail: String(recipientEmail || ''), note: String(note || '') });
    return true;
  }

  function findByKey(dedupKey) {
    return findStmt.get(String(dedupKey));
  }

  function findByKeys(keys) {
    const map = new Map();
    const list = [...new Set((keys || []).map(String))];
    // Chunked so a long simulation range never exceeds SQLite's bound-parameter limit.
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      const rows = database.prepare(
        `SELECT * FROM guest_email_sends WHERE dedupKey IN (${chunk.map(() => '?').join(', ')})`
      ).all(...chunk);
      for (const row of rows) map.set(row.dedupKey, row);
    }
    return map;
  }

  function nextResendKey(dedupKey) {
    const base = String(dedupKey);
    const { n } = countResendsStmt.get(`${base}${RESEND_MARK}%`);
    return `${base}${RESEND_MARK}${Number(n) + 1}`;
  }

  function countPostStayContacts(clientId, sinceIso) {
    const keys = POST_STAY_STABLE_KEYS;
    const row = database.prepare(`
      SELECT COUNT(*) AS n FROM guest_email_sends
       WHERE clientId = ? AND status = 'sent' AND sentAt >= ?
         AND stableKey IN (${keys.map(() => '?').join(', ')})
         AND dedupKey NOT LIKE ?
    `).get(Number(clientId), String(sinceIso), ...keys, `%${RESEND_MARK}%`);
    return Number(row.n);
  }

  function listStaleClaims(olderThanMinutes = 60) {
    return database.prepare(`
      SELECT * FROM guest_email_sends
       WHERE status = 'claimed' AND claimedAt <= datetime('now', ?)
    `).all(`-${Number(olderThanMinutes)} minutes`);
  }

  return { claim, markSent, markFailed, recordOutsideSend, findByKey, findByKeys, nextResendKey, countPostStayContacts, listStaleClaims };
}

const defaultModel = (() => {
  try {
    return buildModel(require('../database'));
  } catch {
    return null;
  }
})();

if (defaultModel) {
  defaultModel.buildModel = buildModel;
  module.exports = defaultModel;
} else {
  module.exports = { buildModel };
}
