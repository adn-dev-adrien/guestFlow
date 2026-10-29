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
const { buildRefundableLines, validateRefundPayload } = require('../utils/refunds');
const { comptaCollected } = require('../utils/reservationSettlement');

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

function createRefundsController(deps = {}) {
  const refundsModel = deps.refundsModel || defaultRefundsModel;
  const reservationsModel = deps.reservationsModel || defaultReservationsModel;
  // Required lazily: the reservations controller requires this one.
  const storedOverpaymentTtc = deps.storedOverpaymentTtc || ((id) => {
    const over = require('./reservationsController').storedOverpayment(id);
    return over ? Number(over.overpaymentTtc || 0) : 0;
  });
  const vatRateOf = deps.vatRateOf || ((reservation) => vatRegimeModel.rateForRow(database, reservation));

  // The whole read side of the feature: register + still-refundable lines + both total readings.
  // Reused by the three endpoints AND by the reservation payload, so the fiche never has to ask twice.
  function buildRegister(reservationId, preloadedReservation) {
    const reservation = preloadedReservation || reservationsModel.getByIdWithDetails(reservationId);
    if (!reservation) return null;
    const vatRate = vatRateOf(reservation);
    const refunds = refundsModel.listByReservation(reservationId);
    const refundTotals = refundsModel.totalsByReservation(reservationId);
    const refundableLines = buildRefundableLines({
      finalPrice: reservation.finalPrice,
      touristTaxTotal: reservation.touristTaxTotal,
      vatRate,
      options: reservation.options || [],
      resources: reservation.resources || [],
      refunds,
      // Drives the per-night tourist-tax line (spec §3.5 rule 27).
      nights: nightsBetween(reservation.startDate, reservation.endDate),
    });
    return {
      reservation,
      vatRate,
      payload: {
        refunds,
        refundableLines,
        refundTotals,
        // What the operator has actually banked so far, net of what was already given back — the
        // dialog's « ce remboursement dépasse le montant encaissé » caption (spec §6 rule 7). Same
        // authority as the finance views, never recomputed client-side.
        collectedTtc: comptaCollected({ ...reservation, refundsBookTtc: refundTotals.book }),
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

      const { reservation, vatRate, payload } = register;
      const validated = validateRefundPayload(req.body, {
        refundableLines: payload.refundableLines,
        finalPrice: reservation.finalPrice,
        touristTaxTotal: reservation.touristTaxTotal,
        alreadyRefundedTotal: payload.refundTotals.withCash,
        vatRate,
        today: todayIso(),
      });
      if (validated.error) {
        return res.status(validated.status || 400).json({ error: validated.error, code: validated.code });
      }

      // A refund opened on the trop-perçu (rule 42) cannot exceed what is still over-collected: a double click, a
      // stale tab or a renamed label would otherwise give the same money back twice.
      if (req.body && req.body.fromOverpayment === true) {
        const remaining = storedOverpaymentTtc(id);
        const cents = (n) => Math.round(Number(n) * 100);
        const asked = validated.refund.lines.filter((l) => !l.lineKey).reduce((sum, l) => sum + l.amountTtc, 0);
        const claimed = Number(req.body.overpaymentTtc);
        if (cents(remaining) <= 0) {
          return res.status(409).json({ error: 'Le trop-perçu est déjà remboursé.', code: 'REFUND_EXCEEDS_OVERPAYMENT' });
        }
        if (cents(asked) > cents(remaining) || (Number.isFinite(claimed) && cents(claimed) > cents(remaining))) {
          return res.status(409).json({ error: `Dépasse le trop-perçu restant (${remaining.toFixed(2).replace('.', ',')} €).`, code: 'REFUND_EXCEEDS_OVERPAYMENT' });
        }
      }

      const refundId = refundsModel.create(id, validated.refund);
      const refreshed = buildRegister(id);
      return res.status(201).json({
        refund: refundsModel.getById(refundId),
        ...refreshed.payload,
      });
    },

    remove(req, res) {
      const id = Number(req.params.id);
      const refundId = Number(req.params.refundId);
      const removed = refundsModel.remove(id, refundId);
      if (!removed) return res.status(404).json({ error: 'Remboursement non trouvé' });
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
