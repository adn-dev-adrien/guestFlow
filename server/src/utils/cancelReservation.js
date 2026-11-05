/**
 * The cancellation transaction (specs/payment-schedule-and-cancellation.md §3.5 / §3.6).
 *
 * Everything that must succeed or fail together, in one place, with every dependency injected so the
 * whole sequence is unit-testable against an in-memory database — no Qonto, no SMTP, no clock:
 *
 *   1. an audit entry naming what was cancelled, why, and the money involved;
 *   2. `kind` walks 'reservation' → 'cancelled'. That single flip is what frees the dates: every
 *      operational query in the app already filters `kind = 'reservation'` (availability, calendar,
 *      planning, laundry, linen, SAS, iCal export, Google Calendar, email queues), so the row leaves
 *      all of them at once — no query to hunt down, and none that can be forgotten;
 *   3. the requalification pair, when an acompte — or installments of a plan — had actually been
 *      collected: an avoir reversing the séjour revenue + VAT, and an indemnity crediting the same sum
 *      VAT-free, both dated today;
 *   4. open payment links are cancelled — a dead stay must not stay payable. They are returned as
 *      `cancelledLinks`: deactivating them at the provider is network, so it happens after the commit
 *      (specs/plugins-phase-3a-online-payment.md rule 7).
 *
 * Amounts, échéances and paid flags are deliberately NOT touched: they are history now, and the
 * accounting reads still need them exactly as they were.
 *
 * Business failures are returned (`{ error, status }`), never thrown — the controller maps them to HTTP.
 */

const { withConvertedDevis } = require('./deletionGuard');
const { buildCancellationRequalification } = require('./cancellationRequalification');
const { isDirectChannel } = require('./platformNameFormat');
const { taxShares } = require('./installmentPlan');
const { computeInstallmentPaidSplit } = require('./installmentPaidSplit');
const { isOffBooks, isRetainedDeposit, COMMISSION_KEY } = require('./refunds');
const { storedMoneyBuckets } = require('./storedMoneySplit');
const { taxRidesTheComplement } = require('./touristTaxFreeze');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Why the stay was cancelled — derived from the state of the money, not asked. The operator's own
// words travel separately, in `reason`.
function resolveCancellationReason(row) {
  const depositUnpaid = Number(row.depositAmount || 0) > 0 && !Number(row.depositPaid);
  // An installment plan replaces the solde (specs/direct-installments.md rule 5): what it still owes is one.
  const balanceUnpaid = (Number(row.balanceAmount || 0) > 0 && !Number(row.balancePaid))
    || Number(row.installmentsUnpaidAmount || 0) > 0;
  // Nothing collected at all is an unpaid acompte, the first money missing — not an unpaid solde
  // (payment-schedule-and-cancellation rule 36, fixed at the 2026-10-27 spec review).
  if (depositUnpaid) return 'unpaid_deposit';
  if (balanceUnpaid) return 'unpaid_balance';
  return 'manual';
}

// specs/direct-installments.md rule 46 — what the installments of a plan collected, and how the accounting booked
// each one: its tourist-tax share (rule 39) and its revenue per bucket, installment by installment.
function installmentsRetainedOf(installmentsModel, database, id, row) {
  const plan = installmentsModel ? installmentsModel.listFor(id) : [];
  if (!plan.length) return null;
  // A plan is a direct sale: when the tax rides on the arrival complement, no installment carried it
  // (paymentsController.resolveInstallmentComponents, accountingModel.buildInstallmentEntry), so the
  // avoir reverses none (specs/direct-installments.md rule 46).
  const taxOnArrival = Number(row.touristTaxInComplement) === 1;
  // specs/platform-added-guests-tourist-tax.md rule 27 — the plan holds the tax without the added guests' share.
  const taxCents = taxOnArrival ? 0 : Math.round((Number(row.touristTaxTotal || 0) - Number(row.touristTaxAddedGuestsAmount || 0)) * 100);
  const shares = taxShares(taxCents, plan.map((i) => Number(i.amountCents)));
  let amountCents = 0;
  let retainedTaxCents = 0;
  const installments = [];
  plan.forEach((installment, index) => {
    if (Number(installment.paid) !== 1) return;
    const installmentCents = Number(installment.amountCents);
    amountCents += installmentCents;
    // Rule 47 — the split frozen when it was collected is the one the books hold. Collected before that
    // rule, the installment has none: the export spread it with the stored-money rules, which
    // computeInstallmentPaidSplit applies to the fiche as it stands.
    const frozen = typeof installmentsModel.paidSplitOf === 'function' ? installmentsModel.paidSplitOf(installment.id) : null;
    const split = frozen || (database ? computeInstallmentPaidSplit(database, installment.id) : null)
      || { taxCents: shares[index], accommodationCents: Math.max(0, installmentCents - shares[index]), optionsCents: 0, resourcesCents: 0 };
    retainedTaxCents += split.taxCents;
    installments.push({
      number: Number(installment.number) || index + 1,
      count: plan.length,
      accommodation: split.accommodationCents / 100,
      options: split.optionsCents / 100,
      resources: split.resourcesCents / 100,
    });
  });
  return { amountTtc: amountCents / 100, touristTaxTtc: retainedTaxCents / 100, installments };
}

