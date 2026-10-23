/**
 * Decisions of the operator (specs/qonto-bank-reconciliation.md rules 11, 12, 17, 38): reconciliation
 * lines, discarded pairs, credits marked « Hors réservation », and what a confirmation wrote on a fiche.
 */

function createReconciliationModel(db) {
  const nowIso = () => new Date().toISOString();

  return {
    listLines() {
      return db.prepare('SELECT * FROM bank_reconciliation_lines ORDER BY id').all();
    },
    linesOfTransaction(transactionId) {
      return db.prepare('SELECT * FROM bank_reconciliation_lines WHERE transactionId = ? ORDER BY id').all(String(transactionId));
    },
    linesOfReceipt(reservationId, ledgerKey) {
      return db.prepare('SELECT * FROM bank_reconciliation_lines WHERE reservationId = ? AND ledgerKey = ? ORDER BY id')
        .all(Number(reservationId), String(ledgerKey));
    },
    addLine({ transactionId, reservationId, ledgerKey, amountCents, createdBy = null }) {
      return db.prepare(`INSERT INTO bank_reconciliation_lines (transactionId, reservationId, ledgerKey, amountCents, createdAt, createdBy)
        VALUES (?, ?, ?, ?, ?, ?)`).run(String(transactionId), Number(reservationId), String(ledgerKey), Math.round(amountCents), nowIso(), createdBy).lastInsertRowid;
    },
    removeLinesOfTransaction(transactionId) {
      return db.prepare('DELETE FROM bank_reconciliation_lines WHERE transactionId = ?').run(String(transactionId)).changes;
    },

    discardedKeys() {
      return new Set(db.prepare('SELECT transactionId, reservationId, ledgerKey FROM bank_reconciliation_discards').all()
        .map((d) => `${d.transactionId}|${d.reservationId}|${d.ledgerKey}`));
    },
    discard({ transactionId, reservationId, ledgerKey }) {
      db.prepare(`INSERT OR IGNORE INTO bank_reconciliation_discards (transactionId, reservationId, ledgerKey, createdAt) VALUES (?, ?, ?, ?)`)
        .run(String(transactionId), Number(reservationId), String(ledgerKey), nowIso());
    },

    outsideIds() {
      return new Set(db.prepare('SELECT transactionId FROM bank_transactions_outside').all().map((r) => r.transactionId));
    },
    markOutside(transactionId, createdBy = null) {
      db.prepare('INSERT OR IGNORE INTO bank_transactions_outside (transactionId, createdAt, createdBy) VALUES (?, ?, ?)')
        .run(String(transactionId), nowIso(), createdBy);
    },
    unmarkOutside(transactionId) {
      db.prepare('DELETE FROM bank_transactions_outside WHERE transactionId = ?').run(String(transactionId));
    },

    recordFicheWrite({ reservationId, ledgerKey, transactionIds, prior, written, createdBy = null }) {
      return db.prepare(`INSERT INTO bank_reconciliation_fiche_writes (reservationId, ledgerKey, transactionIds, priorJson, writtenJson, createdAt, createdBy)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(Number(reservationId), String(ledgerKey), JSON.stringify(transactionIds), JSON.stringify(prior), JSON.stringify(written), nowIso(), createdBy).lastInsertRowid;
    },
    /** The writes that involve a transaction, newest first. */
    ficheWritesOfTransaction(transactionId) {
      return db.prepare('SELECT * FROM bank_reconciliation_fiche_writes ORDER BY id DESC').all()
        .filter((w) => JSON.parse(w.transactionIds).includes(String(transactionId)))
        .map((w) => ({ ...w, transactionIds: JSON.parse(w.transactionIds), prior: JSON.parse(w.priorJson), written: JSON.parse(w.writtenJson) }));
    },
    deleteFicheWrite(id) {
      db.prepare('DELETE FROM bank_reconciliation_fiche_writes WHERE id = ?').run(Number(id));
    },

    countAll() {
      const n = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
      return { lines: n('bank_reconciliation_lines'), discards: n('bank_reconciliation_discards'), outside: n('bank_transactions_outside') };
    },
  };
}

module.exports = { createReconciliationModel };
