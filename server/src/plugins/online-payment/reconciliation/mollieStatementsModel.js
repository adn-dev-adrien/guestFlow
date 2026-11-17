/**
 * What became of the statement of each Mollie credit (specs/mollie-settlement-receipts.md §5): one row per Qonto
 * credit, its state and the attempts made. Rows are written by the statements job only; nothing here talks to Mollie
 * or Qonto.
 */

const { isMollieCredit, settlementReferenceOf } = require('./mollieSettlements');
const { day } = require('./dates');

const STATES = Object.freeze({ pending: 'pending', attached: 'attached', mismatch: 'mismatch', failed: 'failed', reauth: 'reauth' });

function createMollieStatementsModel(db) {
  const upsert = (row) => db.prepare(`INSERT INTO mollie_settlement_statements
    (transactionId, settlementId, state, attempts, lastError, attachmentId, attachedAt, firstAttemptAt, updatedAt)
    VALUES (@transactionId, @settlementId, @state, @attempts, @lastError, @attachmentId, @attachedAt, @firstAttemptAt, @updatedAt)
    ON CONFLICT(transactionId) DO UPDATE SET settlementId = excluded.settlementId, state = excluded.state,
      attempts = excluded.attempts, lastError = excluded.lastError, attachmentId = excluded.attachmentId,
      attachedAt = excluded.attachedAt, firstAttemptAt = COALESCE(mollie_settlement_statements.firstAttemptAt, excluded.firstAttemptAt),
      updatedAt = excluded.updatedAt
    WHERE mollie_settlement_statements.state <> 'attached'`).run(row);

  return {
    get(transactionId) {
      return db.prepare('SELECT * FROM mollie_settlement_statements WHERE transactionId = ?').get(String(transactionId)) || null;
    },

    /** Writes the row as given; `attempts` and the attachment are kept unless the caller states them. An `attached` row is never overwritten. */
    save(transactionId, settlementId, fields, now = new Date()) {
      const before = this.get(transactionId);
      upsert({
        transactionId: String(transactionId), settlementId: String(settlementId), state: STATES.pending, attempts: 0,
        lastError: null, attachmentId: null, attachedAt: null,
        ...(before || {}), ...fields, firstAttemptAt: (before && before.firstAttemptAt) || now.toISOString(), updatedAt: now.toISOString(),
      });
      return this.get(transactionId);
    },

    /** Rule 7 — the moment of the first attempt, fixed once so every render of the statement is the same bytes. */
    firstAttemptAt(transactionId, settlementId, now = new Date()) {
      const before = this.get(transactionId);
      return (before && before.firstAttemptAt) || this.save(transactionId, settlementId, {}, now).firstAttemptAt;
    },

    /**
     * Rule 4 — the Qonto credits that may carry a statement, oldest first: credited, Mollie's, settled on or after `since`.
     * Each is paired with its settlement, `settlementOf(reference)` (`null` while the settlement read has not stored it).
     */
    candidates({ since, settlementOf }) {
      if (!day(since)) return [];
      return db.prepare("SELECT * FROM bank_transactions WHERE source = 'qonto' AND amountCents > 0 ORDER BY settledAt, id")
        .all()
        .filter((tx) => isMollieCredit(tx) && (day(tx.settledAt) || '') >= day(since))
        .map((tx) => {
          const reference = settlementReferenceOf(tx);
          return { tx, settlement: reference ? settlementOf(reference) : null };
        });
    },

    /** Rule 9 — a credit with no row yet, or still pending, becomes `reauth`; every other state is left as it is. */
    markReauth(entries, message, now = new Date()) {
      db.transaction(() => entries.forEach(({ tx, settlement }) => {
        const row = this.get(tx.id);
        if (row && row.state !== STATES.pending) return;
        this.save(tx.id, settlement.id, { state: STATES.reauth, lastError: message }, now);
      }))();
    },

    rows() {
      return db.prepare('SELECT * FROM mollie_settlement_statements').all();
    },
  };
}

module.exports = { createMollieStatementsModel, STATES };
