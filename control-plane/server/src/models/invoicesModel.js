/**
 * Invoices of a customer (specs/control-plane-plans-and-access.md rules 15, 17, 19, 34).
 *
 * - `manual`: a payment the operator recorded by hand, born `paid`.
 * - `qonto`: the renewal invoice. `pending` until Qonto holds both the invoice and its payment link
 *   (`lastError` says why not yet), then `open`, then `paid` or `cancelled`. The row exists before
 *   the Qonto calls, so a failure is retried on the same row and never creates a second invoice.
 */

function buildInvoicesModel(db) {
  const insertStmt = db.prepare(`INSERT INTO invoices (customerId, periodStart, periodEnd, months, amountCents, totalCents, provider, providerRef, payUrl, status, paidAt, paidBy, createdAt)
    VALUES (@customerId, @periodStart, @periodEnd, @months, @amountCents, @totalCents, @provider, @providerRef, @payUrl, @status, @paidAt, @paidBy, @createdAt)`);
  const getStmt = db.prepare('SELECT * FROM invoices WHERE id = ?');
  const listStmt = db.prepare('SELECT * FROM invoices WHERE customerId = ? ORDER BY id DESC');
  const openPayUrlStmt = db.prepare("SELECT payUrl FROM invoices WHERE customerId = ? AND status = 'open' AND payUrl IS NOT NULL ORDER BY id DESC LIMIT 1");
  const forPeriodStmt = db.prepare("SELECT * FROM invoices WHERE customerId = ? AND provider = 'qonto' AND periodStart = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1");
  const unsettledStmt = db.prepare("SELECT * FROM invoices WHERE customerId = ? AND provider = 'qonto' AND status IN ('pending', 'open') ORDER BY id DESC");
  const byStatusStmt = db.prepare("SELECT * FROM invoices WHERE provider = 'qonto' AND status = ? ORDER BY id");
  const byLinkStmt = db.prepare('SELECT * FROM invoices WHERE payLinkId = ?');
  const updateStmt = (cols) => db.prepare(`UPDATE invoices SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`);
  const failureStmt = db.prepare('INSERT OR IGNORE INTO payment_failures (providerPaymentId, invoiceId, status, at) VALUES (?, ?, ?, ?)');
  const recentFailuresStmt = db.prepare(`SELECT f.*, i.customerId, i.number FROM payment_failures f JOIN invoices i ON i.id = f.invoiceId
    WHERE f.at >= ? ORDER BY f.at`);
  const markPaidStmt = db.prepare("UPDATE invoices SET status = 'paid', paidAt = @paidAt, paidBy = @paidBy WHERE id = @id AND status IN ('open', 'pending')");

  return {
    insert: (invoice) => Number(insertStmt.run({
      months: null, totalCents: null, providerRef: null, payUrl: null, paidAt: null, paidBy: null, ...invoice,
    }).lastInsertRowid),
    get: (id) => getStmt.get(Number(id)),
    list: (customerId) => listStmt.all(customerId),
    openPayUrl: (customerId) => (openPayUrlStmt.get(customerId) || {}).payUrl || null,
    forPeriod: (customerId, periodStart) => forPeriodStmt.get(customerId, periodStart),
    unsettled: (customerId) => unsettledStmt.all(customerId),
    withStatus: (status) => byStatusStmt.all(status),
    byPayLink: (payLinkId) => byLinkStmt.get(String(payLinkId)),
    update: (id, fields) => updateStmt(Object.keys(fields)).run({ ...fields, id }),
    // Rule 34: a failed attempt is recorded once, whatever the number of passes that see it.
    recordFailure: ({ providerPaymentId, invoiceId, status, at }) => failureStmt.run(providerPaymentId, invoiceId, status, at).changes === 1,
    failuresSince: (at) => recentFailuresStmt.all(at),
    // Once only: the second detection of the same payment (webhook, then poll) changes nothing. A
    // pending invoice can be settled too, by a payment recorded by hand (rule 34).
    markPaid: ({ id, paidAt, paidBy }) => markPaidStmt.run({ id, paidAt, paidBy }).changes === 1,
  };
}

module.exports = { buildInvoicesModel };
