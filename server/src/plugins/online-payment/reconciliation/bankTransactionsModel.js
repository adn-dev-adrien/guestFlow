/**
 * The credits read from the bank account (specs/qonto-bank-reconciliation.md rule 6): only what the
 * matching needs, never the counterparty's IBAN. Upserted by the Qonto id, so a re-read is harmless.
 */

function createBankTransactionsModel(db) {
  const upsertStmt = db.prepare(`
    INSERT INTO bank_transactions (id, bankAccountId, amountCents, currency, settledAt, emittedAt, updatedAt,
      operationType, label, counterpartyName, reference, note, source, fetchedAt)
    VALUES (@id, @bankAccountId, @amountCents, @currency, @settledAt, @emittedAt, @updatedAt,
      @operationType, @label, @counterpartyName, @reference, @note, @source, @fetchedAt)
    ON CONFLICT(id) DO UPDATE SET
      bankAccountId = excluded.bankAccountId, amountCents = excluded.amountCents, currency = excluded.currency,
      settledAt = excluded.settledAt, emittedAt = excluded.emittedAt, updatedAt = excluded.updatedAt,
      operationType = excluded.operationType, label = excluded.label, counterpartyName = excluded.counterpartyName,
      reference = excluded.reference, note = excluded.note, source = excluded.source, fetchedAt = excluded.fetchedAt
  `);

  const clean = (v) => (v == null ? '' : String(v));

  return {
    upsertMany(rows, { bankAccountId, source = 'qonto', now = new Date() } = {}) {
      const fetchedAt = now.toISOString();
      db.transaction(() => {
        rows.forEach((t) => upsertStmt.run({
          id: String(t.id),
          bankAccountId: String(t.bankAccountId || bankAccountId || ''),
          amountCents: Math.round(Number(t.amountCents)),
          currency: clean(t.currency) || 'EUR',
          settledAt: t.settledAt || null,
          emittedAt: t.emittedAt || null,
          updatedAt: t.updatedAt || null,
          operationType: clean(t.operationType),
          label: clean(t.label),
          counterpartyName: clean(t.counterpartyName),
          reference: clean(t.reference),
          note: clean(t.note),
          source: t.source || source,
          fetchedAt,
        }));
      })();
      return rows.length;
    },

    /** Credits of one account, newest first. */
    listForAccount(bankAccountId) {
      return db.prepare('SELECT * FROM bank_transactions WHERE bankAccountId = ? ORDER BY settledAt DESC, id').all(String(bankAccountId));
    },

    get(id) {
      return db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(String(id)) || null;
    },

    latestSettledAt(bankAccountId) {
      const row = db.prepare('SELECT MAX(settledAt) AS at FROM bank_transactions WHERE bankAccountId = ?').get(String(bankAccountId));
      return row ? row.at : null;
    },

    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM bank_transactions').get().n;
    },
  };
}

module.exports = { createBankTransactionsModel };
