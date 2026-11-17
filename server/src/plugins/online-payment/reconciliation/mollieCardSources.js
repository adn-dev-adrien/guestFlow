/**
 * The card payments that go through Mollie WITHOUT a GuestFlow payment link (specs/mollie-rolling-reserve-and-incoming-payments.md
 * rule 1, second half): a payment taken with the Qonto app (Tap to Pay) or a Qonto invoice paid by card is acquired by Mollie
 * like a link, so it reaches the account in two credits as well.
 *
 * Two kinds of source, each with a stable key (`mollie_payment_splits`):
 *   - `invoice`  a sale outside a stay that holds a Qonto invoice number: the key is the number, which is also the
 *                `description` of the Mollie payment — the exact way to pair them (rule 16);
 *   - `tender`   a card tender recorded on a fiche (an instalment paid by card, a split payment's CB line) or on a sale
 *                with no invoice: an estimate from the date of the setting « CB sur place via Mollie depuis ».
 * This module only READS what GuestFlow records; the splits model stores, the receipts build from both.
 */

const sdk = require('../../sdk');
const { day } = require('./dates');
const { SOURCE_TYPES } = require('./molliePaymentSplits');

/** The ledger row a split payment's settlement is printed under (null: no row of the ledger carries it). */
function settlementLedgerRow(settlement, installments) {
  if (settlement.targetKind === 'installment') {
    const found = installments.find((i) => String(i.id) === String(settlement.targetKey));
    return found ? `installment-${found.number}` : null;
  }
  if (settlement.targetKind === 'midStayNote') return 'midStayNotes';
  if (settlement.targetKind === 'bucket') {
    const part = (settlement.parts || [])[0];
    return part ? part.kind : null;
  }
  return null;
}

/** What a sale outside a stay is, as a Mollie source. */
function saleSource(sale) {
  const invoiceNumber = sale.invoiceNumber ? String(sale.invoiceNumber) : null;
  return {
    sourceType: invoiceNumber ? SOURCE_TYPES.invoice : SOURCE_TYPES.tender,
    sourceKey: invoiceNumber || `sale:${sale.key}`,
    reservationId: null, ledgerKey: `sale:${sale.key}`,
    grossCents: Number(sale.cardCents) || 0, paidAt: sale.date, sale,
  };
}

/** Every sale outside a stay since `from`, with the source it would be. */
function salesSince(from, to) {
  return sdk.coreModule('standaloneSales').list({ from, to }).map(saleSource);
}

/**
 * Rule 16 — the Qonto invoices GuestFlow holds (sales outside a stay), by number: what a Mollie payment's `description`
 * is looked up in. Every invoice counts, whatever tender was typed: the Mollie payment is the proof of the card.
 */
function invoiceSources(today) {
  return new Map(salesSince('2020-01-01', today).filter((s) => s.sale.invoiceNumber)
    .map((s) => [String(s.sale.invoiceNumber), { sourceType: s.sourceType, sourceKey: s.sourceKey, reservationId: null, ledgerKey: s.ledgerKey }]));
}

/**
 * Rule 1 — the card payments recorded on site that a split may be stored for: the sales outside a stay paid by card, the
 * instalments of a plan paid by card, the CB lines of a split payment. Whether the day is late enough (the setting) is the
 * splits model's call.
 *
 * @param {object} deps
 * @param {object[]} deps.rows               the in-scope reservations (stored rows)
 * @param {(id) => object[]} deps.linksOf
 * @param {(id) => object[]} deps.installmentsOf
 * @param {(id) => object[]} deps.settlementsOf
 * @param {string} deps.startDate            the reconciliation start date
 * @param {string} deps.today
 */
function cardCandidates({ rows, linksOf, installmentsOf, settlementsOf, startDate, today }) {
  const out = [];
  rows.forEach((row) => {
    if (String(row.platform || 'direct').trim().toLowerCase() !== 'direct') return;
    const installments = installmentsOf(row.id);
    const settlements = settlementsOf(row.id);
    const settledInstallments = new Set(settlements.filter((s) => s.targetKind === 'installment').map((s) => String(s.targetKey)));
    const links = linksOf(row.id);
    installments.forEach((i) => {
      if (Number(i.paid) !== 1 || i.paidMethod !== 'card' || settledInstallments.has(String(i.id))) return;
      if (links.some((l) => l.status === 'paid' && l.type === 'installment' && Number(l.installmentId) === Number(i.id))) return;
      out.push({
        sourceType: SOURCE_TYPES.tender, sourceKey: `installment:${i.id}`, reservationId: Number(row.id),
        ledgerKey: `installment-${i.number}`, grossCents: Number(i.amountCents), paidAt: day(i.paidDate),
      });
    });
    settlements.forEach((s) => {
      const card = (s.tenders || []).filter((t) => t.method === 'card' && Number(t.internal) !== 1).reduce((sum, t) => sum + Number(t.amountCents || 0), 0);
      if (card > 0) {
        out.push({
          sourceType: SOURCE_TYPES.tender, sourceKey: `settlement:${s.id}`, reservationId: Number(row.id),
          ledgerKey: `settlement-${s.id}-card`, grossCents: card, paidAt: day(s.paidDate),
        });
      }
    });
  });
  salesSince(startDate, today).filter((s) => s.grossCents > 0).forEach((s) => {
    const { sale, ...candidate } = s;
    out.push(candidate);
  });
  return out;
}

module.exports = { cardCandidates, salesSince, saleSource, invoiceSources, settlementLedgerRow };
