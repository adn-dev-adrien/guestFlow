/**
 * The context every pricing-engine call of a stay carries besides the stay itself — what the SERVER
 * knows about it: the mid-stay and end-of-stay state, the booking date and the deposit deadline already
 * promised, the per-platform acompte and payout settings, the tourist-tax freeze.
 *
 * One module for the three callers of a stay's price — the live preview, the save, and the replay of a
 * stored stay (`reservationEngineInput`) — so a stay can never be priced with a different context in two
 * places (audit 2026-10-28: the replay left half of it out and installment plans, restamped buckets and
 * the tourist-tax declaration disagreed with the fiche).
 *
 * The models are the application's own, required on first use so that loading this module opens nothing.
 */
const { sasDetailAmount, sasDetailAmountAuto, storedMidStayLines } = require('./midStayExtras');
const { arrivalPaymentAdjustment } = require('./reservationSettlement');
const { getTodayIsoDate } = require('./reservationHelpers');
const { isTouristTaxFrozen } = require('./touristTaxFreeze');
const { DEFAULT_PAYOUT_DUE_DAYS } = require('./platformPayout');

// specs/mid-stay-extras-to-end-of-stay-complement.md — everything the engine needs to keep the
// prestations sold DURING the stay out of the pre-arrival / arrival-complement buckets: the arrival
// baseline, the part of the end-of-stay complement the departure SAS owns, and (once that complement
// is collected) the frozen mid-stay lines. All zeroed for a reservation-less quote (devis, public).
function midStayQuoteInputs(db, reservationId) {
  if (!reservationId || reservationId <= 0) return {};
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!row) return {};
  const model = require('../models/reservationsModel');
  const refundsModel = require('../models/refundsModel');
  return {
    arrivalExtrasBaseline: model.resolveArrivalExtrasBaseline(Number(reservationId)),
    endOfStaySasAmount: sasDetailAmount(row.endOfStayComplementDetail),
    // …et le même total sans la ligne d'ajustement, pour l'aide « Calcul auto » du champ.
    endOfStaySasAmountAuto: sasDetailAmountAuto(row.endOfStayComplementDetail),
    endOfStayComplementSettled: Number(row.endOfStayComplementPaid || 0) === 1
      || Number(row.endOfStayComplementPaidCash || 0) === 1,
    frozenMidStayLines: storedMidStayLines(row.endOfStayComplementDetail),
    // specs/mid-stay-notes.md — already collected during the stay: out of the remainder, still out
    // of the frozen pre-arrival buckets.
    midStaySettledNotes: row.midStaySettledNotes || null,
    complementCollected: Number(row.complementPaid || 0) === 1,
    // specs/defer-arrival-complement-to-checkout.md §3.3 rule 16 — a complement the operator moved to
    // the door reads under « fin de séjour » straight away, without waiting for the stay to start.
    complementDeferredToCheckout: Number(row.complementDeferredToCheckout || 0) === 1,
    // specs/reservation-refunds.md §3.3 — book-money refunds only: a caisse-interne refund is off the
    // books, exactly like the cash complements it mirrors.
    refundsTotal: refundsModel.totalsByReservation(Number(reservationId)).book,
    platformPenaltyAmount: row.platformPenaltyAmount,
    // specs/arrival-payment-detail-and-adjustment.md rule 21 — a réduction accordée on the single
    // arrival payment lowers the « total du séjour » exactly as a refund does (and a pourboire raises
    // it). Read from the row, never from the browser: it is money, and the helper already gates a
    // caisse-interne group out of the books.
    arrivalPaymentReduction: arrivalPaymentAdjustment(row).reduction,
    arrivalPaymentTip: arrivalPaymentAdjustment(row).tip,
  };
}

// specs/payment-schedule-and-cancellation.md §3.1 — the booking context every engine call needs:
// the day the stay was booked (anchor of the acompte deadline) and the deadline already promised,
// which no recompute may move. No stored row (creation, public quote) → the booking happens today.
function scheduleQuoteInputs(db, bookingId) {
  const fallback = { bookingDate: getTodayIsoDate(), existingDepositDueDate: null, kind: 'reservation', validUntil: null };
  if (!bookingId || bookingId <= 0) return fallback;
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(bookingId));
  if (!row) return fallback;
  return {
    bookingDate: row.createdAt || fallback.bookingDate,
    existingDepositDueDate: row.depositDueDate || null,
    kind: row.kind || 'reservation',
    validUntil: row.validUntil || null,
  };
}

// specs/platform-deposit-toggle.md — resolve the GLOBAL per-platform "takes an acompte?" flag from the
// platform name, to feed the pricing engine. Direct / unknown → 0 (no acompte).
function resolvePlatformTakesDeposit(platform) {
  if (platform == null || String(platform).trim() === '' || String(platform).toLowerCase() === 'direct') return 0;
  try { return require('../models/platformsModel').getDepositMode(platform); } catch (_) { return 0; }
}

// specs/platform-payout-due-date.md rule 6 — resolve the GLOBAL per-platform payout delay from the
// platform name, to feed the pricing engine. Own channels and unknown platforms fall back to the
// default; the engine ignores the value entirely on a direct booking.
function resolvePlatformPayoutDueDays(platform) {
  try { return require('../models/platformsModel').getPayoutDueDays(platform); } catch (_) { return DEFAULT_PAYOUT_DUE_DAYS; }
}

// specs/tourist-tax-matches-the-office-calculation.md rules 10-12 — the freeze is the SERVER's call,
// not the client's: it depends on whether the instalment carrying the tax has been collected, which
// the fiche cannot know better than the database. The client only ever asks for the opposite, through
// « Recalculer la taxe de séjour » (`refreshTouristTax`). No reservation → nothing stored to pin, so a
// fresh fiche always prices live. Shared by the preview and the save (rule 17): a save that ignored it
// re-priced a tax the guest had already paid.
function frozenTouristTaxInputs(db, reservationId, refreshTouristTax) {
  let frozen = null;
  if (Number(reservationId) > 0 && !refreshTouristTax) {
    const stored = db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(reservationId));
    if (stored && isTouristTaxFrozen(db, stored)) frozen = stored;
  }
  return {
    freezeTouristTax: Boolean(frozen),
    frozenTouristTaxTotal: frozen ? frozen.touristTaxTotal : 0,
    frozenTouristTaxRate: frozen ? frozen.touristTaxRate : 0,
    frozenTouristTaxBaseHt: frozen ? frozen.touristTaxFrozenBaseHt : null,
    frozenTouristTaxOccupants: frozen ? frozen.touristTaxFrozenOccupants : null,
    frozenTouristTaxAt: frozen ? frozen.touristTaxFrozenAt : null,
  };
}

module.exports = {
  midStayQuoteInputs, scheduleQuoteInputs, resolvePlatformTakesDeposit, resolvePlatformPayoutDueDays, frozenTouristTaxInputs,
};
