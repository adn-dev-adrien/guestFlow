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
const { isOffBooks, isRetainedDeposit } = require('./refunds');
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
  const taxCents = taxOnArrival ? 0 : Math.round(Number(row.touristTaxTotal || 0) * 100);
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
function givenBackByBucket(refundsModel, id) {
  const given = {};
  for (const refund of refundsModel.listByReservation(id)) {
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
  const tax = taxRidesTheComplement(database, row) ? 0 : Math.min(Math.max(0, round2(row.touristTaxTotal)), balance);
  return { ...storedMoneyBuckets(database, row, { kind: 'balance', revenueTtc: round2(balance - tax), vatRate }), touristTax: tax };
}

/**
 * specs/reservation-refunds.md rule 49 reading of 2026-11-02 — what the paid acompte and solde were booked on per
 * bucket, read the way the cancellation reads them: the refund register of a cancelled stay caps its accommodation
 * and tax lines with it when no per-line contribs describe the money.
 */
function bookedStayBuckets({ database, reservationsModel }, row, vatRate) {
  return {
    deposit: Number(row.depositPaid) ? depositBucketsOf(database, reservationsModel, row, vatRate) : null,
    solde: saleCollectedOf(database, reservationsModel, row, vatRate),
  };
}

/**
 * @param {object} deps { database, reservationsModel, refundsModel, compensationsModel, paymentLinksModel, installmentsModel? }
 * @param {number} reservationId
 * @param {object} input { reason?, cancelledBy?, today, vatRate }
 */
function cancelReservation(deps, reservationId, { reason = '', cancelledBy = null, today, vatRate = 0 } = {}) {
  const { database, reservationsModel, refundsModel, compensationsModel, paymentLinksModel, installmentsModel = null } = deps;
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
  const depositBuckets = depositBucketsOf(database, reservationsModel, row, vatRate);
  const givenBack = givenBackByBucket(refundsModel, id);
  const requalification = buildCancellationRequalification({
    reservation: row,
    depositBuckets,
    installmentsRetained: installmentsRetainedOf(installmentsModel, database, id, row),
    givenBack,
    saleCollected: Object.keys(givenBack).length ? saleCollectedOf(database, reservationsModel, row, vatRate) : null,
    cancellationDate: today,
    vatRate,
    reason: trimmedReason,
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
      refundId = refundsModel.create(id, { ...requalification.refund, totalTtc: retainedDepositAmount });
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

module.exports = { cancelReservation, resolveCancellationReason, bookedStayBuckets };
