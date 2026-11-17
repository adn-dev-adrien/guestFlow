/**
 * What Mollie says about a settlement, kept beside the bank credits (specs/mollie-rolling-reserve-and-incoming-payments.md
 * rules 10, 16-17): the settlement a Qonto credit's reference names, the payments it paid, and which GuestFlow payment
 * link each of them is. Read-only; nothing is ever written to Mollie.
 */

const { splitIdOf, SOURCE_TYPES } = require('./molliePaymentSplits');
const { explainError } = require('../mollieClient');

const MS_MINUTE = 60 * 1000;
const PAIRING_WINDOW_MS = 10 * MS_MINUTE;
// Rule 17 — a settlement Mollie cannot give is not asked again before this delay; the others are read all the same.
const RETRY_AFTER_MS = 24 * 60 * MS_MINUTE;
// Rule 16 — a settlement holding a payment GuestFlow could not name (or read without balances) is read again, a few per pass.
const REREAD_AFTER_MS = 60 * MS_MINUTE;
const REREAD_PER_PASS = 5;
const REFUND_CHECKS_PER_PASS = 10;

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

// Rule 16 step 3, rule 33 (loop t11 B11-1) — which card day of an invoiced document a Mollie payment naming its number is.
function invoicePairing(payment, number, owner, boundOf) {
  const plain = ({ grossCents, paidAt, nextDays, ...source }) => source;
  const free = (source) => {
    const bound = boundOf(plain(source));
    return !bound || String(bound) === String(payment.id);
  };
  if (!owner.nextDays) return free(owner) ? { kind: 'invoice', number, source: owner } : null;
  const at = Date.parse(payment.paidAt || '');
  const distance = (source) => (Number.isFinite(at) ? Math.abs(Date.parse(`${String(source.paidAt).slice(0, 10)}T12:00:00Z`) - at) : 0);
  const days = [owner, ...owner.nextDays].filter(free);
  const sameAmount = days.filter((source) => Number(source.grossCents) === Number(payment.amountCents)).sort((a, b) => distance(a) - distance(b));
  const chosen = sameAmount[0] || (free(owner) ? owner : null);
  return chosen ? { kind: 'invoice', number, source: plain(chosen) } : null;
}

/**
 * Rule 16 — the GuestFlow side of a Mollie payment, first match wins:
 * 1. its `description` is a link's `providerPaymentId` (the Qonto payment id);
 * 2. its `metadata.payment_link_id` is a link's `providerLinkId`;
 * 3. its `description` is a Qonto invoice number GuestFlow stores (a sale outside a stay paid by card): the payment IS
 *    that sale's card payment, gross and date exact. Loop t11 B11-1: a split already bound to ANOTHER Mollie payment is never
 *    taken again — a second payment naming the number goes to the document's next card day of the same amount (closest date,
 *    `source.nextDays`), else it is unknown;
 * 4. same amount and `paidAt` within 10 minutes of a link's, when exactly one link fits.
 * @param {Map<string, object>} [invoiceSources]  invoice number → its source (`invoiceSources` of `mollieCardSources`)
 * @param {(source: object) => (string|null)} [boundOf]  the Mollie payment a source's stored split is already bound to
 * @returns {{ kind: 'link', paymentLinkId: string } | { kind: 'invoice', number: string, source: object } | null}
 */