// specs/payment-schedule-and-cancellation.md rule 55 — per bucket, what the book refunds made before the cancellation
// gave back (the caisse interne is off the books: it never reversed any revenue).
function givenBackByBucket(refunds) {
  const given = {};
  for (const refund of refunds || []) {
    if (isOffBooks(refund.method) || isRetainedDeposit(refund.method)) continue;
    for (const line of refund.lines || []) given[line.bucket] = round2((given[line.bucket] || 0) + Number(line.amountTtc || 0));
  }
  return given;
}

// Contribs describe an entry when they add up to it (accountingModel's CONTRIB_RESIDUE_TOLERANCE_TTC); otherwise the
// export booked it on the stored-money split.
const describes = (buckets, amount) => Boolean(buckets)
  && Math.abs(round2(['accommodation', 'options', 'resources', 'touristTax'].reduce((total, bucket) => total + Number(buckets[bucket] || 0), 0)) - round2(amount)) <= 0.02;

// specs/payment-schedule-and-cancellation.md rule 55 — the buckets the acompte was booked on: its contribs, or the
// stored-money split the export credited for it (utils/storedMoneySplit), so the avoir of a legacy acompte reverses
// the sub-accounts it was credited on.
function depositBucketsOf(database, reservationsModel, row, vatRate) {
  const contribs = reservationsModel.depositContribBuckets(row.id);
  const deposit = Math.max(0, round2(row.depositAmount));
  if (!Number(row.depositPaid) || deposit <= 0 || describes(contribs, deposit) || !database) return contribs;
  return storedMoneyBuckets(database, row, { kind: 'deposit', revenueTtc: deposit, vatRate });
}

// Rule 55 — what a paid solde collected per bucket, beyond the acompte: that money absorbs the earlier refunds first.
// Its contribs when they describe it, else the stored-money split the export booked it on, the tax first.
function saleCollectedOf(database, reservationsModel, row, vatRate) {
  if (!Number(row.balancePaid) || !database) return null;
  const balance = Math.max(0, round2(row.balanceAmount));
  const contribs = reservationsModel.soldeContribBuckets(row.id);
  if (describes(contribs, balance)) return contribs;
  // specs/platform-added-guests-tourist-tax.md rule 13 — the added guests' tax rode the complement, not this solde.
  const tax = taxRidesTheComplement(database, row)
    ? 0
    : Math.min(Math.max(0, round2(Number(row.touristTaxTotal || 0) - Number(row.touristTaxAddedGuestsAmount || 0))), balance);
  return { ...storedMoneyBuckets(database, row, { kind: 'balance', revenueTtc: round2(balance - tax), vatRate }), touristTax: tax };
}

