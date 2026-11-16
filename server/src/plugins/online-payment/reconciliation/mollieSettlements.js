/**
 * What Mollie says about a settlement, kept beside the bank credits (specs/mollie-rolling-reserve-and-incoming-payments.md
 * rules 10, 16-17): the settlement a Qonto credit's reference names, the payments it paid, and which GuestFlow payment
 * link each of them is. Read-only; nothing is ever written to Mollie.
 */

const { splitIdOf, SOURCE_TYPES } = require('./molliePaymentSplits');

const MS_MINUTE = 60 * 1000;
const PAIRING_WINDOW_MS = 10 * MS_MINUTE;

const isMollieCredit = (tx) => /mollie/i.test(`${tx.counterpartyName || ''} ${tx.label || ''}`);

/** « REF T19274230.2611.01 » → « T19274230.2611.01 »: the reference as the bank prints it. */
function settlementReferenceOf(tx) {
  const text = String((tx && tx.reference) || '').trim();
  const prefixed = /^REF\s+(\S+)/i.exec(text);
  if (prefixed) return prefixed[1];
  const bare = /\b([A-Za-z]?\d{5,}\.\d{4}\.\d{2})\b/.exec(text);
  return bare ? bare[1] : null;
}

/**
 * Rule 16 — the reference Mollie knows a settlement by: the bank prints « REF T19274230.2611.01 », Mollie's settlement
 * reference is « 19274230.2611.01 » (measured 2026-11-16). « REF » and a leading « T » are stripped; a reference already
 * in Mollie's form is returned as is.
 */
function normalizeReference(reference) {
  const text = String(reference || '').trim().replace(/^REF\s+/i, '');
  return text.replace(/^T(?=\d)/i, '');
}

/**
 * Rule 16 — the GuestFlow side of a Mollie payment, first match wins:
 * 1. its `description` is a link's `providerPaymentId` (the Qonto payment id);
 * 2. its `metadata.payment_link_id` is a link's `providerLinkId`;
 * 3. its `description` is a Qonto invoice number GuestFlow stores (a sale outside a stay paid by card): the payment IS
 *    that sale's card payment, gross and date exact;
 * 4. same amount and `paidAt` within 10 minutes of a link's, when exactly one link fits.
 * @param {Map<string, object>} [invoiceSources]  invoice number → its source (`invoiceSources` of `mollieCardSources`)
 * @returns {{ kind: 'link', paymentLinkId: string } | { kind: 'invoice', number: string, source: object } | null}
 */