function pairPayment(payment, links, invoiceSources = new Map(), boundOf = () => null) {
  const description = String(payment.description || '').trim();
  if (description) {
    const byPaymentId = links.find((l) => l.providerPaymentId && String(l.providerPaymentId) === description);
    if (byPaymentId) return { kind: 'link', paymentLinkId: String(byPaymentId.id) };
  }
  if (payment.paymentLinkId) {
    const byLinkId = links.find((l) => l.providerLinkId && String(l.providerLinkId) === String(payment.paymentLinkId));
    if (byLinkId) return { kind: 'link', paymentLinkId: String(byLinkId.id) };
  }
  if (description && invoiceSources.has(description)) return invoicePairing(payment, description, invoiceSources.get(description), boundOf);
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
        db.prepare('DELETE FROM mollie_settlement_payments WHERE settlementId = ?').run(settlement.id);
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
    /** One stored settlement by the reference a bank credit names (« REF T… » or Mollie's own form), without its payments. */
    findByReference(reference) {
      const wanted = normalizeReference(reference);
      return db.prepare('SELECT * FROM mollie_settlements WHERE reference = ? OR reference = ?').get(wanted, `T${wanted}`) || null;
    },
    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM mollie_settlements').get().n;
    },
    /** Rule 16 — the stored settlements worth reading again: a payment of unknown source, or composed from the payments list only. */
    rereadable({ before, limit = REREAD_PER_PASS, known = null }) {
      // `known` (the references a bank credit names) is applied BEFORE the limit: a stale settlement no credit names must
      // never take the place of one that can be read again.
      return db.prepare(`SELECT s.reference FROM mollie_settlements s
        WHERE s.fetchedAt <= ? AND (s.source = 'payments' OR EXISTS (
          SELECT 1 FROM mollie_settlement_payments p WHERE p.settlementId = s.id AND p.splitId IS NULL))
        ORDER BY s.fetchedAt`).all(before).map((r) => normalizeReference(r.reference))
        .filter((reference) => !known || known.has(reference)).slice(0, limit);
    },
    /** Rule 17 — a reference Mollie could not give: kept with the day it may be asked again. */
    recordFailure(reference, message, now = new Date()) {
      db.prepare(`INSERT INTO mollie_settlement_failures (reference, failedAt, retryAt, message) VALUES (?, ?, ?, ?)
        ON CONFLICT(reference) DO UPDATE SET failedAt = excluded.failedAt, retryAt = excluded.retryAt, message = excluded.message`)
        .run(normalizeReference(reference), now.toISOString(), new Date(now.getTime() + RETRY_AFTER_MS).toISOString(), String(message));
    },
    clearFailure(reference) {
      db.prepare('DELETE FROM mollie_settlement_failures WHERE reference = ?').run(normalizeReference(reference));
    },
    /** The references not to ask again yet. */
    coolingDown(now = new Date()) {
      return new Set(db.prepare('SELECT reference FROM mollie_settlement_failures WHERE retryAt > ?').all(now.toISOString()).map((r) => r.reference));
    },
    failures() {
      return db.prepare('SELECT reference, failedAt, retryAt, message FROM mollie_settlement_failures ORDER BY failedAt').all();
    },
    /** The failures still cooling down: what the card tells, whether or not this pass asked again. */
    activeFailures(now = new Date()) {
      return db.prepare('SELECT reference, failedAt, retryAt, message FROM mollie_settlement_failures WHERE retryAt > ? ORDER BY failedAt').all(now.toISOString());
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
      const between = db.prepare(`SELECT * FROM mollie_balance_transactions
        WHERE type <> 'outgoing-transfer' AND createdAt > ? AND createdAt <= ?
        ORDER BY createdAt, id`).all(at || '', transfer.createdAt);
      const rows = between.filter((t) => t.paymentId && (isImmediateType(t.type) || isReleaseType(t.type)));
      const unknown = [...new Set(between.filter((t) => !rows.includes(t)).map((t) => t.type))];
      if (unknown.length > 0) console.warn(`[online-payment] Mollie settlement ${settlementId}: balance transaction types not composed: ${unknown.join(', ')}`);
      return rows.length > 0 ? rows : null;
    },
  };
}

// Rule 10 — only `payment` and `api-payment-rolling-reserve-release` were measured (online payments); an on-site or
// captured payment may surface under a sibling type, so the family is matched rather than one name.
const isImmediateType = (type) => type === 'payment' || type === 'capture';
const isReleaseType = (type) => /rolling-reserve-release$/.test(String(type)) || type === 'released-rolling-reserve';

/**
 * Rule 16 — reads, for the stored Mollie credits whose settlement is not detailed yet, the settlement and what it paid.
 * The balance transactions are the exact source (a payment's immediate share, a reserve release carrying its payment id);
 * a settlement they cannot compose — the token cannot read balances — falls back on the settlement's payments list. Each
 * payment is attached to its link or invoice, and the reserve Mollie really held corrects the stored split. A few settlements
 * already stored with a payment GuestFlow could not name (or read without balances) are read again each pass, and the
 * refunds of the payments whose reserve is still held are refreshed.
 *
 * Rule 17 — one reference failing (not a settlement, a body that does not parse, a transient refusal) never stops the
 * others: it is kept with a delay before it is asked again and the loop goes on. Only a token Mollie refuses (401) stops the
 * pass, since every call would fail the same way.
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
 * @returns {Promise<{ read: number, unknownPayments: number, balances: boolean, failed: { reference: string, message: string }[] }>}
 */
