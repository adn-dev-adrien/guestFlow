/**
 * Refunds controller — specs/reservation-refunds.md.
 *
 * Orchestrates the « avoir » flow: read what the reservation actually billed, derive the still-
 * refundable lines, validate the operator's payload against the caps, persist, and hand back the
 * refreshed register. Every euro and every cap is decided here + in the pure `utils/refunds` — the
 * client only picks lines and amounts.
 *
 * Deliberately reachable on a past-locked reservation (rule 15): an early departure is discovered
 * after the stay by construction. Admin-only through the standard role guard.
 */

const { todayIso: localTodayIso } = require('../utils/localDate');
const defaultRefundsModel = require('../models/refundsModel');
const defaultReservationsModel = require('../models/reservationsModel');
const database = require('../database');
const vatRegimeModel = require('../models/vatRegimeModel');
const { lineAllocationsContext } = require('../models/refundInputModel');
const {
  buildRefundableLines, validateRefundPayload, cancelledRefundBudget, collectedByLine, collectedLinesGone, refundDeletionRefusal, lastBookPaymentDateOf, capCashToLines, overpaymentRefusal,
} = require('../utils/refunds');
const { comptaCollected, cashCollected } = require('../utils/reservationSettlement');
const { bookedStayBuckets } = require('../utils/cancelReservation');
const { taxRidesTheComplement } = require('../utils/touristTaxFreeze');
const { bucketSharesOf } = require('../utils/paymentTenders');
const paymentSettlementsModel = require('../models/paymentSettlementsModel');
const { frenchEuros } = require('../utils/pricing/money');

function todayIso() {
  return localTodayIso();
}

// Nights of the stay — the unit the tourist tax is refunded in (spec §3.5 rule 27). Same UTC-midnight
// arithmetic as the other call sites (financeModel, notificationService): no timezone drift.
function nightsBetween(startDate, endDate) {
  const ms = new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.round(ms / 86400000));
}

const { roundMoneyOrZero: round2 } = require('../utils/pricing/money');

const METHOD_LABELS = { transfer: 'virement', cash: 'espèces', internal: 'caisse interne', card: 'carte', retained: 'indemnité' };

// S12 — the stay's history says a refund was made or taken back (the amount and the means, never a name).
function writeRefundHistory(reservationId, eventType, label, refund, verb) {
  if (!refund) return;
  const means = METHOD_LABELS[refund.method] || refund.method;
  require('../models/reservationsModel').addHistoryEntry(Number(reservationId), eventType, [{
    field: 'refund', label, from: eventType === 'refundDeleted' ? `${frenchEuros(refund.totalTtc)} ${verb} (${means})` : null, to: eventType === 'refund' ? `${frenchEuros(refund.totalTtc)} ${verb} (${means})` : null,
  }]);
}
const recordRefundHistory = (reservationId, refund) => writeRefundHistory(reservationId, 'refund', 'Remboursement', refund, 'remboursés');
const recordRefundDeletion = (reservationId, refund) => writeRefundHistory(reservationId, 'refundDeleted', 'Remboursement supprimé', refund, 'remboursés');