function pairPayment(payment, links, invoiceSources = new Map()) {
  const description = String(payment.description || '').trim();
  if (description) {
    const byPaymentId = links.find((l) => l.providerPaymentId && String(l.providerPaymentId) === description);
    if (byPaymentId) return { kind: 'link', paymentLinkId: String(byPaymentId.id) };
  }
  if (payment.paymentLinkId) {
    const byLinkId = links.find((l) => l.providerLinkId && String(l.providerLinkId) === String(payment.paymentLinkId));
    if (byLinkId) return { kind: 'link', paymentLinkId: String(byLinkId.id) };
  }
  if (description && invoiceSources.has(description)) return { kind: 'invoice', number: description, source: invoiceSources.get(description) };
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
    (id, reference, settledAt, amountCents, costsCents, reserveHeldCents, reserveReleasedCents, source, fetchedAt)
    VALUES (@id, @reference, @settledAt, @amountCents, @costsCents, @reserveHeldCents, @reserveReleasedCents, @source, @fetchedAt)
    ON CONFLICT(id) DO UPDATE SET reference = excluded.reference, settledAt = excluded.settledAt, amountCents = excluded.amountCents,
      costsCents = excluded.costsCents, reserveHeldCents = excluded.reserveHeldCents,
      reserveReleasedCents = excluded.reserveReleasedCents, source = excluded.source, fetchedAt = excluded.fetchedAt`);
  const upsertPayment = db.prepare(`INSERT INTO mollie_settlement_payments
    (settlementId, molliePaymentId, kind, amountCents, grossCents, reserveCents, feeCents, paidAt, description, splitId)
    VALUES (@settlementId, @molliePaymentId, @kind, @amountCents, @grossCents, @reserveCents, @feeCents, @paidAt, @description, @splitId)
    ON CONFLICT(settlementId, molliePaymentId, kind) DO UPDATE SET amountCents = excluded.amountCents, grossCents = excluded.grossCents,
      reserveCents = excluded.reserveCents, feeCents = excluded.feeCents, paidAt = excluded.paidAt,
      description = excluded.description, splitId = excluded.splitId`);
  const upsertBalance = db.prepare(`INSERT OR REPLACE INTO mollie_balance_transactions
    (id, type, createdAt, resultCents, initialCents, deductionsCents, settlementId, paymentId, description)
    VALUES (@id, @type, @createdAt, @resultCents, @initialCents, @deductionsCents, @settlementId, @paymentId, @description)`);

  return {
    hasReference(reference) {
      return Boolean(db.prepare('SELECT 1 FROM mollie_settlements WHERE reference = ?').get(normalizeReference(reference)));
    },
    store(settlement, payments, now = new Date()) {
      db.transaction(() => {
        upsertSettlement.run({ source: 'payments', ...settlement, fetchedAt: now.toISOString() });
        payments.forEach((p) => upsertPayment.run({
          settlementId: settlement.id, molliePaymentId: p.id, kind: p.kind || 'immediate', amountCents: p.amountCents,
          grossCents: p.grossCents == null ? p.amountCents : p.grossCents, reserveCents: p.reserveCents == null ? null : p.reserveCents,
          feeCents: p.feeCents == null ? null : p.feeCents, paidAt: p.paidAt || null, description: p.description || '', splitId: p.splitId || null,
        }));
      })();
    },
    /** reference (Mollie's form) → the settlement and its payments, for the matcher (rule 10). */
    byReference() {
      const payments = db.prepare('SELECT * FROM mollie_settlement_payments').all();
      return new Map(db.prepare('SELECT * FROM mollie_settlements').all().map((s) => [normalizeReference(s.reference), {
        ...s,
        payments: payments.filter((p) => p.settlementId === s.id),
      }]));
    },
    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM mollie_settlements').get().n;
    },
    /** Rule 5 — the fees Mollie really took of a payment, once every settlement that paid it states them. */
    realFees() {
      const rows = db.prepare(`SELECT splitId, SUM(feeCents) AS fee, COUNT(*) - COUNT(feeCents) AS unknown FROM mollie_settlement_payments
        WHERE kind = 'immediate' AND splitId IS NOT NULL GROUP BY splitId`).all();
      return new Map(rows.filter((r) => Number(r.unknown) === 0).map((r) => [r.splitId, Number(r.fee) || 0]));
    },
    knowsBalanceTransaction(id) {
      return Boolean(db.prepare('SELECT 1 FROM mollie_balance_transactions WHERE id = ?').get(String(id)));
    },
    storeBalanceTransactions(list) {
      db.transaction(() => list.forEach((t) => upsertBalance.run({ ...t, createdAt: t.createdAt || '' })))();
    },
    /**
     * Rule 10 — what a settlement paid, exactly: the payments and reserve releases that became available since the
     * previous outgoing transfer, up to the one that names the settlement. `null` when the transfer was never read.
     */
    compositionOf(settlementId) {
      const transfer = db.prepare("SELECT createdAt FROM mollie_balance_transactions WHERE type = 'outgoing-transfer' AND settlementId = ?").get(String(settlementId));
      if (!transfer) return null;
      const { at } = db.prepare("SELECT MAX(createdAt) AS at FROM mollie_balance_transactions WHERE type = 'outgoing-transfer' AND createdAt < ?").get(transfer.createdAt);
      const rows = db.prepare(`SELECT * FROM mollie_balance_transactions
        WHERE type IN ('payment', 'api-payment-rolling-reserve-release') AND paymentId IS NOT NULL AND createdAt > ? AND createdAt <= ?
        ORDER BY createdAt, id`).all(at || '', transfer.createdAt);
      return rows.length > 0 ? rows : null;
    },
  };
}

/**
 * Rule 16 — reads, for the stored Mollie credits whose settlement is not detailed yet, the settlement and what it paid.
 * The balance transactions are the exact source (a payment's immediate share, a reserve release carrying its payment id);
 * a settlement they cannot compose — the token cannot read balances — falls back on the settlement's payments list. Each
 * payment is attached to its link or invoice, and the reserve Mollie really held corrects the stored split. One failure
 * stops the read: what is stored stays (rule 17), the error is the caller's to word.
 *
 * @param {object} deps
 * @param {object} deps.client      `mollieClient`
 * @param {object} deps.model       `createSettlementsModel`
 * @param {object} deps.splits      `createSplitsModel` (gets the payment id, the refunded amount and the real reserve; an invoice's payment creates its split)
 * @param {object} [deps.settings]  ctx.settings, read for the reserve of a split an invoice's payment creates
 * @param {object[]} deps.credits   the stored bank credits
 * @param {object[]} deps.links     the paid payment links
 * @param {Map<string, object>} [deps.invoiceSources]  the Qonto invoices GuestFlow stores, by number
 * @param {string} [deps.profileId]
 * @returns {Promise<{ read: number, unknownPayments: number, balances: boolean }>}
 */
async function syncSettlements({ client, model, splits, settings, credits, links, invoiceSources = new Map(), profileId = '', now = new Date() }) {
  const references = [...new Set(credits.filter(isMollieCredit).map(settlementReferenceOf).filter(Boolean).map(normalizeReference))]
    .filter((reference) => !model.hasReference(reference));
  let balances = false;
  if (references.length > 0 && typeof client.listBalanceTransactions === 'function') {
    try {
      model.storeBalanceTransactions(await client.listBalanceTransactions({ isKnown: (id) => model.knowsBalanceTransaction(id) }));
      balances = true;
    } catch { balances = false; }
  }
  const splitIdOfPairing = (pairing) => (!pairing ? null
    : (pairing.kind === 'link' ? splitIdOf(SOURCE_TYPES.link, pairing.paymentLinkId) : splitIdOf(SOURCE_TYPES.invoice, pairing.number)));
  // Attaches a Mollie payment to its GuestFlow source and returns the split it is.
  const attach = (payment, pairing) => {
    if (!pairing) return null;
    if (pairing.kind === 'link') {
      splits.setMolliePayment(SOURCE_TYPES.link, pairing.paymentLinkId, payment.id);
      splits.setRefunded(SOURCE_TYPES.link, pairing.paymentLinkId, payment.refundedCents);
    } else {
      splits.fromMolliePayment(pairing.source, payment, { settings, now });
    }
    return splitIdOfPairing(pairing);
  };

  let read = 0;
  let unknownPayments = 0;
  for (const reference of references) {
    // eslint-disable-next-line no-await-in-loop
    const settlement = await client.getSettlement(reference);
    const composition = balances ? model.compositionOf(settlement.id) : null;
    let rows;
    if (composition) {
      // eslint-disable-next-line no-await-in-loop
      rows = await composeFromBalance({ composition, settlement, client, splits, links, invoiceSources, attach });
    } else {
      // eslint-disable-next-line no-await-in-loop
      const payments = await client.listSettlementPayments(settlement.id, { profileId });
      rows = payments.map((p) => ({
        id: p.id, kind: 'immediate', amountCents: p.amountCents, grossCents: p.amountCents, paidAt: p.paidAt, description: p.description,
        splitId: attach(p, pairPayment(p, links, invoiceSources)),
      }));
    }
    model.store({ ...settlement, reference, source: composition ? 'balance' : 'payments' }, rows, now);
    rows.forEach((r) => {
      if (!r.splitId) unknownPayments += 1;
      else if (r.kind === 'immediate' && r.reserveCents != null) splits.correctReserve(r.splitId, r.reserveCents);
    });
    read += 1;
  }
  return { read, unknownPayments, balances };
}

/**
 * Rule 10 — the rows of a settlement composed from the balance transactions it paid. A `payment` is the immediate share
 * of that payment (`resultAmount`) out of its gross (`initialAmount`); what Mollie kept (`deductions`) is the reserve plus
 * the fees. Fees are the settlement's costs: with one payment they are all its; with several and no cost they are zero;
 * with several and some cost, which payment bore it is unknown, so the reserve is left as stored.
 */
async function composeFromBalance({ composition, settlement, client, splits, links, invoiceSources, attach }) {
  const payments = composition.filter((t) => t.type === 'payment');
  const costs = Math.max(0, Number(settlement.costsCents) || 0);
  const resolved = new Map();
  for (const id of new Set(composition.map((t) => t.paymentId))) {
    const stored = splits.byMolliePayment(id);
    if (stored) { resolved.set(id, splitIdOf(stored.sourceType, stored.sourceKey)); continue; }
    // eslint-disable-next-line no-await-in-loop
    const payment = await client.getPayment(id);
    resolved.set(id, attach(payment, pairPayment(payment, links, invoiceSources)));
  }
  return composition.map((t) => {
    const row = {
      id: t.paymentId, kind: t.type === 'payment' ? 'immediate' : 'release', amountCents: Number(t.resultCents),
      grossCents: t.type === 'payment' ? Number(t.initialCents) : null, paidAt: null, description: t.description || '', splitId: resolved.get(t.paymentId) || null,
    };
    if (t.type !== 'payment') return row;
    const kept = Number(t.deductionsCents) || 0;
    if (payments.length === 1) return { ...row, feeCents: costs, reserveCents: Math.max(0, kept - costs) };
    if (costs === 0) return { ...row, feeCents: 0, reserveCents: kept };
    return row;
  });
}

module.exports = { isMollieCredit, settlementReferenceOf, normalizeReference, pairPayment, createSettlementsModel, syncSettlements };
