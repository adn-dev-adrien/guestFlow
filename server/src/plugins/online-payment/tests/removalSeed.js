// specs/plugin-removal-resilience.md rules 6, 11 — a paid and a cancelled payment link of the direct stay, an
// open deposit link of the sent quote, and a bank transaction reconciled to the stay.
module.exports = {
  seed(db, { stays, quote }) {
    const link = db.prepare(`INSERT INTO payment_links (reservationId, type, providerLinkId, url, amountCents, status, paidAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    link.run(stays.direct.id, 'deposit', 'pl_removal_paid', 'https://pay.example.test/pl_removal_paid', 18000, 'paid', '2030-01-02');
    link.run(stays.direct.id, 'balance', 'pl_removal_cancelled', 'https://pay.example.test/pl_removal_cancelled', 42000, 'cancelled', null);
    // The one the deposit reminder of the quote re-offers while a provider is live (rule 6).
    link.run(quote.id, 'deposit', 'pl_removal_open', 'https://pay.example.test/pl_removal_open', 18000, 'open', null);
    db.prepare(`INSERT INTO bank_transactions (id, bankAccountId, amountCents, currency, settledAt, label, counterpartyName, source, fetchedAt)
      VALUES ('tx-removal-1', 'acc-1', 18000, 'EUR', '2030-01-02', 'Acompte', 'Client Test', 'qonto', datetime('now'))`).run();
    db.prepare(`INSERT INTO bank_reconciliation_lines (transactionId, reservationId, ledgerKey, amountCents, createdAt)
      VALUES ('tx-removal-1', ?, 'deposit', 18000, datetime('now'))`).run(stays.direct.id);
  },
};
