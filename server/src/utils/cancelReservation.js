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
const {
  buildCancellationRequalification, resolveCancellationReason, givenBackByBucket, keptSignature, cashDepositKeptOf,
} = require('./pricing/refunds/cancellation');
const { isDirectChannel } = require('./platformNameFormat');
const { taxShares } = require('./installmentPlan');
const { computeInstallmentPaidSplit } = require('./installmentPaidSplit');
const { isOffBooks, isRetainedDeposit } = require('./refunds');
const { storedMoneyBuckets } = require('./storedMoneySplit');
const { taxRidesTheComplement } = require('./touristTaxFreeze');
const { bucketSharesOf } = require('./paymentTenders');
const paymentSettlementsModel = require('../models/paymentSettlementsModel');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

// specs/mixed-method-payments.md rule 57 (verification R35b, finding 1) — a solde paid with several methods put on the
// books only its book share, less its geste (`bucketSharesOf`, the reading `collectedByLine` takes): its caisse-interne
// money and its geste never reached 706, so they absorb no book refund. Read whole, they did, and the acompte kept the
// difference as a phantom 7588 indemnity. The geste comes off the accommodation, then the extras pro rata, the tax last
// (rule 54).
function saleBooksOf(database, reservationsModel, row, vatRate) {
  const gross = saleCollectedOf(database, reservationsModel, row, vatRate);
  const split = gross && bucketSharesOf(paymentSettlementsModel.buildModel(database).listFor(row.id), row).balance;
  if (!split) return gross;
  // Exact cents, rounded once at the end (largest remainder) like the register's split reading (rule 55).
  const out = Object.fromEntries(Object.entries(gross).map(([bucket, amount]) => [bucket, Number(amount || 0) * 100 * split.books]));
  let geste = Math.round(Number(split.waivedBooks || 0) * 100);
  const takeFrom = (bucket, want) => {
    const taken = Math.min(want, Math.max(0, out[bucket] || 0));
    if (taken > 0) out[bucket] -= taken;
    geste -= taken;
  };
  if (out.accommodation != null) takeFrom('accommodation', geste);
  const extras = ['options', 'resources'].filter((bucket) => out[bucket] > 0);
  const held = extras.reduce((sum, bucket) => sum + out[bucket], 0);
  if (geste > 0 && held > 0) {
    const share = Math.min(1, geste / held);
    for (const bucket of extras) takeFrom(bucket, out[bucket] * share);
  }
  if (geste > 1e-9 && out.touristTax != null) takeFrom('touristTax', geste);
  const keys = Object.keys(out);
  const exact = keys.map((bucket) => Math.max(0, Math.round(out[bucket] * 1e6) / 1e6));
  const floors = exact.map((c) => Math.floor(c));
  let left = Math.round(exact.reduce((sum, c) => sum + c, 0)) - floors.reduce((sum, c) => sum + c, 0);
  keys.map((_, i) => i).sort((x, y) => (exact[y] - floors[y]) - (exact[x] - floors[x]) || x - y).forEach((i) => {
    if (left > 0) { floors[i] += 1; left -= 1; }
  });
  return Object.fromEntries(keys.map((bucket, i) => [bucket, floors[i] / 100]));
}

// Rule 55 reading of 2026-11-02 (review of PR #926, residual A) — the commissions the payment provider withheld on the
// acompte and solde paid to the books, and the buckets the solde was booked on.
function withheldCommissionsOf(database, reservationsModel, row, vatRate) {
  const book = (paid, cash) => Number(row[paid]) === 1 && !Number(row[cash] || 0);
  const depositTtc = book('depositPaid', 'depositPaidCash') ? Math.max(0, round2(row.acompteCommissionAmount)) : 0;
  const soldeTtc = book('balancePaid', 'balancePaidCash') ? Math.max(0, round2(row.platformCommissionAmount)) : 0;
  return { depositTtc, soldeTtc, soldeBuckets: soldeTtc > 0 ? saleBooksOf(database, reservationsModel, row, vatRate) : null };
}

