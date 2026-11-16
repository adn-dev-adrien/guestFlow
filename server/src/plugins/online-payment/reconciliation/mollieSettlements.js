/**
 * What Mollie says about a settlement, kept beside the bank credits (specs/mollie-rolling-reserve-and-incoming-payments.md
 * rules 10, 16-17): the settlement a Qonto credit's reference names, the payments it paid, and which GuestFlow payment
 * link each of them is. Read-only; nothing is ever written to Mollie.
 */

const MS_MINUTE = 60 * 1000;
const PAIRING_WINDOW_MS = 10 * MS_MINUTE;

const isMollieCredit = (tx) => /mollie/i.test(`${tx.counterpartyName || ''} ${tx.label || ''}`);

/** « REF T19274230.2611.01 » → « T19274230.2611.01 »: the settlement's bank reference. */
function settlementReferenceOf(tx) {
  const text = String((tx && tx.reference) || '').trim();
  const prefixed = /^REF\s+(\S+)/i.exec(text);
  if (prefixed) return prefixed[1];
  const bare = /\b([A-Za-z]?\d{5,}\.\d{4}\.\d{2})\b/.exec(text);
  return bare ? bare[1] : null;
}

/**
 * Rule 16 — the GuestFlow side of a Mollie payment, first match wins:
 * 1. its `description` is a link's `providerPaymentId` (the Qonto payment id);
 * 2. its `metadata.payment_link_id` is a link's `providerLinkId`;
 * 3. its `description` is a Qonto invoice number GuestFlow stores (a sale: no link, but known);
 * 4. same amount and `paidAt` within 10 minutes of a link's, when exactly one link fits.
 * @returns {{ kind: 'link', paymentLinkId: string } | { kind: 'sale' } | null}
 */
function pairPayment(payment, links, invoiceNumbers = new Set()) {
  const description = String(payment.description || '').trim();
  if (description) {
    const byPaymentId = links.find((l) => l.providerPaymentId && String(l.providerPaymentId) === description);
    if (byPaymentId) return { kind: 'link', paymentLinkId: String(byPaymentId.id) };
  }
  if (payment.paymentLinkId) {
    const byLinkId = links.find((l) => l.providerLinkId && String(l.providerLinkId) === String(payment.paymentLinkId));
    if (byLinkId) return { kind: 'link', paymentLinkId: String(byLinkId.id) };
  }
  if (description && invoiceNumbers.has(description)) return { kind: 'sale' };
  const at = Date.parse(payment.paidAt || '');
  if (Number.isFinite(at)) {
    const close = links.filter((l) => Number(l.amountCents) === payment.amountCents && l.paidAt
      && Math.abs(Date.parse(String(l.paidAt).includes('T') ? l.paidAt : `${String(l.paidAt).replace(' ', 'T')}Z`) - at) <= PAIRING_WINDOW_MS);
    if (close.length === 1) return { kind: 'link', paymentLinkId: String(close[0].id) };
  }
  return null;
}