// Rule 55 reading of 2026-11-02 (review of PR #926, residual A) — the commissions the payment provider withheld on the
// acompte and solde paid to the books, and the buckets the solde was booked on.
function withheldCommissionsOf(database, reservationsModel, row, vatRate) {
  const book = (paid, cash) => Number(row[paid]) === 1 && !Number(row[cash] || 0);
  const depositTtc = book('depositPaid', 'depositPaidCash') ? Math.max(0, round2(row.acompteCommissionAmount)) : 0;
  const soldeTtc = book('balancePaid', 'balancePaidCash') ? Math.max(0, round2(row.platformCommissionAmount)) : 0;
  return { depositTtc, soldeTtc, soldeBuckets: soldeTtc > 0 ? saleCollectedOf(database, reservationsModel, row, vatRate) : null };
}

/**
 * specs/reservation-refunds.md rule 49 reading of 2026-11-02 — what the paid acompte and solde were booked on per
 * bucket, read the way the cancellation reads them: the refund register of a cancelled stay caps its accommodation
 * and tax lines with it when no per-line contribs describe the money.
 */
function bookedStayBuckets({ database, reservationsModel, installmentsModel = null }, row, vatRate) {
  const retained = installmentsRetainedOf(installmentsModel, database, Number(row.id), row);
  return {
    deposit: Number(row.depositPaid) ? depositBucketsOf(database, reservationsModel, row, vatRate) : null,
    solde: saleCollectedOf(database, reservationsModel, row, vatRate),
    // Rule 49 reading of 2026-11-05 (R22 verification, L1) — the accommodation and the tax a plan's installments were booked on.
    installments: retained && {
      accommodation: round2(retained.installments.reduce((total, installment) => total + installment.accommodation, 0)),
      touristTax: retained.touristTaxTtc,
    },
  };
}

// Rule 55 — the requalification a cancellation books for `row`, the book refunds before it having given back `givenBack`.
function requalificationOf(deps, row, givenBack, { today = null, vatRate = 0, reason = '' } = {}) {
  const { database, reservationsModel, installmentsModel = null } = deps;
  return buildCancellationRequalification({
    reservation: row,
    depositBuckets: depositBucketsOf(database, reservationsModel, row, vatRate),
    installmentsRetained: installmentsRetainedOf(installmentsModel, database, Number(row.id), row),
    givenBack,
    // A solde collected in the caisse interne holds no book money: it absorbs no book refund (audit R15-L1).
    saleCollected: Object.keys(givenBack).length && !Number(row.balancePaidCash || 0) ? saleCollectedOf(database, reservationsModel, row, vatRate) : null,
    withheldCommissions: withheldCommissionsOf(database, reservationsModel, row, vatRate),
    cancellationDate: today,
    vatRate,
    reason,
  });
}

const cents = (value) => Math.round(Number(value || 0) * 100);
const lineSignature = (line) => JSON.stringify([line.lineKey || null, line.bucket, String(line.label || ''),
  line.quantity == null ? null : Number(line.quantity), line.unitPrice == null ? null : cents(line.unitPrice),
  cents(line.amountTtc), Number(line.vatRate || 0)]);
// Review of PR #930, F1 — the solde's commission is spread over what the books still hold of the solde, which an
// absorbed refund moves by a few cents: only the commission total is money kept, its spread is not compared.
const keptSignature = (totalTtc, lines) => {
  const kept = (lines || []).filter((line) => line.lineKey !== COMMISSION_KEY);
  const commission = (lines || []).filter((line) => line.lineKey === COMMISSION_KEY)
    .reduce((sum, line) => sum + cents(line.amountTtc), 0);
  return JSON.stringify([cents(totalTtc), kept.map(lineSignature).sort(), commission]);
};

/**
 * Payment-schedule rule 55 reading of 2026-11-02 (audit R16-L1) — the ids of the book refunds made before the
 * cancellation that its `retained` avoir actually read: rebuilt without one of them (same stay, same solde, same
 * commissions), the requalification would keep another total, other non-commission lines or another commission total
 * than the avoir does. A refund the paid
 * solde absorbed whole moved nothing: it is not in the set. `null` when the register has no avoir (or the stay cannot
 * be read): the caller then keeps the refusal by order.
 */
