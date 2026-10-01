/**
 * Provider-neutral payment links (specs/plugins-phase-3a-online-payment.md rules 6, 8, 20).
 *
 * Qonto is one payment provider among possible others: its two id columns take neutral names, every
 * existing row is a Qonto one, and a link GuestFlow abandoned but could not deactivate remotely carries
 * `remoteCancelPendingAt` until the poll manages it. Idempotent: a renamed table is left as it is.
 */
function migratePaymentLinksToProviders(db) {
  const cols = db.prepare('PRAGMA table_info(payment_links)').all().map((c) => c.name);
  if (cols.length === 0) return;
  if (cols.includes('qontoPaymentLinkId')) db.exec('ALTER TABLE payment_links RENAME COLUMN qontoPaymentLinkId TO providerLinkId');
  if (cols.includes('qontoPaymentId')) db.exec('ALTER TABLE payment_links RENAME COLUMN qontoPaymentId TO providerPaymentId');
  if (!cols.includes('provider')) db.exec("ALTER TABLE payment_links ADD COLUMN provider TEXT NOT NULL DEFAULT 'qonto'");
  if (!cols.includes('remoteCancelPendingAt')) db.exec('ALTER TABLE payment_links ADD COLUMN remoteCancelPendingAt TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_payment_links_provider ON payment_links(provider, providerLinkId)');
}

module.exports = { migratePaymentLinksToProviders };