/**
 * specs/reservation-refunds.md rule 49 reading of 2026-11-02 — what the paid acompte and solde were booked on per
 * bucket, read the way the cancellation reads them: the refund register of a cancelled stay caps its accommodation
 * and tax lines with it when no per-line contribs describe the money.
 */
function bookedStayBuckets({ database, reservationsModel, installmentsModel = null }, row, vatRate) {
  const retained = installmentsRetainedOf(installmentsModel, database, Number(row.id), row);
  const bookedOn = (bucket) => round2(retained.installments.reduce((total, installment) => total + installment[bucket], 0));
  return {
    deposit: Number(row.depositPaid) ? depositBucketsOf(database, reservationsModel, row, vatRate) : null,
    solde: saleCollectedOf(database, reservationsModel, row, vatRate),
    // Rule 49 readings of 2026-11-05 (R22 verification, L1; audit R23 N5) — what a plan's installments were booked on.
    installments: retained && {
      accommodation: bookedOn('accommodation'),
      options: bookedOn('options'),
      resources: bookedOn('resources'),
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
    // A solde collected in the caisse interne holds no book money: it absorbs no book refund (audit R15-L1); paid with
    // several methods, only its book share does (mixed-method-payments rule 57).
    saleCollected: Object.keys(givenBack).length && !Number(row.balancePaidCash || 0) ? saleBooksOf(database, reservationsModel, row, vatRate) : null,
    withheldCommissions: withheldCommissionsOf(database, reservationsModel, row, vatRate),
    cancellationDate: today,
    vatRate,
    reason,
  });
}

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

// Rule 78 — the refunds the avoir netted (read once, here, from the register as the cancellation leaves it) and the refund the
// received compensation paired with; both columns are guarded for a schema that predates them.
function writeCancellationRecords(deps, reservationId, { refundId, compensationId, vatRate }) {
  const { database, refundsModel } = deps;
  const present = (table) => Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  if (present('refund_nettings')) {
    const netted = cancellationNettedRefundIds(deps, reservationId, refundsModel.listByReservation(reservationId), vatRate);
    const insert = database.prepare('INSERT OR IGNORE INTO refund_nettings (avoirId, refundId) VALUES (?, ?)');
    for (const nettedId of netted || []) insert.run(refundId, nettedId);
  }
  if (compensationId != null && database.prepare('PRAGMA table_info(cancellation_compensations)').all().some((c) => c.name === 'refundId')) {
    database.prepare('UPDATE cancellation_compensations SET refundId = ? WHERE id = ?').run(refundId, compensationId);
  }
}

function storeCancellationFigures(database, reservationId, { keptFromGuest, indemnityAmount }) {
  if (!database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'cancellationKeptCents')) return;
  database.prepare('UPDATE reservations SET cancellationKeptCents = ?, cancellationIndemnityCents = ? WHERE id = ?')
    .run(Math.max(0, Math.round(keptFromGuest * 100)), Math.max(0, Math.round(indemnityAmount * 100)), reservationId);
}

// What a cancellation cannot go through: an unknown stay, one already cancelled, a platform booking.
function cancellationRefusalOf(row) {
  if (!row) return { error: 'NOT_FOUND', status: 404, message: 'Réservation non trouvée' };
  if (String(row.kind) === 'cancelled') {
    return { error: 'ALREADY_CANCELLED', status: 409, message: 'Cette réservation est déjà annulée.' };
  }
  // A platform booking follows the platform's own cancellation policy, through the iCal alert flow
  // (specs/cancellation-compensation.md) — never this one.
  if (!isDirectChannel(row.platform)) {
    return { error: 'PLATFORM_RESERVATION', status: 403, message: "Une réservation plateforme s'annule depuis l'alerte iCal, pas ici." };
  }
  return null;
}