function cancellationNettedRefundIds(deps, reservationId, refunds, vatRate = 0) {
  const list = refunds || [];
  const avoirs = list.filter((refund) => isRetainedDeposit(refund.method));
  if (avoirs.length === 0 || !deps || !deps.database || !deps.reservationsModel) return null;
  const avoir = avoirs.reduce((best, refund) => (Number(refund.id) > Number(best.id) ? refund : best));
  const row = deps.reservationsModel.getForCancellation(Number(reservationId));
  if (!row) return null;
  const before = list.filter((refund) => !isOffBooks(refund.method) && !isRetainedDeposit(refund.method)
    && Number(refund.id) < Number(avoir.id));
  const kept = keptSignature(avoir.totalTtc, avoir.lines);
  const netted = new Set();
  for (const refund of before) {
    const rebuilt = requalificationOf(deps, row, givenBackByBucket(before.filter((other) => other !== refund)), { vatRate });
    const same = rebuilt && keptSignature(rebuilt.requalifiedTtc, rebuilt.refund.lines) === kept;
    if (!same) netted.add(Number(refund.id));
  }
  return netted;
}

/**
 * @param {object} deps { database, reservationsModel, refundsModel, compensationsModel, paymentLinksModel, installmentsModel? }
 * @param {number} reservationId
 * @param {object} input { reason?, cancelledBy?, today, vatRate }
 */
function cancelReservation(deps, reservationId, { reason = '', cancelledBy = null, today, vatRate = 0 } = {}) {
  const { database, reservationsModel, refundsModel, compensationsModel, paymentLinksModel } = deps;
  const id = Number(reservationId);
  const row = reservationsModel.getForCancellation(id);

  if (!row) return { error: 'NOT_FOUND', status: 404, message: 'Réservation non trouvée' };
  if (String(row.kind) === 'cancelled') {
    return { error: 'ALREADY_CANCELLED', status: 409, message: 'Cette réservation est déjà annulée.' };
  }
  // A platform booking follows the platform's own cancellation policy, through the iCal alert flow
  // (specs/cancellation-compensation.md) — never this one.
  if (!isDirectChannel(row.platform)) {
    return { error: 'PLATFORM_RESERVATION', status: 403, message: "Une réservation plateforme s'annule depuis l'alerte iCal, pas ici." };
  }

  const cancellationReason = resolveCancellationReason(row);
  const trimmedReason = String(reason || '').trim();
  const requalification = requalificationOf(deps, row, givenBackByBucket(refundsModel.listByReservation(id)), {
    today, vatRate, reason: trimmedReason,
  });
  const retainedDepositAmount = requalification ? requalification.retainedTtc : 0;
  const writtenOffBalance = round2((Number(row.balancePaid) ? 0 : round2(row.balanceAmount)) + round2(row.installmentsUnpaidAmount));

  let refundId = null;
  let compensationId = null;
  const cancelledLinks = [];
  database.transaction(() => {
    reservationsModel.addHistoryEntry(id, 'cancel', [
      { field: 'kind', label: 'Statut', from: 'Réservation', to: 'Annulée' },
      { field: 'cancellationReason', label: 'Motif', from: null, to: trimmedReason || cancellationReason },
      { field: 'retainedDeposit', label: 'Acompte conservé', from: null, to: retainedDepositAmount },
      { field: 'writtenOffBalance', label: 'Solde abandonné', from: null, to: writtenOffBalance },
    ]);
    reservationsModel.markCancelled(id, { reason: trimmedReason || cancellationReason, cancelledBy });
    if (requalification) {
      refundId = refundsModel.create(id, { ...requalification.refund, totalTtc: requalification.requalifiedTtc });
      compensationId = compensationsModel.createReceived(requalification.compensation).id;
    }
    // The links of the devis converted into the stay keep the devis id and stay payable otherwise.
    for (const ownerId of withConvertedDevis(database, [id])) {
      for (const link of paymentLinksModel.listForReservation(ownerId)) {
        if (String(link.status) === 'open') cancelledLinks.push(paymentLinksModel.updateStatus(link.id, 'cancelled'));
      }
    }
  }).immediate();

  return {
    ok: true,
    cancellationReason,
    retainedDepositAmount,
    writtenOffBalance,
    refundId,
    compensationId,
    cancelledLinks,
    clientEmail: String(row.email || '').trim(),
  };
}

module.exports = { cancelReservation, resolveCancellationReason, bookedStayBuckets, cancellationNettedRefundIds };
