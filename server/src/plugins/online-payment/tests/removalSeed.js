// specs/plugin-removal-resilience.md rule 11 — a paid and a cancelled payment link of the direct stay, and a
// bank transaction reconciled to it.
module.exports = {
  seed(db, { stays }) {
    const link = db.prepare(`INSERT INTO payment_links (reservationId, type, providerLinkId, url, amountCents, status, paidAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    link.run(stays.direct.id, 'deposit', 'pl_removal_paid', 'https://pay.example.test/pl_removal_paid', 18000, 'paid', '2030-01-02');
    link.run(stays.direct.id, 'balance', 'pl_removal_cancelled', 'https://pay.example.test/pl_removal_cancelled', 42000, 'cancelled', null);
    db.prepare(`INSERT INTO bank_transactions (id, bankAccountId, amountCents, currency, settledAt, label, counterpartyName, source, fetchedAt)
      VALUES ('tx-removal-1', 'acc-1', 18000, 'EUR', '2030-01-02', 'Acompte', 'Client Test', 'qonto', datetime('now'))`).run();
    db.prepare(`INSERT INTO bank_reconciliation_lines (transactionId, reservationId, ledgerKey, amountCents, createdAt)
      VALUES ('tx-removal-1', ?, 'deposit', 18000, datetime('now'))`).run(stays.direct.id);
  },
};