function createRefundsController(deps = {}) {
  const refundsModel = deps.refundsModel || defaultRefundsModel;
  const reservationsModel = deps.reservationsModel || defaultReservationsModel;
  // Required lazily: the reservations controller requires this one.
  const storedOverpaymentTtc = deps.storedOverpaymentTtc || ((id) => {
    const over = require('./reservationsController').storedOverpayment(id);
    return over ? Number(over.overpaymentTtc || 0) : 0;
  });
  const vatRateOf = deps.vatRateOf || ((reservation) => vatRegimeModel.rateForRow(database, reservation));
  // The stay's stored money lives in the database its models read: an injected model without its database reads no
  // booked split (rule 49 reading of 2026-11-02).
  const stayDatabase = deps.database || (deps.reservationsModel ? null : database);
  const installmentsModel = deps.installmentsModel || (deps.reservationsModel ? null : require('../models/installmentsModel'));

  // The whole read side of the feature: register + still-refundable lines + both total readings.
  // Reused by the three endpoints AND by the reservation payload, so the fiche never has to ask twice.
  function buildRegister(reservationId, preloadedReservation) {
    const reservation = preloadedReservation || reservationsModel.getByIdWithDetails(reservationId);
    if (!reservation) return null;
    const vatRate = vatRateOf(reservation);
    const refunds = refundsModel.listByReservation(reservationId);
    const refundTotals = refundsModel.totalsByReservation(reservationId);
    const collectedTtc = comptaCollected({ ...reservation, refundsBookTtc: refundTotals.book });
    // Rule 48 — a cancelled stay gives back only what it collected, the requalified part from the indemnity; the
    // caisse interne's money in the caisse interne only (reading of 2026-11-02, audit R15-L1).
    const cancelled = String(reservation.kind) === 'cancelled'
      ? cancelledRefundBudget({ collectedTtc, cashCollectedTtc: cashCollected(reservation), refunds }) : null;
    const booked = stayDatabase ? bookedStayBuckets({ database: stayDatabase, reservationsModel, installmentsModel }, reservation, vatRate) : null;
    const taxOnArrival = stayDatabase ? taxRidesTheComplement(stayDatabase, reservation) : true;
    // specs/mixed-method-payments.md rule 46 — the buckets paid with several methods, read for their share on each side.
    const splitShares = stayDatabase ? bucketSharesOf(paymentSettlementsModel.buildModel(stayDatabase).listFor(reservationId), reservation) : null;
    const lineAllocations = stayDatabase ? lineAllocationsContext(stayDatabase, reservationId) : null;
    const lineReading = (cash) => collectedByLine({ reservation, options: reservation.options || [], resources: reservation.resources || [], booked, cash, taxOnArrival, splitShares, lineAllocations });
    // Rule 51 (D15) — a live stay reads it too: its lines answer for what they collected, when its money can be read.
    const liveReadable = booked && (!(Number(reservation.installmentsPaidAmount) > 0) || booked.installments);
    const collected = cancelled || liveReadable ? lineReading(false) : null;
    const cashReading = cancelled && cancelled.cashCollectedTtc > 0 ? lineReading(true) : null;
    const refundableLines = buildRefundableLines({
      finalPrice: reservation.finalPrice,
      touristTaxTotal: reservation.touristTaxTotal,
      vatRate,
      options: reservation.options || [],
      resources: reservation.resources || [],
      refunds,
      // Drives the per-night tourist-tax line (spec §3.5 rule 27).
      nights: nightsBetween(reservation.startDate, reservation.endDate),
      cancelled,
      // Rule 49 reading of 2026-11-02 — a cancelled stay's line offers at most what that line collected.
      collected,
      planBuckets: !cancelled && booked ? booked.installments : null,
      reservation: cancelled ? null : reservation,
      cashCollected: cashReading,
      complementCollected: Number(reservation.complementPaid) === 1,
      goneLines: cancelled ? collectedLinesGone({ reservation, options: reservation.options || [], resources: reservation.resources || [], collected, cashCollected: cashReading }) : [],
    });
    // Rule 48 reading of 2026-11-02 (review of PR #929, F4) — the caisse interne gives back only what its lines carry.
    if (cancelled) capCashToLines(cancelled, refundableLines);
    return {
      reservation,
      vatRate,
      cancelled,
      payload: {
        refunds,
        refundableLines,
        refundTotals,
        // What the operator has actually banked so far, net of what was already given back — the
        // dialog's « ce remboursement dépasse le montant encaissé » caption (spec §6 rule 7). Same
        // authority as the finance views, never recomputed client-side.
        collectedTtc: cancelled ? round2(cancelled.collectedTtc + cancelled.cashLeftTtc) : collectedTtc,
      },
    };
  }

  return {
    buildRegister,

    list(req, res) {
      const id = Number(req.params.id);
      const register = buildRegister(id);
      if (!register) return res.status(404).json({ error: 'Réservation non trouvée' });
      return res.json(register.payload);
    },

    create(req, res) {
      const id = Number(req.params.id);
      const register = buildRegister(id);
      if (!register) return res.status(404).json({ error: 'Réservation non trouvée' });

      const { reservation, vatRate, payload, cancelled } = register;
      const validated = validateRefundPayload(req.body, {
        refundableLines: payload.refundableLines,
        finalPrice: reservation.finalPrice,
        touristTaxTotal: reservation.touristTaxTotal,
        alreadyRefundedTotal: payload.refundTotals.withCash,
        vatRate,
        today: todayIso(),
        cancelled,
        // Rule 50 (D10) — already net of the refunds made so far.
        liveCollectedTtc: payload.collectedTtc,
        // Reservation-refunds rule 53 (verification R35b, finding 5).
        lastBookPaymentDate: lastBookPaymentDateOf(reservation, {
          installments: installmentsModel ? installmentsModel.listFor(id) : [],
          settlements: stayDatabase ? paymentSettlementsModel.buildModel(stayDatabase).listFor(id) : [],
        }),
      });
      if (validated.error) {
        return res.status(validated.status || 400).json({ error: validated.error, code: validated.code });
      }

      // A refund opened on the trop-perçu (rule 42) cannot exceed what is still over-collected: a double click, a
      // stale tab or a renamed label would otherwise give the same money back twice.
      if (req.body && req.body.fromOverpayment === true) {
        const remaining = storedOverpaymentTtc(id);
        const asked = validated.refund.lines.filter((l) => !l.lineKey).reduce((sum, l) => sum + l.amountTtc, 0);
        const refused = overpaymentRefusal({ remainingTtc: remaining, askedTtc: asked, claimedTtc: Number(req.body.overpaymentTtc) });
        if (refused) return res.status(refused.status).json({ error: refused.error, code: refused.code });
      }

      // Owner O-6 — only a refund opened on the trop-perçu lowers it; the origin is what says so.
      if (req.body && req.body.fromOverpayment === true) validated.refund.origin = 'overpayment';
      const refundId = refundsModel.create(id, validated.refund);
      recordRefundHistory(id, validated.refund, refundId);
      if (validated.refund.origin === 'overpayment') {
        require('../models/refundObligationsModel').settleLoweredBy(id, refundId, Math.round(validated.refund.totalTtc * 100));
      }
      const refreshed = buildRegister(id);
      return res.status(201).json({
        refund: refundsModel.getById(refundId),
        ...refreshed.payload,
      });
    },

    remove(req, res) {
      const id = Number(req.params.id);
      const refundId = Number(req.params.refundId);
      // Refunds rule 6 and payment-schedule rule 55 readings of 2026-11-02 — the retained avoir, and on a cancelled stay
      // any refund the cancellation already read, stay.
      const register = buildRegister(id);
      const target = register && register.payload.refunds.find((refund) => Number(refund.id) === refundId);
      const refunds = register && register.payload.refunds;
      // Payment-schedule rule 55 reading of 2026-11-02 (audit R16-L1) — refused only when it moved the avoir.
      const nettedIds = register && String(register.reservation.kind) === 'cancelled' ? refundsModel.nettedRefundIds(id) : null;
      const refusal = register && refundDeletionRefusal(target, refunds, register.reservation, nettedIds);
      if (refusal) return res.status(409).json(refusal);
      const removed = refundsModel.remove(id, refundId);
      if (!removed) return res.status(404).json({ error: 'Remboursement non trouvé' });
      recordRefundDeletion(id, target);
      const refreshed = buildRegister(id);
      if (!refreshed) return res.status(404).json({ error: 'Réservation non trouvée' });
      return res.json(refreshed.payload);
    },
  };
}

const defaultController = createRefundsController();

module.exports = defaultController;
// NOT `create`: that name is already one of the controller's own handlers (POST /refunds), and
// overwriting it would make the route call the factory instead of the handler.
module.exports.createController = createRefundsController;