// specs/payment-schedule-and-cancellation.md rule 60 (audit R43-C-M1) — the figures a cancellation of `row` books, read
// once: `cancelReservation` writes them and `cancellationPreview` shows them, so the confirm dialog can never announce
// another sum than the one stored.
function cancellationFiguresOf(deps, row, { today = null, vatRate = 0, reason = '' } = {}) {
  const refunds = deps.refundsModel.listByReservation(Number(row.id));
  const requalification = requalificationOf(deps, row, givenBackByBucket(refunds), {
    today, vatRate, reason,
  });
  const indemnityAmount = requalification ? round2(requalification.requalifiedTtc) : 0;
  return {
    cancellationReason: resolveCancellationReason(row),
    requalification,
    retainedDepositAmount: requalification ? requalification.retainedTtc : 0,
    // Verification R43 N2 — the indemnity actually booked (avoir, compensation): the money kept plus a withheld solde
    // commission. The dialog and the toast state this one.
    indemnityAmount,
    // Rule 61 — what the guest loses: the indemnity booked plus the caisse-interne acompte kept. The cancellation notice
    // states this one, never a formula of its own.
    keptFromGuest: round2(indemnityAmount + cashDepositKeptOf(row, refunds)),
    writtenOffBalance: round2((Number(row.balancePaid) ? 0 : round2(row.balanceAmount)) + round2(row.installmentsUnpaidAmount)),
  };
}

/**
 * Rule 60 — what cancelling the stay now would keep and write off, or the refusal the cancel would answer. Reads only.
 * @returns {{ ok: true, cancellationReason, retainedDepositAmount, indemnityAmount, keptFromGuest, writtenOffBalance } | { error, status, message }}
 */
function cancellationPreview(deps, reservationId, { today = null, vatRate = 0 } = {}) {
  const row = deps.reservationsModel.getForCancellation(Number(reservationId));
  const refusal = cancellationRefusalOf(row);
  if (refusal) return refusal;
  const {
    cancellationReason, retainedDepositAmount, indemnityAmount, keptFromGuest, writtenOffBalance,
  } = cancellationFiguresOf(deps, row, { today, vatRate });
  return { ok: true, cancellationReason, retainedDepositAmount, indemnityAmount, keptFromGuest, writtenOffBalance };
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
  const refusal = cancellationRefusalOf(row);
  if (refusal) return refusal;

  const trimmedReason = String(reason || '').trim();
  const {
    cancellationReason, requalification, retainedDepositAmount, indemnityAmount, keptFromGuest, writtenOffBalance,
  } = cancellationFiguresOf(deps, row, { today, vatRate, reason: trimmedReason });

  let refundId = null;
  let compensationId = null;
  const cancelledLinks = [];
  database.transaction(() => {
    reservationsModel.addHistoryEntry(id, 'cancel', [
      { field: 'kind', label: 'Statut', from: 'Réservation', to: 'Annulée' },
      { field: 'cancellationReason', label: 'Motif', from: null, to: trimmedReason || cancellationReason },
      { field: 'retainedDeposit', label: 'Acompte conservé', from: null, to: retainedDepositAmount },
      { field: 'writtenOffBalance', label: 'Solde abandonné', from: null, to: writtenOffBalance },
      // Rule 61 — the sum the cancellation notice states, stored so a later send reads the cancellation's own figure.
      { field: 'keptFromGuest', label: 'Somme conservée', from: null, to: keptFromGuest },
    ]);
    reservationsModel.markCancelled(id, { reason: trimmedReason || cancellationReason, cancelledBy });
    if (requalification) {
      refundId = refundsModel.create(id, { ...requalification.refund, totalTtc: requalification.requalifiedTtc });
      compensationId = compensationsModel.createReceived(requalification.compensation).id;
      writeCancellationRecords(deps, id, { refundId, compensationId, vatRate });
    }
    // Rule 78 — the figures the notice states are stored with the cancellation, not derived from its history.
    storeCancellationFigures(database, id, { keptFromGuest, indemnityAmount });
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
    indemnityAmount,
    keptFromGuest,
    writtenOffBalance,
    refundId,
    compensationId,
    cancelledLinks,
    clientEmail: String(row.email || '').trim(),
  };
}

module.exports = {
  cancelReservation, cancellationPreview, resolveCancellationReason, bookedStayBuckets, cancellationNettedRefundIds, cashDepositKeptOf,
};