async function syncSettlements({ client, model, splits, settings, credits, links, invoiceSources = new Map(), profileId = '', now = new Date() }) {
  const cooling = model.coolingDown(now);
  const named = new Set(credits.filter(isMollieCredit).map(settlementReferenceOf).filter(Boolean).map(normalizeReference));
  const fresh = [...named].filter((reference) => !model.hasReference(reference));
  const again = model.rereadable({ before: new Date(now.getTime() - REREAD_AFTER_MS).toISOString(), known: named }).filter((reference) => !fresh.includes(reference));
  const references = [...fresh, ...again].filter((reference) => !cooling.has(reference));
  let balances = false;
  if (references.length > 0 && typeof client.listBalanceTransactions === 'function') {
    try {
      model.storeBalanceTransactions(await client.listBalanceTransactions({ isKnown: (id) => model.knowsBalanceTransaction(id) }));
      balances = true;
    } catch { balances = false; }
  }
  const splitIdOfPairing = (pairing) => (!pairing ? null
    : (pairing.kind === 'link' ? splitIdOf(SOURCE_TYPES.link, pairing.paymentLinkId) : splitIdOf(pairing.source.sourceType, pairing.source.sourceKey)));
  const boundOf = (source) => {
    const stored = splits.forSource(source.sourceType, source.sourceKey);
    return stored ? stored.molliePaymentId : null;
  };
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
  const failed = [];
  let interrupted = null;
  for (const reference of references) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const settlement = await client.getSettlement(reference);
      const composition = balances ? model.compositionOf(settlement.id) : null;
      let rows;
      if (composition) {
        // eslint-disable-next-line no-await-in-loop
        rows = await composeFromBalance({ composition, settlement, client, splits, links, invoiceSources, attach, boundOf });
      } else {
        // eslint-disable-next-line no-await-in-loop
        const payments = await client.listSettlementPayments(settlement.id, { profileId });
        rows = payments.map((p) => ({
          id: p.id, kind: 'immediate', amountCents: p.amountCents, grossCents: p.amountCents, paidAt: p.paidAt, description: p.description,
          splitId: attach(p, pairPayment(p, links, invoiceSources, boundOf)),
        }));
      }
      model.store({ ...settlement, reference, source: composition ? 'balance' : 'payments' }, rows, now);
      model.clearFailure(reference);
      rows.forEach((r) => {
        if (!r.splitId) unknownPayments += 1;
        else if (r.kind === 'immediate' && r.reserveCents != null) splits.correctReserve(r.splitId, r.reserveCents);
      });
      read += 1;
    } catch (err) {
      if (Number(err && err.status) === 401) throw err;
      const message = explainError(err);
      // A network-level failure (no answer, a timeout, Mollie down or limiting) is not about this reference: the next
      // ones would fail alike, so the pass stops without putting any of them into a 24-hour cooldown.
      if (isTransient(err)) { interrupted = message; break; }
      model.recordFailure(reference, message, now);
      failed.push({ reference, message });
    }
  }
  if (!interrupted) await refreshRefunds({ client, splits, now });
  return interrupted ? { read, unknownPayments, balances, failed, interrupted } : { read, unknownPayments, balances, failed };
}

const isTransient = (err) => {
  const status = Number(err && err.status);
  return ['ENETWORK', 'ETIMEDOUT'].includes(err && err.code) || status === 429 || status >= 500;
};

/** Rule 6 — what Mollie says was refunded of the payments whose reserve is still held. A failed read keeps what is stored. */
async function refreshRefunds({ client, splits, now = new Date() }) {
  if (typeof client.getPayment !== 'function' || typeof splits.openWithMolliePayment !== 'function') return;
  for (const stored of splits.openWithMolliePayment(REFUND_CHECKS_PER_PASS)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const payment = await client.getPayment(stored.molliePaymentId);
      splits.setRefunded(stored.sourceType, stored.sourceKey, payment.refundedCents);
    } catch { /* the stored refund stays */ }
    // Asked or not answered, it goes to the back of the queue: the same ten oldest never starve the others.
    if (typeof splits.markRefundChecked === 'function') splits.markRefundChecked(stored.sourceType, stored.sourceKey, now);
  }
}

/**
 * Rule 10 — the rows of a settlement composed from the balance transactions it paid. A `payment` is the immediate share
 * of that payment (`resultAmount`) out of its gross (`initialAmount`); what Mollie kept (`deductions`) is the reserve plus
 * the fees. Fees are the settlement's costs: with one payment they are all its; with several and no cost they are zero;
 * with several and some cost, which payment bore it is unknown, so the reserve is left as stored.
 */
async function composeFromBalance({ composition, settlement, client, splits, links, invoiceSources, attach, boundOf }) {
  const payments = composition.filter((t) => isImmediateType(t.type));
  const costs = Math.max(0, Number(settlement.costsCents) || 0);
  const resolved = new Map();
  for (const id of new Set(composition.map((t) => t.paymentId))) {
    const stored = splits.byMolliePayment(id);
    if (stored) { resolved.set(id, splitIdOf(stored.sourceType, stored.sourceKey)); continue; }
    // eslint-disable-next-line no-await-in-loop
    const payment = await client.getPayment(id);
    resolved.set(id, attach(payment, pairPayment(payment, links, invoiceSources, boundOf)));
  }
  return composition.map((t) => {
    const row = {
      id: t.paymentId, kind: isImmediateType(t.type) ? 'immediate' : 'release', amountCents: Number(t.resultCents),
      grossCents: isImmediateType(t.type) ? Number(t.initialCents) : null, paidAt: null, description: t.description || '', splitId: resolved.get(t.paymentId) || null,
    };
    if (!isImmediateType(t.type)) return row;
    const kept = Number(t.deductionsCents) || 0;
    if (payments.length === 1) return { ...row, feeCents: costs, reserveCents: Math.max(0, kept - costs) };
    if (costs === 0) return { ...row, feeCents: 0, reserveCents: kept };
    return row;
  });
}

module.exports = { isImmediateType, isReleaseType, isMollieCredit, settlementReferenceOf, normalizeReference, pairPayment, createSettlementsModel, syncSettlements };