function createSettlementsModel(db) {
  const upsertSettlement = db.prepare(`INSERT INTO mollie_settlements
    (id, reference, settledAt, amountCents, costsCents, reserveHeldCents, reserveReleasedCents, fetchedAt)
    VALUES (@id, @reference, @settledAt, @amountCents, @costsCents, @reserveHeldCents, @reserveReleasedCents, @fetchedAt)
    ON CONFLICT(id) DO UPDATE SET reference = excluded.reference, settledAt = excluded.settledAt, amountCents = excluded.amountCents,
      costsCents = excluded.costsCents, reserveHeldCents = excluded.reserveHeldCents,
      reserveReleasedCents = excluded.reserveReleasedCents, fetchedAt = excluded.fetchedAt`);
  const upsertPayment = db.prepare(`INSERT INTO mollie_settlement_payments
    (settlementId, molliePaymentId, amountCents, paidAt, description, paymentLinkId)
    VALUES (@settlementId, @molliePaymentId, @amountCents, @paidAt, @description, @paymentLinkId)
    ON CONFLICT(settlementId, molliePaymentId) DO UPDATE SET amountCents = excluded.amountCents, paidAt = excluded.paidAt,
      description = excluded.description, paymentLinkId = excluded.paymentLinkId`);

  return {
    hasReference(reference) {
      return Boolean(db.prepare('SELECT 1 FROM mollie_settlements WHERE reference = ?').get(String(reference)));
    },
    store(settlement, payments, now = new Date()) {
      db.transaction(() => {
        upsertSettlement.run({ ...settlement, fetchedAt: now.toISOString() });
        payments.forEach((p) => upsertPayment.run({
          settlementId: settlement.id, molliePaymentId: p.id, amountCents: p.amountCents, paidAt: p.paidAt,
          description: p.description, paymentLinkId: p.paymentLinkId,
        }));
      })();
    },
    /** reference → the settlement and its payments, for the matcher (rule 10). */
    byReference() {
      const payments = db.prepare('SELECT * FROM mollie_settlement_payments').all();
      return new Map(db.prepare('SELECT * FROM mollie_settlements').all().map((s) => [s.reference, {
        ...s,
        payments: payments.filter((p) => p.settlementId === s.id),
      }]));
    },
    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM mollie_settlements').get().n;
    },
  };
}

/**
 * Rule 16 — reads, for the stored Mollie credits whose settlement is not detailed yet, the settlement, its payments and
 * its costs / reserve lines, and attaches each payment to its link. One failure stops the read: what is stored stays
 * (rule 17), the error is the caller's to word.
 *
 * @param {object} deps
 * @param {object} deps.client      `mollieClient`
 * @param {object} deps.model       `createSettlementsModel`
 * @param {object} deps.splits      `createSplitsModel` (gets the payment id and the refunded amount)
 * @param {object[]} deps.credits   the stored bank credits
 * @param {object[]} deps.links     the paid payment links
 * @param {Set<string>} [deps.invoiceNumbers]  the Qonto invoice numbers GuestFlow stores
 * @param {string} [deps.profileId]
 * @returns {Promise<{ read: number, unknownPayments: number }>}
 */
async function syncSettlements({ client, model, splits, credits, links, invoiceNumbers = new Set(), profileId = '', now = new Date() }) {
  const references = [...new Set(credits.filter(isMollieCredit).map(settlementReferenceOf).filter(Boolean))]
    .filter((reference) => !model.hasReference(reference));
  let read = 0;
  let unknownPayments = 0;
  for (const reference of references) {
    // eslint-disable-next-line no-await-in-loop
    const settlement = await client.getSettlement(reference);
    // eslint-disable-next-line no-await-in-loop
    const payments = await client.listSettlementPayments(settlement.id, { profileId });
    const paired = payments.map((p) => ({ ...p, pairing: pairPayment(p, links, invoiceNumbers) }));
    // A payment paired with a Qonto invoice number is known to GuestFlow but has no link: `sale:<number>`.
    const keyOf = (p) => (!p.pairing ? null : (p.pairing.kind === 'link' ? p.pairing.paymentLinkId : `sale:${p.description}`));
    model.store({ ...settlement, reference }, paired.map((p) => ({ ...p, paymentLinkId: keyOf(p) })), now);
    paired.forEach((p) => {
      if (!p.pairing) unknownPayments += 1;
      if (p.pairing && p.pairing.kind === 'link') {
        splits.setMolliePayment(p.pairing.paymentLinkId, p.id);
        splits.setRefunded(p.pairing.paymentLinkId, p.refundedCents);
      }
    });
    read += 1;
  }
  return { read, unknownPayments };
}

module.exports = { isMollieCredit, settlementReferenceOf, pairPayment, createSettlementsModel, syncSettlements };
