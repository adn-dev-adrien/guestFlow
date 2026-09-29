/**
 * Invoices of a customer. In C2a the only provider is `manual`: a payment the operator records by
 * hand (rule 19). C2b adds the Qonto invoice and its payment link.
 */

function buildInvoicesModel(db) {
  const insertStmt = db.prepare(`INSERT INTO invoices (customerId, periodStart, periodEnd, amountCents, provider, providerRef, payUrl, status, paidAt, createdAt)
    VALUES (@customerId, @periodStart, @periodEnd, @amountCents, @provider, @providerRef, @payUrl, @status, @paidAt, @createdAt)`);
  const listStmt = db.prepare('SELECT * FROM invoices WHERE customerId = ? ORDER BY id DESC');
  const openPayUrlStmt = db.prepare("SELECT payUrl FROM invoices WHERE customerId = ? AND status = 'open' AND payUrl IS NOT NULL ORDER BY id DESC LIMIT 1");
  return {
    insert: (invoice) => Number(insertStmt.run({ providerRef: null, payUrl: null, paidAt: null, ...invoice }).lastInsertRowid),
    list: (customerId) => listStmt.all(customerId),
    openPayUrl: (customerId) => (openPayUrlStmt.get(customerId) || {}).payUrl || null,
  };
}

module.exports = { buildInvoicesModel };
