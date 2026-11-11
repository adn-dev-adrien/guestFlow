/**
 * The invoice issuer (specs/resource-booking-pricing-and-invoicing.md rules 1-2, 14, 17). A plugin declares one with
 * `ctx.invoiceIssuer`; a plugin that sells asks for it here and never requires the issuer's plugin, so neither depends
 * on the other.
 *
 * Issuer contract (every member async but `id` and `isReady`):
 *   id                                 → the issuing plugin's id
 *   isReady()                          → true when an invoice can be issued now (connected, with the scopes)
 *   issue(request)                     → { invoiceId, number, totalCents, clientId } — request: { idempotencyKey,
 *                                        client: { lastName, firstName, street, postcode, city, countryCode, clientId },
 *                                        issueDate, performanceDate, items: [{ title, amountCents, vatRate }],
 *                                        discount: { title, amountCents, vatRate } | null, expectedTotalCents, paid }
 *   findCardBatch(date)                → { transactionId, settledAt } | null — the day's on-site card credit
 *   attach({ invoiceId, transactionId, idempotencyKey }) → { attachmentId }
 *   invoiceStatus(invoiceId)           → 'paid' | 'unpaid' | 'canceled' | …
 *   markPaid({ invoiceId, paidAt })    → { done } — optional (rule 38): « marquer payée » tried again after `issue`
 *                                        answered `markPending: true`; `done: false` when the issuer does not offer it
 *
 * `issue` answers `markPending: true` when the invoice is numbered but « marquer payée » failed: the invoice is kept.
 * Refusals are thrown as errors carrying `code`: `ISSUER_NEEDS_ADDRESS`, `ISSUER_REAUTH`, `ISSUER_AMOUNT_MISMATCH`,
 * `ISSUER_AMOUNT_UNREACHABLE`.
 */

const registry = require('../plugins/sdk/registry');

function current() {
  const record = registry.all().find((r) => r.invoiceIssuer && registry.isLive(r.id));
  return record ? record.invoiceIssuer : null;
}

// Rule 2 — offered only while its plugin is live and connected.
function ready() {
  const issuer = current();
  if (!issuer) return false;
  try { return Boolean(issuer.isReady()); } catch { return false; }
}

module.exports = { current, ready };
