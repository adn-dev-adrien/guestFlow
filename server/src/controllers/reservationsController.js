/**
 * Reservations controller — orchestrates each endpoint: parse input → finance validation → pricing
 * engine → occupancy/capacity checks → model writes → response shaping. Holds the flow that used to
 * live inline in routes/reservations.js; all SQL is in reservationsModel, all rules in utils.
 */
const { platformDisplay } = require('../utils/platformDisplay');

const { todayIso: localTodayIso } = require('../utils/localDate');
const db = require('../database');
const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { resolvePlatformPaidGuests } = require('../utils/platformPaidGuests');
const { validateFinanceInputs, financeErrorBody } = require('../utils/financeValidation');
const { parseGroup, collectibleArrivalBuckets } = require('../utils/arrivalPaymentGroup');
const { validateArrivalPaymentDate } = require('../utils/arrivalPaymentDate');
const { buildArrivalPaymentDetail } = require('../utils/arrivalPaymentDetail');
const { resolveArrivalPaymentAdjustment } = require('../utils/arrivalPaymentAdjustment');
const { arrivalPaymentAdjustment } = require('../utils/reservationSettlement');
const { getNightBlocksFromTimes, buildOccupiedDatesFromReservations } = require('../utils/occupancy');
const { computeNextIcalSyncLocked, getTodayIsoDate } = require('../utils/reservationHelpers');
const { buildAuditSnapshotFromPayload, computeAuditChanges } = require('../utils/reservationAudit');
const { suggestBedDistribution } = require('../utils/bedDistribution');
const { computePlatformCommission } = require('../utils/platformCommission');
const { checkGuestCapacity } = require('../utils/capacity');
const { clearContribsOnUnflip } = require('../utils/forceItemContribsCapture');
const { recordStayPayment, defaultDeps: stayPaymentDeps } = require('../utils/stayPaymentRecorder');
const paymentProviders = require('../utils/paymentProviders');
const { resolveComplementPayment } = require('../utils/complementPayment');
const { isTouristTaxFrozen } = require('../utils/touristTaxFreeze');
const { sasDetailAmount, sasDetailAmountAuto, storedMidStayLines } = require('../utils/midStayExtras');
const { planMidStayNote } = require('../utils/midStayNotePlan');
const establishmentClosuresModel = require('../models/establishmentClosuresModel');
const { emit: emitPluginEvent } = require('../plugins/sdk/eventBus');
const reservationsModel = require('../models/reservationsModel');
const settingsModel = require('../models/settingsModel');
const termsController = require('./termsController');
const quotePostProcessors = require('../utils/quotePostProcessors');
const insuranceOffer = require('../utils/insuranceOffer');
const resourceOffer = require('../utils/resourceOffer');
const { reservationBlocks } = require('../utils/pluginReservationBlocks');

// specs/plugins-phase-3b-neat.md rule 5 — while no plugin offers the cancellation insurance, a booking
// keeps the line it carries exactly as stored and cannot gain one. Applies the gate to the engine
// input; answers 422 and returns false when the payload adds the insurance.
function gateInsurance(res, engineInput, bookingId) {
  const gate = insuranceOffer.gateSelection({
    db, bookingId, selectedOptions: engineInput.selectedOptions, lockedOptionLines: engineInput.lockedOptionLines,
  });
  if (gate.error) {
    res.status(gate.error.status).json({ error: gate.error.error, code: gate.error.code });
    return false;
  }
  engineInput.selectedOptions = gate.selectedOptions;
  engineInput.lockedOptionLines = gate.lockedOptionLines;
  // « Offert » is frozen too: a payload cannot turn the stored line into a free one, or back.
  engineInput.offeredOptionIds = insuranceOffer.freezeOffered(engineInput.offeredOptionIds, gate);
  // specs/plugins-phase-3c-hourly-resources.md rule 18 — the same for a resource sold by the hour
  // while no plugin offers it: kept as stored, never added.
  const resources = resourceOffer.gateResources({
    db, bookingId, selectedResources: engineInput.selectedResources, lockedResourceLines: engineInput.lockedResourceLines,
  });
  if (resources.error) {
    res.status(resources.error.status).json({ error: resources.error.error, code: resources.error.code });
    return false;
  }
  engineInput.selectedResources = resources.selectedResources;
  engineInput.lockedResourceLines = resources.lockedResourceLines;
  return true;
}
const refundsModel = require('../models/refundsModel');
const { overpaymentOf, overpaymentLinesOf } = require('../utils/overpayment');
const { firstSessionConflict, conflictError: sessionConflictError, sessionKey } = require('../utils/resourceSessionConflicts');
const resourceOtherUsesModel = require('../models/resourceOtherUsesModel');
const { formatCurrency } = require('../utils/devisHelpers');
const refundsController = require('./refundsController');
const propertyOptionDefaultsModel = require('../models/propertyOptionDefaultsModel');
const { carriedOfferedDefaultsToRestore } = require('../utils/propertyDefaultOptions');
const platformsModel = require('../models/platformsModel');
const { DEFAULT_PAYOUT_DUE_DAYS } = require('../utils/platformPayout');
const { isReceptionOnly, userHasRole, ADMIN } = require('../constants/roles');
const { isWithinSasWindow, sasLockReason } = require('../utils/sasEditWindow');
const { isDevisExpired } = require('../utils/devisValidity');
const { toReceptionReservationView, toReceptionReservationList, toReceptionPaymentPatch } = require('../utils/receptionView');
const {
  midStayExtrasWindow, arrivalLineFloors, arrivalExtrasViolations, extrasContentChanged,
} = require('../utils/midStayExtrasWindow');
const { extraLineKey } = require('../utils/midStayExtras');
const { buildLiveCheckoutComplement } = require('../utils/checkoutComplement');
const { createResultRecorder } = require('../utils/resultRecorder');
const { saveWithDraftClient } = require('../utils/draftClient');
const { buildLedger } = require('../utils/reservationLedger');
const { evaluateLedgerEdit } = require('../utils/ledgerAmountEdit');
const { validateCollectionDate } = require('../utils/arrivalPaymentDate');
const { parseNotes: parseMidStayNotes } = require('../utils/midStayExtras');
const ledgerLinks = require('../utils/ledgerLinks');
const installments = require('./installmentsController');

// specs/reservation-payment-ledger.md §3.1 — the payments ledger of a fiche, built by the server from
// the stored row (paid states, dates, caution, single payment) and, while the fiche is edited, the live
// quote (the unpaid amounts, rule 7). `live` carries the form values the quote does not echo.
function ledgerFor({ row, quote = null, live = {}, propertyId = null, overpayment = null }) {
  const id = row && row.id ? Number(row.id) : null;
  let links = [];
  let refunds = [];
  if (id) {
    try { links = require('../models/paymentLinksModel').listForReservation(id); } catch { links = []; }
    try { refunds = refundsModel.listByReservation(id); } catch { refunds = []; }
  }
  // specs/caution-live-from-property.md §3 — live from the property until received, then frozen.
  let cautionAmount = Number(row && row.cautionAmount) || 0;
  if (!(row && Number(row.cautionReceived || 0) === 1)) {
    const pid = Number(propertyId || (row && row.propertyId) || 0);
    const prop = pid ? db.prepare('SELECT defaultCautionAmount FROM properties WHERE id = ?').get(pid) : null;
    cautionAmount = Number(prop && prop.defaultCautionAmount) || 0;
  }
  return buildLedger({
    row,
    quote,
    live,
    links,
    refunds,
    overpayment,
    midStayNotes: parseMidStayNotes(row && row.midStaySettledNotes),
    cautionAmount,
    installmentPlan: id ? installments.planFor(id) : null,
    storedAccommodationPreArrival: quote ? null : storedAccommodationPreArrivalOf(row),
    canRequest: Boolean(paymentProviders.summary()),
    today: getTodayIsoDate(),
  });
}

// specs/reservation-payment-ledger.md rule 16 — the accommodation of the stored pre-arrival schedule:
// acompte + solde minus the tourist tax they carry (none when it is collected on arrival). The ceiling
// of the acompte the stored ledger names, the one the save refuses beyond.
function storedAccommodationPreArrivalOf(row) {
  if (!row || !row.id) return null;
  let taxOnArrival = Number(row.touristTaxInComplement || 0) === 1;
  try {
    const { TAX_ON_ARRIVAL_SQL } = require('../utils/touristTaxFreeze');
    const hit = db.prepare(`SELECT ${TAX_ON_ARRIVAL_SQL} AS onArrival FROM reservations r WHERE r.id = ?`).get(Number(row.id));
    if (hit) taxOnArrival = Boolean(hit.onArrival);
  } catch { /* the stored flag decides */ }
  const preArrival = Number(row.depositAmount || 0) + Number(row.balanceAmount || 0);
  return round2(Math.max(0, preArrival - (taxOnArrival ? 0 : Number(row.touristTaxTotal || 0))));
}

// specs/mid-stay-extras-to-end-of-stay-complement.md — everything the engine needs to keep the
// prestations sold DURING the stay out of the pre-arrival / arrival-complement buckets: the arrival
// baseline, the part of the end-of-stay complement the departure SAS owns, and (once that complement
// is collected) the frozen mid-stay lines. All zeroed for a reservation-less quote (devis, public).
function midStayQuoteInputs(reservationId) {
  if (!reservationId || reservationId <= 0) return {};
  const row = model.getRow(Number(reservationId));
  if (!row) return {};
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
function scheduleQuoteInputs(bookingId) {
  const fallback = { bookingDate: getTodayIsoDate(), existingDepositDueDate: null, kind: 'reservation', validUntil: null };
  if (!bookingId || bookingId <= 0) return fallback;
  const row = db.prepare('SELECT kind, createdAt, depositDueDate, validUntil FROM reservations WHERE id = ?').get(Number(bookingId));
  if (!row) return fallback;
  return {
    bookingDate: row.createdAt || fallback.bookingDate,
    existingDepositDueDate: row.depositDueDate || null,
    kind: row.kind || 'reservation',
    validUntil: row.validUntil || null,
  };
}

// specs/payment-schedule-and-cancellation.md §3.5 rule 25 — a cancelled stay is read-only. Its
// amounts and échéances are history (accounting still reads them) and its dates are back on sale,
// so any write would either rewrite the books or resurrect a booking nobody expects.
function cancelledGuard(reservationId) {
  const row = db.prepare('SELECT kind FROM reservations WHERE id = ?').get(Number(reservationId));
  if (row && String(row.kind) === 'cancelled') {
    return { status: 409, body: { error: 'Cette réservation est annulée et ne peut plus être modifiée.', code: 'RESERVATION_CANCELLED' } };
  }
  return null;
}

// specs/mid-stay-notes.md §4.3 — the two note actions carried by the payment PATCH. Business
// failures (nothing left to collect on that key, complement already settled…) are 409s carrying
// their code, so the fiche can show the reason and reload a fresh state.
function applyMidStayNoteActions(reservationId, body) {
  const settle = body.settleMidStayNote;
  const cancel = body.cancelMidStayNote;
  // specs/adjustable-complement-amounts.md §3.4 — editing a note in place: same transactional
  // contract, same error codes.
  const adjust = body.adjustMidStayNote;
  if (!settle && !cancel && !adjust) return null;
  try {
    // Rule 22 — the dialog sends the ticked keys and the remainder it opened on; the amounts are
    // derived here against the stored remainder (the fiche was saved first), never taken from the client.
    if (settle) {
      const row = model.getRow(reservationId) || {};
      const { items } = planMidStayNote({
        opening: settle.opening, current: storedMidStayLines(row.endOfStayComplementDetail), checkedKeys: settle.checkedKeys,
      });
      model.settleMidStayNote(reservationId, { items, cash: Boolean(settle.cash) });
    }
    if (cancel) model.cancelMidStayNote(reservationId, cancel.id);
    if (adjust) {
      model.adjustMidStayNote(reservationId, {
        id: adjust.id, total: adjust.total, paidDate: adjust.paidDate, cash: adjust.cash,
      });
    }
    return null;
  } catch (err) {
    if (err && err.code === 'NOTE_NOT_FOUND') return { status: 404, body: { error: err.message, code: err.code } };
    if (err && err.code) return { status: 409, body: { error: err.message, code: err.code } };
    throw err;
  }
}

// specs/platform-deposit-toggle.md — resolve the GLOBAL per-platform "takes an acompte?" flag from the
// platform name, to feed the pricing engine. Direct / unknown → 0 (no acompte).
function resolvePlatformTakesDeposit(platform) {
  if (platform == null || String(platform).trim() === '' || String(platform).toLowerCase() === 'direct') return 0;
  try { return platformsModel.getDepositMode(platform); } catch (_) { return 0; }
}

// specs/platform-payout-due-date.md rule 6 — resolve the GLOBAL per-platform payout delay from the
// platform name, to feed the pricing engine. Own channels and unknown platforms fall back to the
// default; the engine ignores the value entirely on a direct booking.
function resolvePlatformPayoutDueDays(platform) {
  try { return platformsModel.getPayoutDueDays(platform); } catch (_) { return DEFAULT_PAYOUT_DUE_DAYS; }
}

const model = reservationsModel;

// "Empty platform" must never be persisted. The data invariant is: every reservation
// either belongs to a platform (Airbnb, Booking, etc.) or is 'direct'. NULL / '' /
// whitespace-only are normalised to 'direct' on every save. Spec:
// specs/bed-config-in-linen-card.md §10 hotfix follow-up #4 (2026-06-05). The schema
// already declares DEFAULT 'direct' on the `platform` column; this coercion catches the
// case where the client sends an explicit empty string AND backfills any pre-existing
// NULL/'' rows via a paired migration at boot.
function normalisePlatform(platform) {
  if (platform == null) return 'direct';
  const trimmed = String(platform).trim();
  return trimmed === '' ? 'direct' : trimmed;
}

// Reservation number override (specs/reservation-number-and-search.md §3 rules 3-4): a non-empty value
// must be unique among reservations. Returns a 400 body when it collides, else null. An empty/undefined
// value is always OK (the model keeps the existing number or generates a fresh one).
function reservationNumberOverrideError(value, exceptId) {
  const override = value !== undefined && value !== null ? String(value).trim() : '';
  if (!override) return null;
  if (model.isReservationNumberTaken(override, exceptId)) {
    return { error: 'Ce numéro est déjà utilisé par une autre réservation.', code: 'RESERVATION_NUMBER_TAKEN' };
  }
  return null;
}

// specs/tariff-recipes/spec.md §3.4 rule 20bis — the maximum stay, mirror of MIN_NIGHTS: same
// 409-with-code + force-override contract, same iCal exemption.
function maxNightsErrorPayload(quote) {
  return {
    error: `Cette réservation comporte ${quote.nights} nuit(s), au-delà du maximum autorisé (${quote.requiredMaxNights}).`,
    code: 'MAX_NIGHTS',
    requiredMaxNights: quote.requiredMaxNights,
    nights: quote.nights,
    maxNightsRules: quote.maxNightsRules,
  };
}

// specs/tariff-recipes/spec.md §3.4 rule 23 — a changeover breach is refused with the same
// 409-with-code + force-override contract as MIN_NIGHTS. iCal imports never go through these
// handlers, so a platform booking that violates the constraint still imports (rule 24).
function changeoverErrorPayload(quote) {
  const parts = [];
  if (quote.changeoverArrivalBreached) parts.push(`une arrivée le ${quote.requiredArrivalDayLabel}`);
  if (quote.changeoverDepartureBreached) parts.push(`un départ le ${quote.requiredDepartureDayLabel}`);
  return {
    error: `Ces dates imposent ${parts.join(' et ')}.`,
    code: 'CHANGEOVER',
    requiredArrivalWeekday: quote.requiredArrivalWeekday,
    requiredDepartureWeekday: quote.requiredDepartureWeekday,
    requiredArrivalDayLabel: quote.requiredArrivalDayLabel,
    requiredDepartureDayLabel: quote.requiredDepartureDayLabel,
  };
}

// specs/bed-config-in-linen-card.md §3 rule 7 — true iff at least one optionId in the list
// maps to a `countsAsBedLinen = 1` row in `options`. Used by create + update to gate the
// bed-counts coercion: if the saved reservation has no bed-linen contract, `singleBeds /
// doubleBeds / babyBeds` are forced to 0 before insert/update (the values would never
// contribute to the laundry aggregation anyway — the SQL in `laundryModel.js` requires a
// flagged option). The query is tiny (option list ≤ ~10) so a single `IN` round-trip
// is fine.
function hasBedLinenOption(reservationOptions) {
  if (!Array.isArray(reservationOptions) || reservationOptions.length === 0) return false;
  const ids = reservationOptions
    .map((ro) => Number(ro && ro.optionId))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return false;
  const placeholders = ids.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT 1 FROM options WHERE id IN (${placeholders}) AND countsAsBedLinen = 1 LIMIT 1`,
  ).get(...ids);
  return Boolean(row);
}

// Shared capacity/bed validation for create & update. Returns an error string or null.
// The guest rule itself lives in utils/capacity.js — ONE total (adults + children + teens ≤
// maxGuests) plus a separate baby allowance (specs/property-capacity-single-total.md §3).
// `forceCapacity` is the operator's escape hatch: it lifts the guest guard only, never the beds one.
function checkCapacity({ propertyId, adults, children, teens, babies, singleBeds, doubleBeds, forceCapacity }) {
  const property = model.getPropertyCapacity(propertyId);
  if (!property) return null;

  if (!forceCapacity) {
    const breach = checkGuestCapacity(property, { adults, children, teens, babies });
    if (breach) return breach.message;
  }
  if (singleBeds !== null && singleBeds !== undefined && singleBeds !== '' && Number(singleBeds) > Number(property.singleBeds || 0)) {
    return `Le nombre de lits simples (${singleBeds}) dépasse la capacité du logement (${property.singleBeds || 0}).`;
  }
  if (doubleBeds !== null && doubleBeds !== undefined && doubleBeds !== '' && Number(doubleBeds) > Number(property.doubleBeds || 0)) {
    return `Le nombre de lits doubles (${doubleBeds}) dépasse la capacité du logement (${property.doubleBeds || 0}).`;
  }
  return null;
}

// Baby-bed count + availability check. Returns an error string or null.
function checkBabyBeds({ propertyId, startDate, endDate, children, babies, babyBeds, excludeId }) {
  const childrenCount = Number(children || 0);
  const babiesCount = Number(babies || 0);
  const babyBedsCount = Number(babyBeds || 0);
  if (babyBedsCount > babiesCount + childrenCount) {
    return `Le nombre de lits bébé (${babyBedsCount}) ne peut pas dépasser le nombre total de bébés et d'enfants (${babiesCount + childrenCount}).`;
  }
  const babyAvailable = model.getBabyBedAvailability(propertyId, startDate, endDate, excludeId);
  if (babyBedsCount > babyAvailable) {
    return `Lits bébé indisponibles: ${babyAvailable} restant(s) pour cette période.`;
  }
  return null;
}

// Insert quote resource lines with per-resource availability. Returns { error, status } or null.
function insertResourceLines(reservationId, quote, { propertyId, startDate, endDate, excludeId }) {
  for (const rr of quote.resourceLines || []) {
    const resource = model.getResourceById(rr.resourceId);
    if (!resource) return { status: 400, body: { error: `Ressource introuvable (id=${rr.resourceId})` } };
    // specs/plugins-phase-3c-hourly-resources.md rule 4 — hours, and no stock check, for `per_hour` only.
    if (resource.priceType !== 'per_hour') {
      const reserved = model.getResourceReservedQuantity(rr.resourceId, startDate, endDate, excludeId);
      const available = Number(resource.quantity) - Number(reserved);
      if (Number(rr.quantity || 0) > available) {
        return { status: 409, body: { error: `Ressource '${resource.name}' indisponible: ${available} restant(s) pour cette période.` } };
      }
    }
    const unitPrice = rr.unitPrice !== undefined ? Number(rr.unitPrice) : Number(resource.price || 0);
    const qty = Number(rr.quantity) || 1;
    const priceType = rr.priceType || resource.priceType || 'per_stay';
    model.insertResourceLine(reservationId, rr, unitPrice, qty, priceType);
  }
  return null;
}

// specs/plugins-phase-3c-hourly-resources.md rule 30 — sessions of the stay that use a resource more
// times at once than it exists are refused (409 `SESSIONS_OVERLAP`); so is a new session on a slot an
// external booking or another stay already holds (specs/hourly-resource-quantity-and-sas-scheduling.md
// rule 28, 409 `RESOURCE_SLOT_TAKEN`). Answers and returns false.
function refuseSessionConflict(res, resources, reservationId = null) {
  const conflict = firstSessionConflict(resources, (resourceId) => {
    try { return (db.prepare('SELECT quantity FROM resources WHERE id = ?').get(resourceId) || {}).quantity; } catch { return 1; }
  }, {
    occupiedOn: (resourceId, date) => resourceOtherUsesModel.occupiedOn({ resourceId, date, excludeReservationId: reservationId }),
    turnoverOf: (resourceId) => resourceOtherUsesModel.turnoverOf(resourceId),
    storedOf: (resourceId) => new Set(resourceOtherUsesModel.storedSessions({ reservationId, resourceId })
      .map((s) => sessionKey(String(s.date).slice(0, 10), s.start, s.end))),
  });
  if (!conflict) return true;
  res.status(409).json(sessionConflictError(conflict));
  return false;
}

// specs/reservation-refunds.md rule 34 — a save that brings the stay below what the guest already paid
// on the acompte and the solde is a trop-perçu: refused with its amount (409 `OVERPAID`) until the
// operator confirms (`forceOverpayment`), so the money received and the sale never diverge silently.
// A stay already over-collected can still be saved for anything else: only a save that ADDS to the
// trop-perçu is stopped.
function overpaymentIntroducedBy(reservationId, quote) {
  const row = model.getRow(reservationId);
  if (!row) return null;
  const captured = model.capturedScheduleContribs(reservationId);
  const refundedTtc = refundsModel.totalsByReservation(Number(reservationId)).withCash;
  // The stay as stored, re-priced: what it already held in excess before this save.
  let storedOver = 0;
  try {
    const stored = calculateReservationQuote(buildReservationEngineInput(db, row));
    storedOver = stored && !stored.error ? Number(stored.overCollectedTtc || 0) : 0;
  } catch {
    storedOver = 0;
  }
  const before = overpaymentOf({ row, captured, refundedTtc, engineOverTtc: storedOver });
  const after = overpaymentOf({
    row, captured, refundedTtc,
    depositAmount: quote.depositAmount, balanceAmount: quote.balanceAmount, engineOverTtc: quote.overCollectedTtc,
  });
  if (after <= before + 0.01) return null;
  return {
    error: `Trop-perçu : ${formatCurrency(after)} déjà encaissés au-delà du nouveau total.`,
    code: 'OVERPAID',
    overpaymentTtc: after,
    // Rule 35 — the same amount split by poste, for the refund the fiche opens next.
    overpaymentLines: overpaymentLinesOf({
      row, capturedByPoste: model.capturedScheduleContribsByPoste(reservationId), quote, overpaymentTtc: after,
    }),
  };
}

// The live trop-perçu of the fiche being edited (rule 34): the preview re-priced with the payment state
// the save would use (the stored flags), against the stored payments. Returns the amount and its split
// by poste (rule 35), each poste carrying what it collected and what the save would now make it cost —
// the figures the fiche shows beside the alert, since its summary keeps a frozen tax the save recomputes.
function liveOverpayment(reservationId, engineInput) {
  const none = { overpaymentTtc: 0, overpaymentLines: [] };
  const row = model.getRow(reservationId);
  if (!row) return none;
  const depositDisabled = Boolean(engineInput.depositDisabled);
  const savedInput = {
    ...engineInput,
    depositPaid: depositDisabled ? false : Number(row.depositPaid || 0) === 1,
    balancePaid: Number(row.balancePaid || 0) === 1,
    complementPaid: Number(row.complementPaid || 0) === 1,
    // Rule 36 — the save prices a paid acompte or solde on its stored amount: so does this preview.
    ...(Number(row.depositPaid || 0) === 1 && !depositDisabled ? { depositAmount: row.depositAmount } : {}),
    ...(Number(row.balancePaid || 0) === 1 ? { balanceAmount: row.balanceAmount } : {}),
    // The save prices the tax unpinned (performUpdate passes no freeze): mirror it, or the preview
    // would announce no trop-perçu where the save refuses one.
    freezeTouristTax: false,
  };
  const asSaved = quotePostProcessors.applySync({
    engineInput: savedInput, quote: calculateReservationQuote(savedInput), calculate: calculateReservationQuote,
  });
  if (!asSaved || asSaved.error) return none;
  const overpaymentTtc = overpaymentOf({
    row,
    captured: model.capturedScheduleContribs(reservationId),
    refundedTtc: refundsModel.totalsByReservation(Number(reservationId)).withCash,
    depositAmount: asSaved.depositAmount,
    balanceAmount: asSaved.balanceAmount,
    engineOverTtc: asSaved.overCollectedTtc,
  });
  return {
    overpaymentTtc,
    overpaymentLines: overpaymentLinesOf({
      row, capturedByPoste: model.capturedScheduleContribsByPoste(reservationId), quote: asSaved, overpaymentTtc,
    }),
  };
}

// A refusal raised inside the creation transaction: thrown to roll the whole write back, then answered
// as the HTTP error it carries.
class CreationRefused extends Error {
  constructor(refusal) {
    super(refusal.body && refusal.body.error);
    this.refusal = refusal;
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────

function suggestBeds(req, res) {
  const propertyId = Number(req.body.propertyId || 0);
  if (!propertyId) return res.status(400).json({ error: 'propertyId requis' });
  const property = model.getPropertyBeds(propertyId);
  if (!property) return res.status(404).json({ error: 'Logement non trouvé' });

  const suggestion = suggestBedDistribution({
    adults: req.body.adults,
    children: req.body.children,
    teens: req.body.teens,
    maxSingleBeds: property.singleBeds,
    maxDoubleBeds: property.doubleBeds,
  });
  return res.json({
    ...suggestion,
    maxSingleBeds: Number(property.singleBeds || 0),
    maxDoubleBeds: Number(property.doubleBeds || 0),
  });
}

// « Calculer la commission » of the fiche (specs/booking-extranet-intake.md §4.1): the rule lives here,
// the client only shows the figure.
// specs/mid-stay-notes.md rule 22 — the « Nouvelle note » total while the operator ticks and adds:
// the dialog prints `items` and `total`, it computes nothing.
function previewMidStayNote(req, res) {
  const { opening, current, checkedKeys } = req.body || {};
  res.json(planMidStayNote({ opening, current, checkedKeys }));
}

function platformCommission(req, res) {
  const { gross, payout, touristTax, acompteCommission, expectedNet } = req.body || {};
  const commission = computePlatformCommission({ gross, payout, touristTax, acompteCommission });
  // specs/reservation-payment-ledger.md rule 26 — « Marquer reçu » asks for the transfer: the gap with
  // the expected net and the commission it implies are worded here, the form only prints them.
  const hasExpected = expectedNet !== undefined && expectedNet !== null && expectedNet !== '';
  // Review of #727 (H-a) — without a known commission there is no expected net: the transfer is typed,
  // and the commission it implies is proposed from the gross.
  if (!hasExpected && req.body && req.body.forMark) {
    const p = Number(payout);
    if (payout === '' || payout == null || !Number.isFinite(p) || p <= 0) {
      return res.status(400).json({ error: 'Virement reçu : montant requis.' });
    }
    const fmt = require('../utils/reservationLedger').formatEuros;
    return res.json({
      commission, gap: null, gapLabel: null,
      commissionLabel: commission != null && commission > 0 ? `Commission solde → ${fmt(commission)}` : null,
    });
  }
  if (hasExpected) {
    const p = Number(payout);
    if (payout === '' || payout == null || !Number.isFinite(p) || p <= 0) {
      return res.status(400).json({ error: 'Virement reçu : montant requis.' });
    }
    const gap = round2(Number(expectedNet) - p);
    const fmt = require('../utils/reservationLedger').formatEuros;
    // Never a commission without the gross it is computed from, nor when the gap is the tourist tax
    // (a stay priced under the earlier tax convention): a commission is not the explanation then.
    const taxLike = [touristTax, req.body.taxEstimate].map((v) => round2(v)).filter((v) => v > 0);
    const gapIsTax = taxLike.some((t) => Math.abs(Math.abs(gap) - t) < 0.01);
    const none = Math.abs(gap) < 0.005;
    return res.json({
      commission,
      gap,
      gapLabel: none ? null : `Écart : ${fmt(gap)} avec le net attendu${gapIsTax ? ' (le montant de la taxe de séjour)' : ''}`,
      commissionLabel: commission == null || !(commission > 0) || none || gapIsTax ? null : `Commission solde → ${fmt(commission)}`,
    });
  }
  if (commission == null) return res.status(400).json({ error: 'Total facturé et virement requis' });
  return res.json({ commission });
}

function list(req, res) {
  const { propertyId, clientId, from, to } = req.query;
  // specs/ui-review-2026-10-19-operations.md rule 15 — the display name the calendar prints.
  const rows = model.list({ propertyId, clientId, from, to })
    .map((row) => ({ ...row, platformDisplay: platformDisplay(row.platform) }));
  res.json(isReceptionOnly(req.user) ? toReceptionReservationList(rows) : rows);
}

// Live "jump to a reservation" search (specs/reservation-number-and-search.md §3). Matching + shaping
// happen in the model; the controller just forwards the query string.
function search(req, res) {
  res.json(model.search({ q: req.query.q }));
}

function occupiedDates(req, res) {
  const { propertyId } = req.params;
  const { from, to, excludeReservationId } = req.query;
  if (!propertyId || !from || !to) {
    return res.status(400).json({ error: 'propertyId, from, and to are required' });
  }
  const reservations = model.getOccupiedReservations(propertyId, from, to, excludeReservationId);
  const occupiedFromReservations = buildOccupiedDatesFromReservations(reservations);
  const closures = establishmentClosuresModel.list({ propertyId, from, to });
  const closureDates = establishmentClosuresModel.expandClosuresToDates(closures);
  const merged = Array.from(new Set([...occupiedFromReservations, ...closureDates])).sort();
  res.json(merged);
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The arrival single payment, ready to render (specs/single-payment-at-check-in.md §3.4 rule 16):
 * what was handed over, when, by what means, and which buckets it covered — with their amounts as
 * they stand now, so the operator sees what the collection paid for.
 */
function buildArrivalPaymentView(row) {
  const group = parseGroup(row.arrivalPaymentGroup);
  const label = {
    deposit: 'acompte', balance: 'solde', complement: 'complément',
    endOfStayComplement: 'complément de fin de séjour',
  };
  const amountOf = {
    deposit: row.depositAmount, balance: row.balanceAmount, complement: row.complementAmount,
    endOfStayComplement: row.endOfStayComplementAmount,
  };
  if (group) {
    // specs/arrival-payment-detail-and-adjustment.md §3.1 — what the payment actually paid for. The
    // arrival complement's own itemisation is reused verbatim (offered lines included, so a geste
    // commercial stays visible at 0 €) rather than re-listed: one source for the SAS recap, the J-2
    // email and the fiche.
    const complementDetail = group.buckets.includes('complement')
      ? reservationsModel.buildArrivalComplementDetail(row.id, { includeOffered: true })
      : null;
    const detail = buildArrivalPaymentDetail(row, { buckets: group.buckets, complementDetail });
    const reduction = round2(row.arrivalPaymentReduction);
    const tip = round2(row.arrivalPaymentTip);
    // §3.2 — computed live from the lines, so the total the operator reads is always the sum of what
    // is printed above it, whatever a bucket did since the payment was recorded.
    const { floor } = resolveArrivalPaymentAdjustment({
      bucketsTotal: detail.bucketsTotal, accommodation: detail.accommodation, target: null,
    });
    return {
      at: group.at,
      total: round2(detail.bucketsTotal - reduction + tip),
      cash: group.cash === 1,
      means: group.cash === 1 ? 'Caisse interne' : 'CB / Chèque',
      covers: group.buckets.map((b) => ({
        bucket: b, label: label[b], amount: round2(amountOf[b]),
      })),
      lines: detail.lines,
      bucketsTotal: detail.bucketsTotal,
      accommodation: detail.accommodation,
      floor,
      reduction,
      tip,
    };
  }
  // specs/single-payment-from-the-fiche.md rules 2-3 — no group yet: what could still be collected as
  // ONE payment. Fewer than two buckets is not an offer: the per-bucket buttons already cover it, and
  // calling a lone settlement « paiement unique » would be a lie.
  const collectible = collectibleArrivalBuckets(row);
  if (collectible.length < 2) return null;
  return {
    collectible: {
      total: Math.round(collectible.reduce((sum, b) => sum + b.amount, 0) * 100) / 100,
      buckets: collectible,
      // The earliest date the operator may pick — the collection cannot predate the booking.
      bookedAt: String(row.createdAt || '').slice(0, 10) || null,
    },
  };
}

/**
 * specs/single-payment-from-the-fiche.md §3.2-§3.3 — record (or undo) the single arrival payment
 * from the fiche. The date is the operator's and is validated here, BEFORE the transaction opens, so
 * a refused date never leaves a half-written payment behind.
 */
function settleArrivalPayment(req, res) {
  const id = Number(req.params.id);
  const row = model.getRow(id);
  if (!row) return res.status(404).json({ error: 'Réservation non trouvée' });
  // Fail-closed: the reception role never sees the stay amounts, so it never settles them either.
  if (isReceptionOnly(req.user)) return res.status(403).json({ error: 'FORBIDDEN' });

  const mode = String(req.body?.mode || '');
  if (!['card', 'cash', 'undo', 'adjust'].includes(mode)) {
    return res.status(400).json({ error: 'Mode de règlement inconnu.' });
  }

  // specs/arrival-payment-detail-and-adjustment.md §3.2 — what the guest ACTUALLY handed over. Not a
  // settlement: the buckets, their dates and their means are left exactly as they are; only the
  // réduction accordée (or the pourboire) is written, derived server-side and clamped to the
  // accommodation. `null` clears it.
  if (mode === 'adjust') {
    const raw = req.body?.total;
    const cleared = raw === null || raw === undefined || raw === '';
    const target = cleared ? null : Number(raw);
    if (!cleared && !Number.isFinite(target)) {
      return res.status(400).json({ error: 'Le total encaissé doit être un montant.' });
    }
    const before = round2(parseGroup(row.arrivalPaymentGroup)?.total);
    const resolved = model.setArrivalPaymentAdjustment(id, { target });
    if (!resolved) return res.status(400).json({ error: 'ADJUST_NO_GROUP' });
    const detailed = model.getByIdWithDetails(id);
    if (resolved.total !== before) {
      const gesture = resolved.reduction > 0
        ? ` (réduction ${resolved.reduction} €)`
        : (resolved.tip > 0 ? ` (pourboire ${resolved.tip} €)` : '');
      model.addHistoryEntry(id, 'update', [{
        field: 'arrivalPaymentAdjustment',
        label: "Total encaissé à l'arrivée",
        from: `${before} €`,
        to: `${resolved.total} €${gesture}`,
      }]);
    }
    return res.json({ arrivalPayment: buildArrivalPaymentView(detailed), reservation: model.getRow(id) });
  }

  let date;
  if (mode !== 'undo') {
    const checked = validateArrivalPaymentDate(req.body?.date, {
      today: getTodayIsoDate(),
      bookedAt: String(row.createdAt || '').slice(0, 10),
    });
    if (!checked.ok) return res.status(400).json({ error: checked.reason });
    date = checked.date;
    if (collectibleArrivalBuckets(row).length === 0) {
      return res.status(409).json({ error: 'Il n\'y a plus rien à encaisser sur cette réservation.' });
    }
  }

  const result = model.settleArrivalBuckets(id, { mode, date });
  const after = model.getRow(id);
  // The view itemises the payment, which needs the options / ressources of the fiche — `getRow`
  // carries only the reservation columns.
  const detailed = model.getByIdWithDetails(id);
  // specs/arrival-departure-sas.md §3.7 — money decisions are always traceable.
  if (result.buckets.length > 0) {
    const covered = result.buckets.join(', ');
    model.addHistoryEntry(id, 'update', mode === 'undo'
      ? [{ field: 'arrivalPayment', label: 'Paiement unique à l\'arrivée', from: `${result.total} € (${covered})`, to: 'annulé' }]
      : [{
        field: 'arrivalPayment',
        label: 'Paiement unique encaissé à l\'arrivée',
        from: '',
        to: `${result.total} € — ${mode === 'cash' ? 'caisse interne' : 'CB / Chèque'} le ${date} — ${covered}`,
      }]);
  }
  return res.json({ arrivalPayment: buildArrivalPaymentView(detailed || after), reservation: after });
}

function storedHeadlineOf(row) {
  if (!row) return null;
  const { quoteHeadline, storedNetTotal } = require('../utils/quoteHeadline');
  const { isDirectChannel } = require('../utils/platformNameFormat');
  let refundsBookTtc = 0;
  try { refundsBookTtc = Number(refundsModel.totalsByReservation(Number(row.id)).book || 0); } catch { refundsBookTtc = 0; }
  const midStay = storedMidStayLines(row.endOfStayComplementDetail).reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  return quoteHeadline({
    finalPrice: row.finalPrice,
    touristTaxTotal: row.touristTaxTotal,
    platformTouristTaxWithheld: row.platformTouristTaxAmount == null || row.platformTouristTaxAmount === '' ? null : row.platformTouristTaxAmount,
    endOfStayComplementTotal: row.endOfStayComplementAmount,
    midStayRemainingTotal: midStay,
    sejourNetTotal: storedNetTotal(row, { refundsBookTtc }),
  }, { isPlatform: !isDirectChannel(row.platform) });
}

function storedSummaryOf(row) {
  if (!row) return null;
  const headline = storedHeadlineOf(row);
  const isPlatform = String(row.platform || 'direct').trim().toLowerCase() !== 'direct';
  const acompteCommission = isPlatform ? round2(row.acompteCommissionAmount) : 0;
  const soldeCommission = isPlatform ? round2(row.platformCommissionAmount) : 0;
  const totalCommission = round2(acompteCommission + soldeCommission);
  // With an installment plan the pre-arrival money is the plan's, not the (zeroed) acompte and solde.
  const preArrival = round2(Number(row.depositAmount || 0) + Number(row.balanceAmount || 0)
    + Number(row.installmentsPaidAmount || 0) + Number(row.installmentsUnpaidAmount || 0));
  const tax = round2(row.touristTaxTotal);
  // HT / TVA of the stored total, the live summary's rule (one rate, per poste, TTC → HT), on the
  // stored lines: options and resources as stored, the accommodation the rest of the stored price.
  const sumOf = (sql) => { try { return round2(db.prepare(sql).get(row.id).total); } catch { return 0; } };
  const optionsTotal = round2(sumOf('SELECT COALESCE(SUM(CASE WHEN COALESCE(offered,0)=1 THEN 0 ELSE totalPrice END),0) AS total FROM reservation_options WHERE reservationId = ?')
    + sumOf('SELECT COALESCE(SUM(CASE WHEN COALESCE(offered,0)=1 THEN 0 ELSE amount END),0) AS total FROM reservation_custom_options WHERE reservationId = ?'));
  const resourcesTotal = sumOf('SELECT COALESCE(SUM(CASE WHEN COALESCE(offered,0)=1 THEN 0 ELSE totalPrice END),0) AS total FROM reservation_resources WHERE reservationId = ?');
  const accommodation = round2(Math.max(0, Number(row.finalPrice || 0) - optionsTotal - resourcesTotal));
  const settings = settingsModel.read() || {};
  const vatRate = settings.vatRate != null ? Number(settings.vatRate) : 10;
  const vatOf = (ttc) => round2(ttc * (vatRate / (100 + vatRate)));
  const totalVatAmount = round2(vatOf(accommodation) + vatOf(optionsTotal) + vatOf(resourcesTotal));
  return {
    accommodation,
    accommodationBase: row.totalPrice == null ? null : round2(row.totalPrice),
    optionsTotal,
    resourcesTotal,
    vatRate,
    totalVatAmount,
    totalNetPrice: round2(Number(row.finalPrice || 0) - totalVatAmount),
    depositDueDate: row.depositDueDate || null,
    balanceDueDate: row.balanceDueDate || null,
    finalPrice: round2(row.finalPrice),
    touristTaxTotal: tax,
    touristTaxOriginalTotal: tax,
    platformTouristTaxWithheld: row.platformTouristTaxAmount == null || row.platformTouristTaxAmount === '' ? null : round2(row.platformTouristTaxAmount),
    depositAmount: round2(row.depositAmount),
    balanceAmount: round2(row.balanceAmount),
    complementAmount: round2(row.complementAmount),
    endOfStayComplementTotal: round2(row.endOfStayComplementAmount),
    preArrivalAmount: preArrival,
    totalStayPrice: round2(Number(row.finalPrice || 0) + tax),
    sejourNetTotal: headline ? (headline.label === 'Vous percevez' ? headline.amount : (headline.secondary ? headline.secondary.amount : headline.amount)) : null,
    acompteCommissionAmount: acompteCommission,
    platformCommissionAmount: soldeCommission,
    totalPlatformCommission: totalCommission,
    platformNetReceivedAmount: totalCommission > 0 ? round2(preArrival - totalCommission) : null,
    headline,
  };
}

function getById(req, res) {
  const reservation = model.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
  if (isReceptionOnly(req.user)) return res.json(toReceptionReservationView(reservation));
  // specs/reservation-refunds.md §4.3 — the register + the still-refundable lines ride the fiche
  // payload, so opening the reservation needs no extra round-trip (and the reception view, which is
  // finance-stripped by construction, never sees them).
  const register = refundsController.buildRegister(Number(req.params.id), reservation);
  res.json({
    ...reservation,
    ...(register ? register.payload : {}),
    // specs/single-payment-at-check-in.md §3.4 rule 16 — the single payment made at the door, shaped
    // for display: the fiche renders it and computes nothing (CLAUDE.md §6.0). `null` when the guest
    // paid the buckets separately, which is every reservation before this feature. The raw column
    // rides along untouched for the SAS, which re-reads it as the stored group.
    arrivalPayment: buildArrivalPaymentView(reservation),
    // specs/direct-installments.md §4.3 — the plan of a direct reservation, ready to render.
    installmentPlan: installments.planFor(reservation.id),
    // specs/reservation-payment-ledger.md rule 1 — the payments ledger, ready to render.
    ledger: ledgerFor({ row: { ...model.getRow(reservation.id), cautionAmount: reservation.cautionAmount } }),
    // Rule 39 — the headline of the sticky total bar, from the stored row: what the fiche shows while it
    // shows the stored ledger (rule 7), so the two never disagree.
    storedHeadline: storedHeadlineOf(model.getRow(reservation.id)),
    // Rule 44 — the money figures of the pricing summary, stored, for the same switch.
    storedSummary: storedSummaryOf(model.getRow(reservation.id)),
    // specs/plugins-phase-3b-neat.md rule 12 — what live plugins show on this stay (Neat: the
    // subscription chip and its actions), keyed by block, each shaped for display.
    pluginBlocks: reservationBlocks(reservation),
    // specs/terms-acceptance-record.md rules 21-22 — the CGV acceptance, ready to print.
    cgv: termsController.buildFicheBlock(reservation),
    // specs/plugins-phase-3a-online-payment.md rules 5, 18 — the payment buttons follow this, null
    // while no payment provider is ready.
    onlinePayment: paymentProviders.summary(),
    // specs/plugins-phase-3b-neat.md rule 22 — the options this stay carries that the catalogue now
    // hides (the insurance without Neat): the fiche draws them read-only.
    frozenOptions: insuranceOffer.frozenOptions(db, reservation.id),
    // specs/plugins-phase-3c-hourly-resources.md rule 18 — the same for the resources sold by the hour
    // while no plugin offers them.
    frozenResources: resourceOffer.frozenResources(db, reservation.id),
    // specs/mid-stay-extras-on-locked-fiche.md rule 13 — the lock decided by the server: the fiche
    // renders it and derives nothing (CLAUDE.md §6.0).
    editLock: model.getEditLock(Number(req.params.id), { today: getTodayIsoDate() }),
  });
}

function getHistory(req, res) {
  const reservation = model.getHistoryMeta(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
  res.json(model.getHistory(req.params.id));
}

// An expired devis is re-quoted at the current tariffs, so its stored lines must NOT lock the preview
// (specs/devis-extras-parity-and-price-lock.md §3 rule 14). Unknown id → treated as expired: nothing to
// replay anyway.
function isDevisPricingExpired(devisId) {
  const row = db.prepare("SELECT validUntil FROM reservations WHERE id = ? AND kind = 'devis'").get(devisId);
  if (!row) return true;
  return isDevisExpired(row.validUntil, getTodayIsoDate());
}

// specs/tourist-tax-matches-the-office-calculation.md rules 10-12 — the freeze is the SERVER's call,
// not the client's: it depends on whether the instalment carrying the tax has been collected, which
// the fiche cannot know better than the database. The client only ever asks for the opposite, through
// « Recalculer la taxe de séjour » (`refreshTouristTax`). No reservation → nothing stored to pin, so a
// fresh fiche always prices live. Shared by the preview and the save (rule 17): a save that ignored it
// re-priced a tax the guest had already paid.
function frozenTouristTaxInputs(reservationId, refreshTouristTax) {
  let frozen = null;
  if (Number(reservationId) > 0 && !refreshTouristTax) {
    const stored = db.prepare(`
      SELECT id, touristTaxTotal, touristTaxRate, touristTaxInComplement, touristTaxDeclaredAt,
             touristTaxFrozenAt, touristTaxFrozenBaseHt, touristTaxFrozenOccupants,
             balancePaid, complementPaid
      FROM reservations WHERE id = ?
    `).get(Number(reservationId));
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

// Does the payload keep the stay the tax was computed on — logement, dates and party?
function sameStayAsSold(stored, body) {
  if (!stored) return false;
  const num = (v) => Number(v || 0);
  return num(stored.propertyId) === num(body.propertyId)
    && String(stored.startDate) === String(body.startDate) && String(stored.endDate) === String(body.endDate)
    && num(stored.adults) === num(body.adults) && num(stored.children) === num(body.children)
    && num(stored.teens) === num(body.teens) && num(stored.babies) === num(body.babies);
}

async function calculatePrice(req, res) {
  const financeError = validateFinanceInputs({
    customPrice: { value: req.body.customPrice, kind: 'money' },
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    depositAmountOverride: { value: req.body.depositAmountOverride, kind: 'money' },
    // specs/adjustable-complement-amounts.md §3.1 rule 7 — the operator's complement amounts share the
    // money validator: finite, ≥ 0, '' meaning « not provided ».
    complementAmountOverride: { value: req.body.complementAmountOverride, kind: 'money' },
    endOfStayComplementAmountOverride: { value: req.body.endOfStayComplementAmountOverride, kind: 'money' },
    balanceAmount: { value: req.body.balanceAmount, kind: 'money' },
    discountPercent: { value: req.body.discountPercent, kind: 'percentage' },
  });
  if (financeError) return res.status(400).json(financeErrorBody(financeError));

  const propertyId = Number(req.body.propertyId);
  if (typeof db.ensureDefaultTimedOptionsForProperty === 'function' && Number.isFinite(propertyId) && propertyId > 0) {
    db.ensureDefaultTimedOptionsForProperty(propertyId);
  }

  const reservationId = Number(req.body.reservationId || 0);
  // A devis being edited locks its prices too, for as long as the quote is valid — same snapshot, same
  // engine inputs (specs/devis-extras-parity-and-price-lock.md §3 rule 13). The fiche sends `devisId`
  // so this preview shows exactly what the save will store; without it the operator saw today's
  // tariffs on screen and the quoted ones in the PDF.
  const devisId = Number(req.body.devisId || 0);
  const forceCurrentPricing = Boolean(req.body.forceCurrentPricing);
  let lockedPricing = {
    lockedNightlyBreakdown: req.body.lockedNightlyBreakdown,
    lockedOptionLines: req.body.lockedOptionLines,
    lockedResourceLines: req.body.lockedResourceLines,
  };
  const lockedBookingId = reservationId > 0 ? reservationId : (devisId > 0 && !isDevisPricingExpired(devisId) ? devisId : 0);
  if (lockedBookingId > 0 && !forceCurrentPricing) {
    const existingBooking = model.getPropertyIdOf(lockedBookingId);
    if (existingBooking && Number(existingBooking.propertyId) === Number(req.body.propertyId)) {
      lockedPricing = model.getPricingSnapshot(lockedBookingId);
    }
  }

  // specs/tourist-tax-matches-the-office-calculation.md rules 10-12 — the freeze is the SERVER's
  // call, not the client's: it depends on whether the instalment carrying the tax has been collected,
  // which the fiche cannot know better than the database. The client only ever asks for the opposite,
  // through « Recalculer la taxe de séjour » (`refreshTouristTax`). No reservationId → nothing stored
  // to pin, so a fresh fiche always prices live.
  const engineInput = {
    db,
    propertyId,
    startDate: req.body.startDate,
    endDate: req.body.endDate,
    checkInTime: req.body.checkInTime,
    checkOutTime: req.body.checkOutTime,
    adults: req.body.adults,
    children: req.body.children,
    teens: req.body.teens,
    // specs/tourist-tax-included-services-deduction.md rule 16 — a baby pays nothing but occupies the
    // lodging, and the tourist tax divides the night by the OCCUPANTS. `create`/`update` have always
    // passed it; this preview did not, so a stay with a cot showed one tax on screen and stored
    // another — and the « Suivi taxe de séjour » declaration sided with the save.
    babies: req.body.babies,
    babyBeds: req.body.babyBeds,
    // specs/baby-bed-supplement.md §3.3 rule 14 — the SAVED booking, whatever the state of its price
    // lock (an expired devis still keeps its cots free), so this preview shows what the save stores.
    bookingId: reservationId > 0 ? reservationId : devisId,
    discountPercent: req.body.discountPercent,
    customPrice: req.body.customPrice,
    selectedOptions: req.body.selectedOptions,
    customOptions: req.body.customOptions,
    selectedResources: req.body.selectedResources,
    depositPaid: req.body.depositPaid,
    balancePaid: req.body.balancePaid,
    extraGuestSurchargeOffered: req.body.extraGuestSurchargeOffered,
    depositAmount: req.body.depositAmount,
    depositAmountOverride: req.body.depositAmountOverride,
    // specs/reservation-payment-ledger.md rule 7 — the live quote prices the per-reservation opt-out
    // like the save does, so the ledger's solde is the one « Enregistrer » will store.
    depositDisabled: req.body.depositDisabled ? 1 : 0,
    // specs/adjustable-complement-amounts.md §3.2 rule 13 — applied last by the engine, over every
    // other branch, so it corrects even a frozen complement.
    complementAmountOverride: req.body.complementAmountOverride,
    balanceAmount: req.body.balanceAmount,
    offeredOptionIds: req.body.offeredOptionIds,
    lockedOptionUnits: req.body.lockedOptionUnits,
    lockedResourceUnits: req.body.lockedResourceUnits,
    lockedNightlyBreakdown: lockedPricing.lockedNightlyBreakdown,
    // specs/tariff-recipes/spec.md §3.2 rule 12bis — replay the tariff the reservation was sold
    // under. « Utiliser les tarifs actuels » (refreshPricingToCurrent) drops it with the rest of the
    // snapshot: re-pricing stays possible, but only as a deliberate act.
    lockedTariff: lockedPricing.lockedTariff,
    lockedOptionLines: lockedPricing.lockedOptionLines,
    lockedResourceLines: lockedPricing.lockedResourceLines,
    platform: req.body.platform,
    touristTaxInComplement: req.body.touristTaxInComplement,
    autoOptionsInComplement: req.body.autoOptionsInComplement,
    ...frozenTouristTaxInputs(reservationId, req.body.refreshTouristTax),
    // Read-only preview: the baseline is only CAPTURED on save, never here.
    ...midStayQuoteInputs(reservationId),
    // specs/payment-schedule-and-cancellation.md §3.1 — same booking context as the save, so the
    // échéances shown on the fiche are the ones that will be stored.
    ...scheduleQuoteInputs(reservationId > 0 ? reservationId : devisId),
    // specs/platform-commission-line.md — feed the operator-entered platform commission so the quote
    // returns the « total séjour − commission = net perçu » figures for the summary block.
    platformCommissionAmount: req.body.platformCommissionAmount,
    // specs/platform-per-echeance-commission.md — the acompte commission (solde = platformCommissionAmount).
    acompteCommissionAmount: req.body.acompteCommissionAmount,
    // specs/platform-payment-entry.md — the brut pins the total séjour (finalPrice = brut, accommodation
    // back-solved). Forwarded so the live preview reflects it.
    platformGrossAmount: req.body.platformGrossAmount,
    // specs/platform-extra-guest-complement.md §3.2 — previewed exactly as the save will capture it.
    platformPaidGuests: resolvePlatformPaidGuests(reservationId > 0 ? model.getRow(reservationId) : null, req.body),
    // specs/platform-tourist-tax-out-of-the-commission.md rule 6 — the tourist tax the platform kept,
    // which comes back out of the brut. Forwarded on the SAVE paths too, not just the preview: the
    // fiche and the books have to price identically (the divergence platform-payment-entry had to fix).
    platformTouristTaxAmount: req.body.platformTouristTaxAmount,
    // specs/platform-deposit-toggle.md — whether this platform takes an acompte (global per platform).
    platformTakesDeposit: resolvePlatformTakesDeposit(req.body.platform),
    // specs/platform-payout-due-date.md — the platform's payout delay, which sets the solde deadline
    // at `endDate + N` instead of the guest-facing J-30.
    platformPayoutDueDays: resolvePlatformPayoutDueDays(req.body.platform),
  };
  // specs/reservation-refunds.md rule 36 — a stored paid acompte or solde is priced on what it
  // collected, as the save does, whatever amount the fiche still carries from an earlier preview.
  if (reservationId > 0) {
    const stored = model.getRow(reservationId);
    if (stored && Number(stored.depositPaid || 0) === 1 && engineInput.depositPaid) engineInput.depositAmount = stored.depositAmount;
    if (stored && Number(stored.balancePaid || 0) === 1 && engineInput.balancePaid) engineInput.balanceAmount = stored.balanceAmount;
  }
  if (!gateInsurance(res, engineInput, reservationId > 0 ? reservationId : devisId)) return;
  let quote = calculateReservationQuote(engineInput);
  // The insurance price a plugin sets (specs/plugins-phase-3b-neat.md rule 2): the live preview may
  // call out and warms the cache the save then reads, so the fiche announces what the save will bill.
  quote = await quotePostProcessors.applyLive({ engineInput, quote, calculate: calculateReservationQuote });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });
  // specs/defer-arrival-complement-to-checkout.md §3.2 rule 7bis — the merged « complément de fin de
  // séjour » block, rebuilt from THIS quote so the card follows every edit live instead of showing
  // the last save. Payment flags and the deferral marker come from the stored row: the fiche's
  // buttons persist them immediately, so the row is always current.
  if (reservationId > 0) {
    const row = model.getRow(reservationId);
    if (row) quote.checkoutComplement = buildLiveCheckoutComplement({ row, quote });
    // specs/reservation-refunds.md rule 34 — the trop-perçu the fiche shows, live.
    if (row) Object.assign(quote, liveOverpayment(reservationId, engineInput));
  }

  // specs/reservation-payment-ledger.md rules 1, 7 — the ledger follows the live quote; the paid
  // states come from the stored row. A reception-only user never sees the amounts.
  if (!isReceptionOnly(req.user)) {
    const storedId = reservationId > 0 ? reservationId : devisId;
    const storedRow = storedId > 0 ? model.getRow(storedId) : null;
    const live = {
      platform: req.body.platform,
      depositDisabled: req.body.depositDisabled,
      depositAmountOverride: req.body.depositAmountOverride,
      platformPayoutAmount: req.body.platformPayoutAmount,
      startDate: req.body.startDate,
      ...(storedRow ? {} : { kind: devisId > 0 ? 'devis' : 'reservation' }),
    };
    // Rule 45 — whether today's quote differs from the stored money (amounts or due dates): the fiche
    // then shows the stored summary, never live lines next to stored totals.
    if (storedRow && storedRow.kind !== 'devis') {
      const c = (v) => Math.round(round2(v) * 100);
      quote.storedDrift = ['finalPrice', 'touristTaxTotal', 'depositAmount', 'balanceAmount', 'complementAmount']
        .some((f) => c(quote[f]) !== c(storedRow[f]))
        || String(quote.depositDueDate || '') !== String(storedRow.depositDueDate || '')
        || String(quote.balanceDueDate || '') !== String(storedRow.balanceDueDate || '');
    }
    quote.ledger = ledgerFor({
      row: storedRow,
      quote,
      live,
      propertyId,
      overpayment: { ttc: quote.overpaymentTtc, lines: quote.overpaymentLines },
    });
    // Rule 21 — the amount editor asks; the server answers the refusal or the consequence.
    const edit = req.body.ledgerEdit;
    if (edit && (edit.row === 'deposit' || edit.row === 'balance')) {
      const pastLocked = Boolean(storedRow && storedRow.kind === 'reservation' && storedRow.startDate
        && storedRow.startDate <= getTodayIsoDate()) && !(req.body.unlockPast && userHasRole(req.user, ADMIN));
      quote.ledgerEdit = evaluateLedgerEdit({
        row: edit.row,
        amount: edit.amount,
        quote,
        ledger: quote.ledger,
        stored: storedRow || {},
        pastLocked,
        evaluate: (customPrice) => quotePostProcessors.applySync({
          engineInput: { ...engineInput, customPrice },
          quote: calculateReservationQuote({ ...engineInput, customPrice }),
          calculate: calculateReservationQuote,
        }),
      });
    }
  }

  res.json(quote);
}

/**
 * Per-reservation unlock of the past-reservation lock (specs/settings-rationalization.md rule 17a).
 * An admin's request carrying `unlockPast: true` (or `?unlockPast=1`, for a DELETE without body)
 * lifts the lock for that request only — the fiche asked for it after an explicit « Déverrouiller ».
 * Any other role, or no flag, keeps the lock: the server stays authoritative.
 */
function pastUnlockRequested(req) {
  if (!userHasRole(req.user, ADMIN)) return false;
  return (req.body && req.body.unlockPast === true)
    || (req.query && String(req.query.unlockPast) === '1');
}

function createStay(req, res) {
  const financeError = validateFinanceInputs({
    customPrice: { value: req.body.customPrice, kind: 'money' },
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    depositAmountOverride: { value: req.body.depositAmountOverride, kind: 'money' },
    // specs/adjustable-complement-amounts.md §3.1 rule 7 — the operator's complement amounts share the
    // money validator: finite, ≥ 0, '' meaning « not provided ».
    complementAmountOverride: { value: req.body.complementAmountOverride, kind: 'money' },
    endOfStayComplementAmountOverride: { value: req.body.endOfStayComplementAmountOverride, kind: 'money' },
    balanceAmount: { value: req.body.balanceAmount, kind: 'money' },
    cautionAmount: { value: req.body.cautionAmount, kind: 'money' },
    platformCommissionAmount: { value: req.body.platformCommissionAmount, kind: 'money' },
    acompteCommissionAmount: { value: req.body.acompteCommissionAmount, kind: 'money' },
    platformGrossAmount: { value: req.body.platformGrossAmount, kind: 'money' },
    platformPayoutAmount: { value: req.body.platformPayoutAmount, kind: 'money' },
    platformTouristTaxAmount: { value: req.body.platformTouristTaxAmount, kind: 'money' },
    discountPercent: { value: req.body.discountPercent, kind: 'percentage' },
  });
  if (financeError) return res.status(400).json(financeErrorBody(financeError));

  // Reservation number override collision guard (specs/reservation-number-and-search.md §3 rule 4).
  const numberError = reservationNumberOverrideError(req.body.reservationNumber, null);
  if (numberError) return res.status(400).json(numberError);

  // Data invariant: never persist an empty platform — see `normalisePlatform`.
  req.body.platform = normalisePlatform(req.body.platform);

  // specs/reservations-backend-mvc.md rule 9 — a stay posted without times takes the PROPERTY's
  // defaults, never the model's 15:00 / 10:00 fallback: the engine prices an early arrival or a late
  // departure against those defaults, so a 16:00 property stored at 15:00 billed an « Arrivée
  // anticipée » on its first re-save.
  if (req.body.propertyId && (!req.body.checkInTime || !req.body.checkOutTime)) {
    const defaultTimes = model.getPropertyDefaultTimes(req.body.propertyId) || {};
    if (!req.body.checkInTime) req.body.checkInTime = defaultTimes.checkInTime;
    if (!req.body.checkOutTime) req.body.checkOutTime = defaultTimes.checkOutTime;
  }

  const {
    propertyId, clientId, startDate, endDate, adults, children, teens, babies,
    singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
    forceMinNights, forceMaxNights, forceCapacity, forceChangeover,
    options: rawReservationOptions, customOptions: reservationCustomOptions, resources: reservationResources,
  } = req.body;

  // Server-side enforcement of property option defaults (specs/devis-pdf-and-tourist-tax-fixes.md
  // §3.3 rule 13). Idempotent merge — defaults that are already in the payload stay untouched.
  // Symmetric with `devisModel.create` so both surfaces respect the contract regardless of which
  // client surface (UI form, raw API, future flow) issued the request.
  const optionsWithDefaults = (() => {
    if (!propertyId) return rawReservationOptions || [];
    const defaults = propertyOptionDefaultsModel.listForProperty(Number(propertyId));
    if (!defaults || defaults.length === 0) return rawReservationOptions || [];
    const existing = new Set((rawReservationOptions || []).map((o) => Number(o.optionId)));
    const toAdd = defaults
      .filter((d) => !existing.has(Number(d.optionId)))
      .map((d) => ({ optionId: Number(d.optionId), quantity: 1 }));
    return [...(rawReservationOptions || []), ...toAdd];
  })();
  // A property default never adds the insurance while it is not offered (phase 3b rule 5); a payload
  // that asks for it keeps it, and the gate below refuses it.
  const askedInsurance = (rawReservationOptions || []).some((o) => Number(o.optionId) === insuranceOffer.insuranceOptionId(db));
  const reservationOptions = askedInsurance ? optionsWithDefaults : insuranceOffer.dropInsurance(db, optionsWithDefaults);

  // BABY BEDS are exempt from the bed-linen invariant below (specs/bed-config-in-linen-card.md §10
  // follow-up 2026-06-08): a baby bed is an independent physical resource needed whenever there are
  // babies, and the engine prices it, so it is settled before the quote.
  const effectiveBabyBeds = babyBeds;
  req.body.babyBeds = effectiveBabyBeds;

  // Forward the offered flag of every property default into `offeredOptionIds` (rule 11 in §3.3).
  const propertyDefaultsOffered = propertyId
    ? propertyOptionDefaultsModel.listForProperty(Number(propertyId)).filter((d) => d.offered).map((d) => Number(d.optionId))
    : [];
  const offeredOptionIds = Array.from(new Set([
    ...((req.body.offeredOptionIds || []).map((id) => Number(id))),
    ...propertyDefaultsOffered,
  ]));

  // Per-reservation opt-out of the deposit/balance split — when 1, the engine collapses the
  // deposit to 0 and lets the balance absorb the whole pre-arrival total. See
  // specs/disable-deposit-per-reservation.md.
  const depositDisabledFlag = req.body.depositDisabled ? 1 : 0;

  const engineInput = {
    db,
    propertyId: Number(propertyId),
    startDate, endDate, checkInTime, checkOutTime,
    adults, children, teens, babies,
    // specs/baby-bed-supplement.md — no `bookingId`: the reservation does not exist yet, so it can
    // never be grandfathered and every cot is billed.
    babyBeds: effectiveBabyBeds,
    discountPercent: req.body.discountPercent,
    customPrice: req.body.customPrice,
    selectedOptions: reservationOptions,
    customOptions: reservationCustomOptions,
    selectedResources: reservationResources,
    extraGuestSurchargeOffered: req.body.extraGuestSurchargeOffered,
    depositAmount: req.body.depositAmount,
    depositAmountOverride: req.body.depositAmountOverride,
    // specs/adjustable-complement-amounts.md §3.2 rule 13 — applied last by the engine, over every
    // other branch, so it corrects even a frozen complement.
    complementAmountOverride: req.body.complementAmountOverride,
    balanceAmount: req.body.balanceAmount,
    offeredOptionIds,
    depositDisabled: depositDisabledFlag,
    // `platform` MUST reach the engine on CREATE too — without it a platform reservation is priced as
    // « direct » at creation (no single-transfer balance, no commission, no brut pin, no tax routing),
    // diverging from the live preview until the first edit.
    platform: req.body.platform,
    touristTaxInComplement: req.body.touristTaxInComplement,
    autoOptionsInComplement: req.body.autoOptionsInComplement,
    // specs/platform-payment-entry.md + platform-commission-line.md — these MUST reach the engine on SAVE
    // (not just the live preview), else the persisted finalPrice ignores the brut pin and the solde isn't
    // reduced to the net. Without this the fiche (live) and the books diverged (Yann P.: stored 983/892
    // vs fiche 994/903).
    platformCommissionAmount: req.body.platformCommissionAmount,
    platformGrossAmount: req.body.platformGrossAmount,
    // specs/platform-extra-guest-complement.md §3.2 rule 4 — a brut entered at creation captures the
    // composition sold by the platform.
    platformPaidGuests: resolvePlatformPaidGuests(null, req.body),
    // specs/platform-tourist-tax-out-of-the-commission.md rule 6 — the tourist tax the platform kept,
    // which comes back out of the brut. Forwarded on the SAVE paths too, not just the preview: the
    // fiche and the books have to price identically (the divergence platform-payment-entry had to fix).
    platformTouristTaxAmount: req.body.platformTouristTaxAmount,
    // specs/platform-deposit-toggle.md — whether this platform takes an acompte (global per platform).
    platformTakesDeposit: resolvePlatformTakesDeposit(req.body.platform),
    // specs/platform-payout-due-date.md — the platform's payout delay, which sets the solde deadline
    // at `endDate + N` instead of the guest-facing J-30.
    platformPayoutDueDays: resolvePlatformPayoutDueDays(req.body.platform),
    // specs/payment-schedule-and-cancellation.md §3.1 — booked today: the acompte is due
    // `depositDueDays` from now, the solde 30 days before arrival at the earliest.
    ...scheduleQuoteInputs(0),
  };
  if (!gateInsurance(res, engineInput, 0)) return;
  if (!refuseSessionConflict(res, engineInput.selectedResources)) return;
  let quote = calculateReservationQuote(engineInput);
  // The insurance price a plugin sets (specs/plugins-phase-3b-neat.md rule 2): cache only — the
  // preview warmed it, so the save bills what the preview announced.
  quote = quotePostProcessors.applySync({ engineInput, quote, calculate: calculateReservationQuote });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });
  if (quote.minNightsBreached && !forceMinNights) {
    return res.status(409).json({
      error: `Cette réservation comporte ${quote.nights} nuit(s), inférieur au minimum requis (${quote.requiredMinNights}).`,
      code: 'MIN_NIGHTS', requiredMinNights: quote.requiredMinNights, nights: quote.nights, minNightsRules: quote.minNightsRules,
    });
  }
  if (quote.maxNightsBreached && !forceMaxNights) {
    return res.status(409).json(maxNightsErrorPayload(quote));
  }
  if (quote.changeoverBreached && !forceChangeover) {
    return res.status(409).json(changeoverErrorPayload(quote));
  }

  // specs/bed-config-in-linen-card.md §3 rules 7 and 12 — single/double bed counts are only meaningful
  // when the saved reservation carries at least one `countsAsBedLinen = 1` option, so they are zeroed
  // otherwise. Read on the lines the engine kept (what is persisted), not on the payload: an option
  // not offered on this property is dropped by the engine, and the beds must go with it. Coerced
  // BEFORE `checkCapacity` so values that won't be persisted cannot trip the capacity error.
  // Mutating `req.body` is intentional: the model reads from it.
  const bedLinenIncluded = hasBedLinenOption(quote.optionLines);
  const effectiveSingleBeds = bedLinenIncluded ? singleBeds : 0;
  const effectiveDoubleBeds = bedLinenIncluded ? doubleBeds : 0;
  req.body.singleBeds = effectiveSingleBeds;
  req.body.doubleBeds = effectiveDoubleBeds;

  const nightBlocks = getNightBlocksFromTimes(checkInTime, checkOutTime);
  // The model rejects `startDate < today` by default. An admin who unlocked the fiche lifts that
  // single guard, so backfilling a past reservation is possible (rule 17a). Overlap / capacity /
  // closures still apply.
  const validationError = model.validateAvailability(
    propertyId, startDate, endDate, checkInTime, checkOutTime, null, nightBlocks,
    { allowPastDates: pastUnlockRequested(req) },
  );
  if (validationError) return res.status(409).json(validationError);

  const capacityError = checkCapacity({
    propertyId, adults, children, teens, babies,
    singleBeds: effectiveSingleBeds, doubleBeds: effectiveDoubleBeds,
    forceCapacity,
  });
  if (capacityError) return res.status(400).json({ error: capacityError });

  const babyError = checkBabyBeds({ propertyId, startDate, endDate, children, babies, babyBeds: effectiveBabyBeds, excludeId: null });
  if (babyError) return res.status(400).json({ error: babyError });

  // specs/reservation-number-and-search.md rule 13 — the row, its number and its lines are written as
  // one: a failure anywhere (a number collision, a resource no longer free) leaves no numberless stay
  // behind to block the dates and leak into the iCal export.
  const creation = db.transaction(() => {
    const id = model.insertReservation(req.body, quote, nightBlocks);
    model.addHistoryEntry(id, 'create', [
      { field: 'sourceType', label: 'Origine', from: null, to: 'Création manuelle' },
    ]);
    if (reservationOptions && reservationOptions.length > 0) model.insertOptions(id, quote.optionLines);
    if (reservationCustomOptions && reservationCustomOptions.length > 0) model.insertCustomOptions(id, quote.optionLines);
    model.insertNights(id, quote.nightlyBreakdown);

    if (reservationResources && reservationResources.length > 0) {
      const resourceError = insertResourceLines(id, quote, { propertyId, startDate, endDate, excludeId: null });
      if (resourceError) throw new CreationRefused(resourceError);
    }

    // specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rule 3 — a reservation created while the
    // stay is already running (walk-in, saisie a posteriori, import iCal) takes its own extras as the
    // baseline: nothing it was created with counts as sold mid-stay.
    model.captureArrivalExtrasBaselineIfDue(id);

    // specs/adjustable-complement-amounts.md §3.6 rule 36 — the fiche decides how an adjusted complement
    // splits across the accounting postes, and stores it. Runs after the lines: it reads them.
    model.syncComplementAllocation(id, { autoAmount: quote.complementAmountAuto });
    return id;
  });
  let reservationId;
  try {
    reservationId = creation();
  } catch (err) {
    if (err instanceof CreationRefused) return res.status(err.refusal.status).json(err.refusal.body);
    throw err;
  }

  res.json({ id: reservationId, reservationNumber: model.getReservationNumber(reservationId) });
  // Plugins react after the response and can never fail it (specs/plugins-phase-1-sdk.md rule 9).
  emitPluginEvent('reservation.created', { reservationId });
  // No acompte request leaves here (specs/payment-schedule-and-cancellation.md §1 amendment, rule 36):
  // the booking raises a `deposit_to_request` row on the dashboard instead, and the operator sends it.
}

// The HTTP creation of a stay. A client typed on the fiche (`newClient`) is written in the same
// transaction (specs/clients.md rule 13).
function create(req, res) {
  if (!req.body || req.body.clientId || !req.body.newClient) return createStay(req, res);
  const result = saveWithDraftClient({
    db,
    clientsModel: require('../models/clientsModel'),
    body: req.body,
    run: (body) => {
      const recorder = createResultRecorder();
      createStay({ ...req, body }, recorder);
      return recorder.result();
    },
  });
  return res.status(result.status).json(result.body);
}

const formatEurosFr = (n) => require('../utils/reservationLedger').formatEuros(n);

// specs/reservation-payment-ledger.md rules 16, 18, 21 — the save-side twin of the row editor.
function ledgerAmountRefusal({ body, stored, quote, engineInput }) {
  const blank = (v) => v === '' || v === null || v === undefined;
  const H = round2(quote.accommodationPreArrival);
  const storedOverride = blank(stored.depositAmountOverride) ? null : round2(stored.depositAmountOverride);
  const nextOverride = blank(body.depositAmountOverride) ? null : round2(body.depositAmountOverride);
  const depositPaid = Number(stored.depositPaid || 0) === 1;
  if (nextOverride != null && nextOverride !== storedOverride && !depositPaid && nextOverride > H + 0.004) {
    return `L'acompte ne dépasse pas l'hébergement (${formatEurosFr(H)}) : la taxe de séjour reste sur le solde.`;
  }
  // Rule 18 floor — a solde typed in the ledger never takes the accommodation under the acompte received.
  if (body.ledgerAmountEdit === 'balance' && depositPaid && quote.accommodationPreArrival < round2(stored.depositAmount) - 0.004) {
    const { floorPrice } = require('../utils/ledgerAmountEdit');
    const evaluate = (customPrice) => calculateReservationQuote({ ...engineInput, customPrice });
    const floorQuote = evaluate(floorPrice({ evaluate, startPrice: quote.accommodationAdjustedPrice, acompte: round2(stored.depositAmount) }));
    return `Pas en dessous de ${formatEurosFr(floorQuote.balanceAmount)} : l'acompte perçu (${formatEurosFr(stored.depositAmount)}) couvre déjà l'hébergement.`;
  }
  return null;
}

// Rule 23 — « Acompte : 252,00 € → 300,00 € », « Solde : 614,40 € → 600,00 € (acompte 266,40 €) ».
function ledgerHistoryChange({ body, stored, quote }) {
  const edited = body.ledgerAmountEdit;
  if (edited === 'deposit' && round2(stored.depositAmount) !== round2(quote.depositAmount)) {
    return { field: 'ledgerDepositAmount', label: 'Acompte', from: formatEurosFr(stored.depositAmount), to: formatEurosFr(quote.depositAmount) };
  }
  if (edited === 'balance' && round2(stored.balanceAmount) !== round2(quote.balanceAmount)) {
    return {
      field: 'ledgerBalanceAmount', label: 'Solde',
      from: formatEurosFr(stored.balanceAmount),
      to: `${formatEurosFr(quote.balanceAmount)} (acompte ${formatEurosFr(quote.depositAmount)})`,
    };
  }
  return null;
}

// The HTTP save of the fiche. The work itself lives in `performUpdate` so a server caller (a plugin,
// through `ctx.core.reservations.update`) goes through exactly the same validation, pricing, history and
// `reservation.updated` event as the operator's « Enregistrer » (specs/gites-de-france-mail-intake.md §4.1).
//
// specs/reservation-payment-ledger.md rules 29-30 (§9 Q3) — when the stay carries an open payment link,
// the save is first played in a rolled-back transaction to learn the amounts it would store. A link
// whose amount would change and that the guest has paid meanwhile refuses the save (409
// LINK_ALREADY_PAID); otherwise the save goes through and the stale links are retired and deactivated.
async function update(req, res) {
  try {
    const id = Number(req.params.id);
    const unlockPast = pastUnlockRequested(req);
    const open = openPaymentLinks(id);
    let stale = [];
    if (open.length > 0) {
      const preview = performUpdate(id, req.body, { unlockPast, dryRun: true });
      if (preview.status !== 200) return res.status(preview.status).json(preview.body);
      stale = ledgerLinks.staleLinks(open, preview.row);
      const paidLink = await ledgerLinks.findPaidStaleLink(stale, paymentProviders.active());
      if (paidLink) {
        return res.status(409).json({
          error: `Le lien de ${formatEurosFr(Number(paidLink.amountCents) / 100)} vient d'être payé : montant non modifié.`,
          code: 'LINK_ALREADY_PAID',
        });
      }
    }
    const result = performUpdate(id, req.body, { unlockPast });
    if (result.status === 200 && stale.length > 0) await retireStaleLinks(id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[reservations] update failed:', err);
    return res.status(500).json({ error: 'Enregistrement impossible.' });
  }
}

function openPaymentLinks(reservationId) {
  try {
    return require('../models/paymentLinksModel').listForReservation(Number(reservationId))
      .filter((l) => l.status === 'open');
  } catch {
    return [];
  }
}

// Rule 29 — retire every open link whose amount no longer matches the stored row, then deactivate it
// at the provider; a provider that cannot answer leaves the remote-deactivation marker for the poll.
async function retireStaleLinks(reservationId) {
  const paymentLinksModel = require('../models/paymentLinksModel');
  const row = model.getRow(Number(reservationId));
  if (!row) return;
  const retired = [];
  for (const link of ledgerLinks.staleLinks(openPaymentLinks(reservationId), row)) {
    retired.push(...paymentLinksModel.retireForAmountChange(reservationId, link.type, ledgerLinks.linkAmountCents(link.type, row)));
  }
  if (retired.length === 0) return;
  try {
    await require('../utils/paymentLinkDeactivation').deactivateAbandonedLinks(retired, { paymentLinksModel });
  } catch { /* the marker stays: the poll retries */ }
}

// `body` is the full PUT payload of the fiche (the model rewrites every column from it). `unlockPast`
// is the admin's « Déverrouiller cette fiche » for this one save. `dryRun` plays the save inside a
// transaction that is rolled back and returns the row it would have stored (`row`), without the
// `reservation.updated` event. Returns `{ status, body }`.
const DRY_RUN = Symbol('dry-run');
function performUpdate(reservationId, body, { unlockPast = false, dryRun = false } = {}) {
  const res = createResultRecorder();
  if (!dryRun) {
    applyUpdate({ body, params: { id: reservationId } }, res, Boolean(unlockPast));
    const result = res.result();
    // specs/direct-installments.md rule 17 — whoever saved (the fiche, a plugin, the SAS), the links that bill
    // an amount the save just changed are abandoned and deactivated; the poll retries should the provider fail.
    if (result.status === 200) installments.retireChangedLinks(reservationId);
    return result;
  }
  let preview = null;
  try {
    db.transaction(() => {
      applyUpdate({ body: structuredClone(body), params: { id: reservationId } }, res, Boolean(unlockPast), { silent: true });
      preview = { ...res.result(), row: model.getRow(Number(reservationId)) };
      throw DRY_RUN;
    })();
  } catch (err) {
    if (err !== DRY_RUN) throw err;
  }
  return preview;
}

const ARRIVAL_EXTRAS_FROZEN_MESSAGE = 'Une prestation vendue à l\'arrivée ne peut être ni retirée ni réduite.';
const MID_STAY_EXTRAS_CLOSED_MESSAGE = 'Complément de fin de séjour déjà encaissé : décocher « payé » ou déverrouiller la fiche.';

// specs/mid-stay-extras-on-locked-fiche.md rule 8 — inside the window the routing of every line is
// the stored one (a mid-stay sale goes to the end-of-stay complement whatever it is), so the payload
// cannot move it; a line with no stored counterpart falls back to the engine's default.
function pinStoredRouting(body, routing) {
  const pin = (line, stored) => {
    const { inComplement, ...rest } = line;
    return stored === undefined ? rest : { ...rest, inComplement: stored };
  };
  if (Array.isArray(body.options)) {
    body.options = body.options.map((o) => pin(o, routing.options.get(Number(o.optionId))));
  }
  if (Array.isArray(body.resources)) {
    body.resources = body.resources.map((r) => pin(r, routing.resources.get(Number(r.resourceId))));
  }
  if (Array.isArray(body.customOptions)) {
    const free = [...routing.customs];
    body.customOptions = body.customOptions.map((c) => {
      let at = c.customOptionId != null ? free.findIndex((s) => s.id === Number(c.customOptionId)) : -1;
      if (at < 0) {
        const key = extraLineKey({ isCustom: true, title: c.description });
        at = free.findIndex((s) => extraLineKey({ isCustom: true, title: s.description }) === key);
      }
      const [match] = at >= 0 ? free.splice(at, 1) : [];
      return pin(c, match ? match.inComplement : undefined);
    });
  }
  if (Array.isArray(body.autoOptionsInComplement)) {
    body.autoOptionsInComplement = body.autoOptionsInComplement
      .filter((optionId) => routing.options.get(Number(optionId)) === 1);
  }
}

// specs/mid-stay-extras-on-locked-fiche.md §3.3 — opens the window for this save when the fiche is
// locked and its end-of-stay complement is not collected. Pins everything rule 8 keeps locked
// (routing, tariff refresh, the bed counts of a linen sold at arrival) and returns the state the
// arrival floors are checked against; null when the window is closed or the fiche is unlocked.
function enterMidStayExtrasWindow(id, body, today) {
  if (!midStayExtrasWindow(model.getRow(id), today).extrasEditable) return null;
  // The fiche is locked, so the stay has started whether or not the check-in was marked: pin what it
  // carries now as « sold at arrival » (rule 10), unconditionally.
  model.captureArrivalExtrasBaseline(id);
  const baseline = model.getArrivalExtrasBaseline(id);
  const beforeLines = model.readExtraLinesWithQuantity(id);
  pinStoredRouting(body, model.getStoredRouting(id));
  body.refreshPricingToCurrent = false;
  // Rule 8 — the bed counts follow the linen line: they move only when the payload brings a bed-linen
  // option that was not sold at arrival; in every other case they stay what is stored.
  const floors = arrivalLineFloors(baseline, beforeLines);
  const newLinen = (Array.isArray(body.options) ? body.options : [])
    .filter((option) => !floors[`opt:${Number(option.optionId)}`]);
  if (!hasBedLinenOption(newLinen)) {
    const stored = model.getRow(id);
    body.singleBeds = stored.singleBeds;
    body.doubleBeds = stored.doubleBeds;
  }
  return { baseline, beforeLines };
}

function applyUpdate(req, res, pastUnlocked, { silent = false } = {}) {
  const financeError = validateFinanceInputs({
    customPrice: { value: req.body.customPrice, kind: 'money' },
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    depositAmountOverride: { value: req.body.depositAmountOverride, kind: 'money' },
    // specs/adjustable-complement-amounts.md §3.1 rule 7 — the operator's complement amounts share the
    // money validator: finite, ≥ 0, '' meaning « not provided ».
    complementAmountOverride: { value: req.body.complementAmountOverride, kind: 'money' },
    endOfStayComplementAmountOverride: { value: req.body.endOfStayComplementAmountOverride, kind: 'money' },
    balanceAmount: { value: req.body.balanceAmount, kind: 'money' },
    cautionAmount: { value: req.body.cautionAmount, kind: 'money' },
    platformCommissionAmount: { value: req.body.platformCommissionAmount, kind: 'money' },
    acompteCommissionAmount: { value: req.body.acompteCommissionAmount, kind: 'money' },
    platformGrossAmount: { value: req.body.platformGrossAmount, kind: 'money' },
    platformPayoutAmount: { value: req.body.platformPayoutAmount, kind: 'money' },
    platformTouristTaxAmount: { value: req.body.platformTouristTaxAmount, kind: 'money' },
    discountPercent: { value: req.body.discountPercent, kind: 'percentage' },
  });
  if (financeError) return res.status(400).json(financeErrorBody(financeError));

  // Data invariant: never persist an empty platform — see `normalisePlatform`.
  req.body.platform = normalisePlatform(req.body.platform);

  const id = Number(req.params.id);

  const cancelled = cancelledGuard(id);
  if (cancelled) return res.status(cancelled.status).json(cancelled.body);

  // specs/direct-installments.md rule 1 — a plan with money in keeps the reservation on the own channels.
  const planRefusal = installments.platformChangeRefusal(id, req.body.platform);
  if (planRefusal) return res.status(planRefusal.status).json(planRefusal.body);

  // specs/reservation-payment-ledger.md rule 13 — the save never writes a payment state: the four
  // caution columns are re-read from the database like the paid flags (single-payment-from-the-fiche
  // rule 11bis). The payment PATCH, with its guards, is the only way to change them.
  // The caution AMOUNT too (specs/caution-live-from-property.md rule 9): the fiche displays the live
  // property amount, so echoing it back rewrote the stored one — a phantom « Caution 0 € → 500 € » in
  // the history, and a 400 on every started stay once the property's default had moved.
  const storedCaution = model.getRow(id) || {};
  for (const col of ['cautionAmount', 'cautionReceived', 'cautionReceivedDate', 'cautionReturned', 'cautionReturnedDate']) {
    req.body[col] = storedCaution[col] ?? null;
  }

  // Reservation number override collision guard (specs/reservation-number-and-search.md §3 rule 4) —
  // a blank value keeps the existing number (handled in the model), so only a non-empty duplicate fails.
  const numberError = reservationNumberOverrideError(req.body.reservationNumber, id);
  if (numberError) return res.status(400).json(numberError);

  const todayIso = getTodayIsoDate();
  const midStayWindow = pastUnlocked ? null : enterMidStayExtrasWindow(id, req.body, todayIso);

  const {
    propertyId, clientId, startDate, endDate, adults, children, teens, babies,
    singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
    forceMinNights, forceMaxNights, forceCapacity, forceChangeover, refreshPricingToCurrent,
    options: rawUpdateOptions, customOptions: reservationCustomOptions, resources: reservationResources,
  } = req.body;

  // specs/reservation-option-immutability.md rule 3 — an existing reservation is frozen: on
  // update we persist exactly the operator's submitted option set. Property defaults are NOT
  // re-merged here (they apply on CREATE only, see the create path above), so editing a
  // reservation never adds an option it did not already carry. Options the reservation does
  // carry are present in `rawUpdateOptions` and thus preserved.
  //
  // specs/tourist-tax-included-services-deduction.md rules 4-5 — with ONE exception: a service
  // included in the rate (a property default marked « offerte ») that the reservation carries
  // cannot be dropped. The fiche locks its Switch ON; the server makes that a guarantee rather than
  // a UI convention, so the declared tourist-tax base can never depend on a keystroke. Still bounded
  // by what the reservation already carries — rule 3 above is untouched.
  const restoredIncludedOptionIds = propertyId
    ? carriedOfferedDefaultsToRestore({
      propertyId,
      carriedOptionIds: model.listCarriedOptionIds(id),
      submittedOptionIds: (rawUpdateOptions || []).map((o) => Number(o.optionId)),
      defaultsModel: propertyOptionDefaultsModel,
    })
    : [];
  const reservationOptions = restoredIncludedOptionIds.length > 0
    ? [...(rawUpdateOptions || []), ...restoredIncludedOptionIds.map((optionId) => ({ optionId, quantity: 1 }))]
    : (rawUpdateOptions || []);
  const updateOfferedOptionIds = Array.from(new Set([
    ...((req.body.offeredOptionIds || []).map((optId) => Number(optId))),
    ...restoredIncludedOptionIds,
  ]));
  // Keep `req.body.options` in sync so the model layer downstream (which reads from req.body)
  // persists the submitted list.
  req.body.options = reservationOptions;

  // BABY BEDS are exempt from the bed-linen invariant (specs/bed-config-in-linen-card.md §10 follow-up
  // 2026-06-08): kept regardless — they track an independent resource, priced by the engine.
  const effectiveBabyBeds = babyBeds;
  req.body.babyBeds = effectiveBabyBeds;

  const beforeAuditSnapshot = model.getAuditSnapshotFromDb(id);
  // `pastReservationLocked` gates the 14-field allowlist below. An admin drops it for this request
  // only, after « Déverrouiller cette fiche » (specs/settings-rationalization.md rule 17a).
  const pastReservationLocked = Boolean(beforeAuditSnapshot?.startDate && beforeAuditSnapshot.startDate <= todayIso)
    && !pastUnlocked;

  const existingReservation = model.getForUpdate(id);
  const canReuseLockedPricing = !refreshPricingToCurrent
    && existingReservation
    && Number(existingReservation.propertyId) === Number(propertyId);
  const lockedPricing = canReuseLockedPricing
    ? model.getPricingSnapshot(id)
    : { lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [], lockedTariff: null };

  // Per-reservation opt-out of the deposit/balance split. When ON, force-zero the deposit-
  // paid fields too so the accounting export emits a single journal entry. The pricing
  // engine reads depositDisabled directly to short-circuit the deposit math.
  // See specs/disable-deposit-per-reservation.md.
  const depositDisabledFlag = req.body.depositDisabled ? 1 : 0;
  // The stored state is the truth for the three payment flags (see `modelPayload` below): the quote
  // is priced on it too, so the frozen-schedule branches of the engine and the row that is about to
  // be written can never disagree.
  const storedPaymentForQuote = model.getRow(id) || {};
  const effectiveDepositPaid = depositDisabledFlag ? false : Number(storedPaymentForQuote.depositPaid || 0) === 1;
  const effectiveDepositPaidDate = depositDisabledFlag ? null : (storedPaymentForQuote.depositPaidDate || null);
  const effectiveBalancePaid = Number(storedPaymentForQuote.balancePaid || 0) === 1;
  const effectiveComplementPaid = Number(storedPaymentForQuote.complementPaid || 0) === 1;

  // specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rule 3 — capture the baseline BEFORE the
  // lines are replaced: the state the reservation had entering this save is exactly « what was sold
  // by the time the guest arrived », so an extra added in this very save is detected as mid-stay.
  model.captureArrivalExtrasBaselineIfDue(id);

  // specs/frozen-complement-trusts-client.md §3 rules 1-2 — a collected complement is frozen at what
  // was COLLECTED, so the engine must be fed the stored amount, never the one the browser computed:
  // a client-side quote built without the mid-stay baseline puts a sale made during the stay back
  // into the arrival complement, and the accounting then credits it twice.
  const frozenComplementAmount = effectiveComplementPaid
    ? storedPaymentForQuote.complementAmount
    : req.body.complementAmount;

  const engineInput = {
    db,
    propertyId: Number(propertyId),
    startDate, endDate, checkInTime, checkOutTime,
    adults, children, teens, babies,
    babyBeds: effectiveBabyBeds,
    // specs/baby-bed-supplement.md §3.3 — the stored row still holds the PRE-update cot count here,
    // which is exactly what decides the exemption: a reservation sold with cots keeps them free.
    bookingId: id,
    discountPercent: req.body.discountPercent,
    customPrice: req.body.customPrice,
    selectedOptions: reservationOptions,
    customOptions: reservationCustomOptions,
    selectedResources: reservationResources,
    extraGuestSurchargeOffered: req.body.extraGuestSurchargeOffered,
    depositPaid: effectiveDepositPaid,
    balancePaid: effectiveBalancePaid,
    complementPaid: effectiveComplementPaid,
    // specs/reservation-refunds.md rule 36 — a paid acompte or solde is priced on what it collected
    // (the stored amount), never on a figure the browser carried over from an earlier preview.
    depositAmount: effectiveDepositPaid ? storedPaymentForQuote.depositAmount : req.body.depositAmount,
    depositAmountOverride: req.body.depositAmountOverride,
    // specs/adjustable-complement-amounts.md §3.2 rule 13 — applied last by the engine, over every
    // other branch, so it corrects even a frozen complement.
    complementAmountOverride: req.body.complementAmountOverride,
    balanceAmount: effectiveBalancePaid ? storedPaymentForQuote.balanceAmount : req.body.balanceAmount,
    complementAmount: frozenComplementAmount,
    offeredOptionIds: updateOfferedOptionIds,
    lockedNightlyBreakdown: lockedPricing.lockedNightlyBreakdown,
    // specs/tariff-recipes/spec.md §3.2 rule 12bis — replay the tariff the reservation was SOLD
    // under. « Utiliser les tarifs actuels » (refreshPricingToCurrent) drops it with the rest of the
    // snapshot: re-pricing stays possible, but only as a deliberate act.
    lockedTariff: lockedPricing.lockedTariff,
    lockedOptionLines: lockedPricing.lockedOptionLines,
    lockedResourceLines: lockedPricing.lockedResourceLines,
    depositDisabled: depositDisabledFlag,
    platform: req.body.platform,
    touristTaxInComplement: req.body.touristTaxInComplement,
    autoOptionsInComplement: req.body.autoOptionsInComplement,
    // specs/platform-payment-entry.md + platform-commission-line.md — forward the brut (pins finalPrice)
    // and the commission (reduces the solde to the net) to the engine on SAVE, not just the live preview.
    platformCommissionAmount: req.body.platformCommissionAmount,
    platformGrossAmount: req.body.platformGrossAmount,
    // specs/platform-extra-guest-complement.md §3.2 rules 4-6 — captured on the save that enters the
    // brut, kept while it stays entered, cleared with it.
    platformPaidGuests: resolvePlatformPaidGuests(storedPaymentForQuote, req.body),
    // specs/platform-tourist-tax-out-of-the-commission.md rule 6 — the tourist tax the platform kept,
    // which comes back out of the brut. Forwarded on the SAVE paths too, not just the preview: the
    // fiche and the books have to price identically (the divergence platform-payment-entry had to fix).
    platformTouristTaxAmount: req.body.platformTouristTaxAmount,
    // specs/platform-deposit-toggle.md — whether this platform takes an acompte (global per platform).
    platformTakesDeposit: resolvePlatformTakesDeposit(req.body.platform),
    // specs/platform-payout-due-date.md — the platform's payout delay, which sets the solde deadline
    // at `endDate + N` instead of the guest-facing J-30.
    platformPayoutDueDays: resolvePlatformPayoutDueDays(req.body.platform),
    // specs/tourist-tax-matches-the-office-calculation.md rule 17 — a save that leaves the stay as it
    // was sold (logement, dates, party) pins a collected tax like the preview does: a rate moved since
    // never rewrites what the guest paid. A save that changes the stay re-prices it, so the difference
    // surfaces as a trop-perçu or an amount owed (specs/reservation-refunds.md rules 34-36).
    ...frozenTouristTaxInputs(id, req.body.refreshTouristTax || !sameStayAsSold(existingReservation, req.body)),
    ...midStayQuoteInputs(id),
    // The acompte deadline was promised on the booking day: an edit never moves it (rule 4).
    ...scheduleQuoteInputs(id),
  };
  if (!gateInsurance(res, engineInput, Number(id))) return;
  if (!refuseSessionConflict(res, engineInput.selectedResources, Number(id))) return;
  req.body.options = engineInput.selectedOptions;
  let quote = calculateReservationQuote(engineInput);
  // The insurance price a plugin sets (specs/plugins-phase-3b-neat.md rule 2): same as the preview.
  quote = quotePostProcessors.applySync({ engineInput, quote, calculate: calculateReservationQuote });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });

  // specs/platform-payout-due-date.md §3.5 rule 38 — a started or finished stay keeps the solde
  // deadline it was stored with. « Existing rows re-derive on their next save » (§3.0 arbitrage) can
  // never apply to them: the deadline is not in the locked-fields allowlist below, so the re-derivation
  // turns every later edit — entering the platform payment, ticking a paid flag — into a 400.
  if (pastReservationLocked && storedPaymentForQuote.balanceDueDate) {
    quote.balanceDueDate = storedPaymentForQuote.balanceDueDate;
  }

  // specs/reservation-payment-ledger.md rule 21 — the amounts the ledger sets are validated again
  // here, so a crafted request meets the same refusal as the row editor. New writes only: an override
  // stored before this rule and clamped since by a price drop is left as it is (rule 17).
  const ledgerRefusal = ledgerAmountRefusal({ body: req.body, stored: storedPaymentForQuote, quote, engineInput });
  if (ledgerRefusal) return res.status(400).json({ error: ledgerRefusal, code: 'LEDGER_AMOUNT_REFUSED' });

  // specs/bed-config-in-linen-card.md §3 rules 7 and 12 — invariant on save: zero single/double bed
  // counts when the lines the engine kept carry no bed-linen option (no linen contract). Read on the
  // persisted lines, not the payload, so an option the engine drops takes the beds with it.
  const bedLinenIncluded = hasBedLinenOption(quote.optionLines);
  const effectiveSingleBeds = bedLinenIncluded ? singleBeds : 0;
  const effectiveDoubleBeds = bedLinenIncluded ? doubleBeds : 0;
  req.body.singleBeds = effectiveSingleBeds;
  req.body.doubleBeds = effectiveDoubleBeds;

  const afterAuditSnapshot = buildAuditSnapshotFromPayload(req.body, quote);
  if (midStayWindow) {
    const violations = arrivalExtrasViolations(
      midStayWindow.baseline, midStayWindow.beforeLines, [...(quote.optionLines || []), ...(quote.resourceLines || [])],
    );
    if (violations.length > 0) {
      return res.status(400).json({ error: ARRIVAL_EXTRAS_FROZEN_MESSAGE, code: 'ARRIVAL_EXTRAS_FROZEN', lines: violations });
    }
  }
  if (pastReservationLocked) {
    const allowedLockedFields = new Set([
      'clientId', 'platform', 'touristTaxRate', 'touristTaxTotal', 'discountPercent', 'finalPrice',
      'extraGuestSurchargeOffered', 'platformPaidGuests', 'depositAmount', 'balanceAmount', 'depositPaid', 'balancePaid',
      // The acompte typed in the ledger moves `depositAmount`, which is allowed; the override that
      // carries it is audited since the 2026-10-27 review (reservation-history-granular-diff rule 13).
      'depositAmountOverride',
      // The caution columns left this list with specs/reservation-payment-ledger.md rule 13: the save
      // carries the stored values back, only the payment PATCH changes them.
      // `depositDisabled` is allowed on past reservations too — an admin may realise after
      // the fact that a booking was platform-handled and should never have had a deposit.
      // See specs/disable-deposit-per-reservation.md §3.6.
      'depositDisabled',
      // Force-item routing toggles can still be flipped on a past-locked reservation: they only
      // shuffle money between buckets (Acompte/Solde/Complément), not the underlying total. The
      // accounting export needs them to stay editable so the operator can correct miscategories
      // discovered later. See specs/force-item-to-complement.md §7.
      'touristTaxInComplement',
    ]);
    // specs/mid-stay-extras-on-locked-fiche.md rule 9 — the extras and what they move on the row.
    if (midStayWindow) {
      ['totalPrice', 'optionsSignature', 'resourcesSignature', 'singleBeds', 'doubleBeds']
        .forEach((field) => allowedLockedFields.add(field));
    }
    const forbiddenChanges = computeAuditChanges(beforeAuditSnapshot, afterAuditSnapshot)
      .filter((change) => !allowedLockedFields.has(change.field));
    const extrasFields = new Set(['optionsSignature', 'resourcesSignature']);
    const collected = midStayExtrasWindow(storedPaymentForQuote, todayIso).extrasClosedReason === 'endOfStayCollected';
    if (collected && forbiddenChanges.length > 0 && forbiddenChanges.every((change) => extrasFields.has(change.field))
      && extrasContentChanged(model.readExtraLinesWithQuantity(id), [...(quote.optionLines || []), ...(quote.resourceLines || [])])) {
      return res.status(400).json({ error: MID_STAY_EXTRAS_CLOSED_MESSAGE, code: 'MID_STAY_EXTRAS_CLOSED' });
    }
    if (forbiddenChanges.length > 0) {
      return res.status(400).json({
        error: 'Cette réservation est passée ou en cours. Seuls le client, la plateforme, les ajustements de prix et les statuts de paiement/caution peuvent encore être modifiés.',
        code: 'PAST_RESERVATION_LOCKED',
      });
    }
  }

  if (quote.minNightsBreached && !forceMinNights && !pastReservationLocked) {
    return res.status(409).json({
      error: `Cette réservation comporte ${quote.nights} nuit(s), inférieur au minimum requis (${quote.requiredMinNights}).`,
      code: 'MIN_NIGHTS', requiredMinNights: quote.requiredMinNights, nights: quote.nights, minNightsRules: quote.minNightsRules,
    });
  }
  if (quote.maxNightsBreached && !forceMaxNights && !pastReservationLocked) {
    return res.status(409).json(maxNightsErrorPayload(quote));
  }
  if (quote.changeoverBreached && !forceChangeover && !pastReservationLocked) {
    return res.status(409).json(changeoverErrorPayload(quote));
  }
  if (!req.body.forceOverpayment) {
    const overpaid = overpaymentIntroducedBy(id, quote);
    if (overpaid) return res.status(409).json(overpaid);
  }

  const nightBlocks = getNightBlocksFromTimes(checkInTime, checkOutTime);

  if (!pastReservationLocked) {
    // specs/edit-reservation-blocked-by-overlap.md — on an EXISTING reservation, only run a guard
    // when the edit actually touched what that guard protects. A finance-only edit (e.g. entering the
    // platform payment) on a reservation that already overlaps another or already exceeds capacity
    // (common on iCal imports) must NOT be rejected — the conflict pre-exists and isn't introduced by
    // this save. Moving the reservation INTO a conflict (changing dates/place/occupancy) still validates.
    const prev = existingReservation || {};
    const sameNum = (a, b) => Number(a || 0) === Number(b || 0);
    const sameStr = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);
    // Rule 5 — the check-in/out TIMES and the baby-bed count are part of the comparison, on their
    // EFFECTIVE value: older iCal imports stored NULL times (and NULL bed counts) and the fiche fills
    // them from the property defaults on load, so a NULL time compares as the property's default and a
    // NULL baby-bed count as « not set ». A phantom change on every edit of an imported reservation is
    // what the comparison must not see; a departure moved to 18:00 is what it must.
    const defaultTimes = model.getPropertyDefaultTimes(propertyId) || {};
    const sameTime = (stored, posted, fallback) => sameStr(stored || fallback, posted || fallback);
    const placementUnchanged = existingReservation
      && sameNum(prev.propertyId, propertyId)
      && sameStr(prev.startDate, startDate) && sameStr(prev.endDate, endDate)
      && sameTime(prev.checkInTime, checkInTime, defaultTimes.checkInTime)
      && sameTime(prev.checkOutTime, checkOutTime, defaultTimes.checkOutTime);
    const occupancyUnchanged = existingReservation
      && sameNum(prev.propertyId, propertyId)
      && sameNum(prev.adults, adults) && sameNum(prev.children, children)
      && sameNum(prev.teens, teens) && sameNum(prev.babies, babies)
      && (prev.babyBeds == null || sameNum(prev.babyBeds, effectiveBabyBeds));

    // Same logic as the `create` flow: lift the model-level "no past startDate" guard when the
    // admin unlocked the fiche, so a past startDate can be kept while editing unrelated fields.
    if (!placementUnchanged) {
      const validationError = model.validateAvailability(
        propertyId, startDate, endDate, checkInTime, checkOutTime, id, nightBlocks,
        { allowPastDates: pastUnlocked },
      );
      if (validationError) return res.status(409).json(validationError);
    }

    if (!occupancyUnchanged) {
      const capacityError = checkCapacity({
        propertyId, adults, children, teens, babies,
        singleBeds: effectiveSingleBeds, doubleBeds: effectiveDoubleBeds,
        forceCapacity,
      });
      if (capacityError) return res.status(400).json({ error: capacityError });

      const babyError = checkBabyBeds({ propertyId, startDate, endDate, children, babies, babyBeds: effectiveBabyBeds, excludeId: id });
      if (babyError) return res.status(400).json({ error: babyError });
    }
  }

  const nextIcalSyncLocked = computeNextIcalSyncLocked(existingReservation);
  // Build the model payload — same as req.body, but with the depositPaid* fields force-
  // zeroed when depositDisabled is on. The pricing engine already collapsed depositAmount
  // to 0 above; this prevents an inconsistent persisted state where the deposit is
  // "disabled" yet still flagged paid (which would re-emit a phantom journal entry).
  // See specs/disable-deposit-per-reservation.md.
  //
  // specs/single-payment-from-the-fiche.md rule 11bis — and the three payment flags come from the
  // STORED row, never from the browser. They are not form fields: « Marquer solde payé », the SAS and
  // « Encaisser en une fois » each write them through their own endpoint, and the form only mirrors
  // what they wrote. A save therefore carries them back UNCHANGED at best — and STALE at worst, when
  // the fiche was loaded before the money was recorded. Echoing a stale copy back un-paid a bucket
  // that had really been collected, and un-paying a bucket dissolves the single payment that named
  // it: measured in production on réservation 22281 (2026-08-31), where « Encaisser en une fois »
  // followed by « Enregistrer » lost the group every single time.
  const storedPayment = model.getRow(id) || {};
  const modelPayload = {
    ...req.body,
    depositPaid: Number(storedPayment.depositPaid || 0) === 1,
    depositPaidDate: storedPayment.depositPaidDate || null,
    balancePaid: Number(storedPayment.balancePaid || 0) === 1,
    balancePaidDate: storedPayment.balancePaidDate || null,
    complementPaid: Number(storedPayment.complementPaid || 0) === 1,
    complementPaidDate: storedPayment.complementPaidDate || null,
    // …except the one flag this save legitimately owns: disabling the deposit force-zeroes it, so the
    // accounting stops emitting a phantom entry for an échéance that no longer exists.
    ...(depositDisabledFlag ? { depositPaid: false, depositPaidDate: null } : {}),
  };
  // The row, its lines and its history land together: a refused resource (409) must not leave the
  // lines half rewritten (specs/mid-stay-extras-on-locked-fiche.md).
  const writeAll = () => {
    model.updateReservation(id, modelPayload, quote, nightBlocks, nextIcalSyncLocked);
    // specs/direct-installments.md rules 7, 8, 13 — the plan follows the new total.
    installments.syncAfterSave(id, quote);

    // Nights are never rewritten on a locked fiche, but its extras are while the window is open.
    const writesExtras = !pastReservationLocked || Boolean(midStayWindow);
    if (writesExtras && reservationOptions) model.replaceOptions(id, quote.optionLines);
    if (writesExtras) {
      const sasOriginLabels = model.sasOriginCustomLabels(id);
      model.deleteCustomOptions(id);
      if (reservationCustomOptions) model.insertCustomOptions(id, quote.optionLines, sasOriginLabels);
    }
    if (!pastReservationLocked) model.replaceNights(id, quote.nightlyBreakdown);
    // specs/tariff-recipes/spec.md §3 rule 62 — the tariff snapshot follows the nights it describes:
    // a night added, or a stay repriced because its arrival moved (rule 57), is stored with the season
    // it was priced under, so the next save replays exactly what this one stored.
    if (!pastReservationLocked) {
      model.refreshTariffSnapshot(id, quote.tariffSnapshot, { replayed: Boolean(lockedPricing.lockedTariff) });
    }

    if (writesExtras && reservationResources) {
      model.deleteResources(id);
      const resourceError = insertResourceLines(id, quote, { propertyId, startDate, endDate, excludeId: id });
      if (resourceError) throw new CreationRefused(resourceError);
    }

    // specs/mid-stay-extras-to-end-of-stay-complement.md §3.4 rule 11 — the engine has computed what was
    // sold during the stay; store it as the mid-stay lines of the end-of-stay complement (the SAS-owned
    // lines are preserved, the amount is re-totalled). Frozen once that complement is collected.
    model.syncMidStayComplement(id, quote.midStayExtrasLines);

    // specs/adjustable-complement-amounts.md §3.6 rule 36 — same ventilation, recomputed at every save
    // so a new option or a re-priced line moves the postes, never the announced total.
    model.syncComplementAllocation(id, { autoAmount: quote.complementAmountAuto });

    const changes = computeAuditChanges(beforeAuditSnapshot, afterAuditSnapshot);
    // specs/reservation-payment-ledger.md rule 23 — an amount set from the ledger reads as such.
    const ledgerChange = ledgerHistoryChange({ body: req.body, stored: storedPaymentForQuote, quote });
    if (ledgerChange) changes.unshift(ledgerChange);
    if (existingReservation && String(existingReservation.sourceType || '') === 'ical' && Number(existingReservation.icalSyncLocked || 0) !== 1 && nextIcalSyncLocked === 1) {
      changes.push({ field: 'icalSyncLocked', label: 'Synchronisation iCal', from: 'Active', to: 'Verrouillée après modification manuelle' });
    }
    if (changes.length > 0) model.addHistoryEntry(id, 'update', changes);

  };
  try {
    if (typeof db.transaction === 'function') db.transaction(writeAll)(); else writeAll();
  } catch (err) {
    if (err instanceof CreationRefused) return res.status(err.refusal.status).json(err.refusal.body);
    throw err;
  }

  res.json({ ok: true, reservationNumber: model.getReservationNumber(id) });
  if (!silent) emitPluginEvent('reservation.updated', { reservationId: Number(id) });
}

// specs/reception-sas-today-only.md §3.2 rule 6 — reception may flip the status toggles only on the
// DAY concerned: « Prêt » / « Arrivé » follow the arrival window, « Parti » the departure one. Unlike
// the SAS itself, a committed SAS does NOT lock them (fixing a mis-tick is not a re-edit). Returns
// the blocking reason ('past' | 'future') or null when the write is allowed.
function receptionStatusLock(reservationId, body, now = new Date()) {
  const row = model.getRow(reservationId);
  if (!row) return null; // unknown reservation → let the regular 404 answer.
  const touchesArrival = body.checkInReady !== undefined || body.checkInDone !== undefined;
  const touchesDeparture = body.checkOutDone !== undefined;
  if (touchesArrival && !isWithinSasWindow(row.startDate, now)) {
    return sasLockReason({ dateIso: row.startDate, doneAt: null, now });
  }
  if (touchesDeparture && !isWithinSasWindow(row.endDate, now)) {
    return sasLockReason({ dateIso: row.endDate, doneAt: null, now });
  }
  return null;
}

const PAID_DATE_FIELDS = [
  ['depositPaid', 'depositPaidDate'],
  ['balancePaid', 'balancePaidDate'],
  ['complementPaid', 'complementPaidDate'],
  ['endOfStayComplementPaid', 'endOfStayComplementPaidDate'],
  ['cautionReceived', 'cautionReceivedDate'],
  ['cautionReturned', 'cautionReturnedDate'],
];

/**
 * specs/reservation-payment-ledger.md — the guards of a payment mark:
 *   - rule 9: every recorded date is a real day, not in the future (« not before the booking » is not
 *     applied: reservations typed after the fact carry a later `createdAt` than their payments);
 *   - rule 11: `expectedAmountCents` is the amount the operator saw; it must equal the stored one;
 *   - rule 12: the caution is returned only once received, and not before its receipt.
 * Returns `{ status, body }` or null.
 */
function paymentMarkRefusal(row, body, today) {
  // specs/direct-installments.md rule 35 — a stay with a plan is collected installment by installment.
  const hasPlan = Number(row.installmentsTarget || 0) > 0;
  if (hasPlan && (body.depositPaid === true || body.depositPaid === 1 || body.balancePaid === true || body.balancePaid === 1)) {
    return { status: 409, body: { error: 'Un échéancier remplace l’acompte et le solde : marquer les échéances.', code: 'INSTALLMENTS_IN_PLACE' } };
  }
  for (const [flagField, dateField] of PAID_DATE_FIELDS) {
    if (!body[flagField] || body[dateField] === undefined || body[dateField] === null || body[dateField] === '') continue;
    const checked = validateCollectionDate(body[dateField], { today, invalidReason: 'Date invalide.' });
    if (!checked.ok) return { status: 400, body: { error: checked.reason, code: 'INVALID_PAYMENT_DATE', field: dateField } };
  }
  // Rule 32 — a bucket with nothing to collect is never marked: a converted devis carried a 0 € acompte
  // and « Marquer acompte payé » ticked it, which the books then read as a payment.
  {
    const deferredZero = Number(row.complementDeferredToCheckout || 0) === 1;
    const amountOf = {
      depositPaid: [row.depositAmount, row.depositPaid],
      balancePaid: [row.balanceAmount, row.balancePaid],
      complementPaid: [deferredZero ? Number(row.complementAmount || 0) + Number(row.endOfStayComplementAmount || 0) : row.complementAmount, row.complementPaid],
      endOfStayComplementPaid: [row.endOfStayComplementAmount, row.endOfStayComplementPaid],
    };
    const cashOf = { complementPaid: 'complementPaidCash', endOfStayComplementPaid: 'endOfStayComplementPaidCash' };
    const marks = (field) => body[field] === true || body[field] === 1
      || (cashOf[field] && (body[cashOf[field]] === true || body[cashOf[field]] === 1));
    for (const [field, [amount, already]] of Object.entries(amountOf)) {
      if (marks(field) && Number(already || 0) !== 1 && !(round2(amount) > 0)) {
        return { status: 409, body: { error: 'Rien à percevoir sur cette échéance.', code: 'NOTHING_TO_COLLECT', field } };
      }
    }
  }
  // Rule 38 — a bucket already perceived is never marked again: a second tab, a replayed request or a
  // crafted one would re-date it (moving its accounting entry to another month) and rewrite its figures.
  const alreadyOf = {
    depositPaid: row.depositPaid, balancePaid: row.balancePaid, complementPaid: row.complementPaid,
    endOfStayComplementPaid: row.endOfStayComplementPaid, cautionReceived: row.cautionReceived, cautionReturned: row.cautionReturned,
  };
  const ALREADY_LABELS = {
    depositPaid: "L'acompte est déjà perçu.", balancePaid: 'Le solde est déjà perçu.',
    complementPaid: 'Le complément est déjà perçu.', endOfStayComplementPaid: 'Le complément de fin de séjour est déjà perçu.',
    cautionReceived: 'La caution est déjà reçue.', cautionReturned: 'La caution est déjà restituée.',
  };
  for (const [field, already] of Object.entries(alreadyOf)) {
    if ((body[field] === true || body[field] === 1) && Number(already || 0) === 1) {
      return { status: 409, body: { error: `${ALREADY_LABELS[field]} Relire la fiche.`, code: 'ALREADY_PAID', field } };
    }
  }
  // Rule 34 — a payout is received with its transfer (and the commission it implies): the two figures
  // ride the mark, under its guards, so a past or locked fiche never needs a full save to record it.
  // Only on the reception itself (unpaid → paid) of a stay settled by a platform.
  const isPlatformStay = String(row.platform || 'direct').trim().toLowerCase() !== 'direct';
  for (const field of ['platformPayoutAmount', 'platformCommissionAmount']) {
    if (body[field] === undefined) continue;
    if (!(body.balancePaid === true || body.balancePaid === 1)) {
      return { status: 400, body: { error: 'Le virement se saisit avec la réception du versement.', code: 'PAYOUT_WITHOUT_MARK', field } };
    }
    if (!isPlatformStay) {
      return { status: 400, body: { error: 'Pas de virement de plateforme sur une réservation directe.', code: 'PAYOUT_NOT_PLATFORM', field } };
    }
    const n = Number(body[field]);
    if (body[field] === null || body[field] === '' || !Number.isFinite(n) || n < 0) {
      return { status: 400, body: { error: field === 'platformPayoutAmount' ? 'Virement reçu : montant requis.' : 'Commission invalide.', code: 'INVALID_AMOUNT', field } };
    }
    if (field === 'platformCommissionAmount') {
      const gross = row.platformGrossAmount != null && row.platformGrossAmount !== ''
        ? Number(row.platformGrossAmount) : Number(row.depositAmount || 0) + Number(row.balanceAmount || 0);
      if (n > round2(gross) + 0.004) {
        return { status: 400, body: { error: `La commission dépasse le montant facturé (${formatEurosFr(gross)}).`, code: 'INVALID_AMOUNT', field } };
      }
    }
  }
  if (body.expectedAmountCents !== undefined && body.expectedAmountCents !== null) {
    const expected = Number(body.expectedAmountCents);
    if (!Number.isInteger(expected)) return { status: 400, body: { error: 'Montant attendu invalide.' } };
    const markedCount = ['depositPaid', 'balancePaid', 'complementPaid', 'endOfStayComplementPaid']
      .filter((f) => body[f] === true || body[f] === 1).length;
    if (markedCount > 1) {
      return { status: 400, body: { error: 'Un montant attendu ne vaut que pour une échéance à la fois.', code: 'AMBIGUOUS_EXPECTED_AMOUNT' } };
    }
    const deferred = Number(row.complementDeferredToCheckout || 0) === 1;
    const storedOf = {
      depositPaid: row.depositAmount,
      balancePaid: row.balanceAmount,
      complementPaid: deferred
        ? Number(row.complementAmount || 0) + Number(row.endOfStayComplementAmount || 0)
        : row.complementAmount,
      endOfStayComplementPaid: row.endOfStayComplementAmount,
    };
    const marked = Object.keys(storedOf).find((f) => body[f] === true || body[f] === 1);
    if (marked && Math.round(round2(storedOf[marked]) * 100) !== expected) {
      return { status: 409, body: { error: 'Le montant a changé entre-temps : relire la fiche.', code: 'AMOUNT_CHANGED' } };
    }
  }
  if (body.cautionReturned) {
    const receivedNow = body.cautionReceived === undefined ? Number(row.cautionReceived || 0) === 1 : Boolean(body.cautionReceived);
    if (!receivedNow) {
      return { status: 409, body: { error: 'La caution n\'a pas encore été reçue.', code: 'CAUTION_NOT_RECEIVED' } };
    }
    const receivedOn = String((body.cautionReceived ? body.cautionReceivedDate : row.cautionReceivedDate) || '').slice(0, 10);
    const returnedOn = String(body.cautionReturnedDate || today || '').slice(0, 10);
    if (receivedOn && returnedOn && returnedOn < receivedOn) {
      const [, m, d] = receivedOn.split('-');
      return { status: 400, body: { error: `Restitution avant la réception (${d}/${m}).`, code: 'INVALID_PAYMENT_DATE', field: 'cautionReturnedDate' } };
    }
  }
  return null;
}

// NOTE: updatePayment deliberately has no Google hook — payment/caution/SAS fields don't
// appear in the calendar event (spec rule 21).
function updatePayment(req, res) {
  // specs/reception-role-checkin-only.md §3.5 rule 10 — a reception-only user may flip ONLY the
  // check-in/out status flags through this endpoint; every financial field in the same payload is
  // dropped before any processing (fail-closed field guard).
  if (isReceptionOnly(req.user)) {
    req.body = toReceptionPaymentPatch(req.body);
    const statusLock = receptionStatusLock(Number(req.params.id), req.body);
    if (statusLock) return res.status(403).json({ error: 'STATUS_LOCKED', reason: statusLock });
  }
  const financeError = validateFinanceInputs({
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    balanceAmount: { value: req.body.balanceAmount, kind: 'money' },
    cautionAmount: { value: req.body.cautionAmount, kind: 'money' },
  });
  if (financeError) return res.status(400).json(financeErrorBody(financeError));
  const existing = model.getBasic(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Réservation non trouvée' });
  const cancelledPayment = cancelledGuard(Number(req.params.id));
  if (cancelledPayment) return res.status(cancelledPayment.status).json(cancelledPayment.body);

  // specs/reservation-payment-ledger.md rules 9, 11, 12 — the guards of a mark, all checked BEFORE
  // anything is written, so a refusal leaves the whole PATCH without effect.
  const markRefusal = paymentMarkRefusal(model.getRow(Number(req.params.id)) || {}, req.body, getTodayIsoDate());
  if (markRefusal) return res.status(markRefusal.status).json(markRefusal.body);

  // specs/mid-stay-notes.md — settle / cancel a « note en séjour ». Runs FIRST: both actions are
  // transactional and self-contained, and a rejection must leave the whole PATCH without effect.
  const noteError = applyMidStayNoteActions(Number(req.params.id), req.body);
  if (noteError) return res.status(noteError.status).json(noteError.body);

  const captureWarnings = [];
  const { depositPaid, depositPaidDate, balancePaid, balancePaidDate,
    complementPaid, complementPaidDate, complementPaidCash,
    complementDeferredToCheckout,
    endOfStayComplementPaid, endOfStayComplementPaidDate, endOfStayComplementPaidCash,
    cautionReceived, cautionReceivedDate, cautionReturned, cautionReturnedDate,
    checkInReady, checkInDone, checkOutDone } = req.body;
  const id = req.params.id;

  // Contribs capture (spec force-item-to-complement.md): on `*Paid` 0→1 flips we freeze the
  // per-bucket attribution across every child line + accommodation/tax portion, inside a single
  // transaction so capture + payment update commit or roll back together. The conservation
  // invariant is asserted inside `captureContribsOnFlip` → throw aborts the txn.
  if (depositPaid !== undefined) {
    const beforeRow = model.getRow(Number(id));
    const wasDepositPaid = Number(beforeRow?.depositPaid || 0) === 1;
    const willBeDepositPaid = Boolean(depositPaid);
    const date = willBeDepositPaid ? (depositPaidDate || localTodayIso()) : null;
    try {
      if (!wasDepositPaid && willBeDepositPaid) {
        // specs/plugins-phase-3a-online-payment.md rule 1 — the same write an online payment makes.
        // specs/reservation-payment-ledger.md rule 37 — the money was received: a stay whose stored
        // amounts no longer match today's engine (priced under an earlier rule) keeps the payment, its
        // per-line split falls back to the stored amounts, and the operator is told.
        const recorded = recordStayPayment(stayPaymentDeps(), { reservationId: Number(id), bucket: 'deposit', paidDate: date, keepPaymentOnCaptureFailure: true, origin: 'fiche' });
        if (recorded && recorded.captureFailed && recorded.captureFailed.length) captureWarnings.push('deposit');
      } else db.transaction(() => {
        if (wasDepositPaid && !willBeDepositPaid) {
          clearContribsOnUnflip({ db, reservationId: Number(id), bucket: 'deposit' });
          // specs/reservation-payment-ledger.md rule 35 — the acompte keeps the amount it was received
          // at, so undoing then redoing lands on the same amount instead of a re-priced one.
          model.updatePaymentField(
            "UPDATE reservations SET depositAmountOverride = depositAmount, updatedAt = datetime('now') WHERE id = ? AND depositAmount > 0",
            id,
          );
        }
        model.updatePaymentField(
          "UPDATE reservations SET depositPaid = ?, depositPaidDate = ?, updatedAt = datetime('now') WHERE id = ?",
          willBeDepositPaid ? 1 : 0, date, id,
        );
        // specs/collect-stay-payment-at-check-in.md §3.3 rule 15 — the fiche just took the bucket
        // over: the arrival SAS's ownership marker and its caisse-interne flag go with the flip.
        if (wasDepositPaid !== willBeDepositPaid) model.releaseStayBucket(Number(id), 'deposit');
      })();
    } catch (err) {
      return res.status(409).json({ error: `Capture des contributions impossible : ${err.message}`, code: 'CONTRIB_CAPTURE_FAILED' });
    }
  }
  // Rule 34 — the transfer and the commission of a payout, written with its reception.
  if (balancePaid && (req.body.platformPayoutAmount !== undefined || req.body.platformCommissionAmount !== undefined)) {
    const before = model.getRow(Number(id)) || {};
    const changes = [];
    for (const [field, label] of [['platformPayoutAmount', 'Virement reçu'], ['platformCommissionAmount', 'Commission solde']]) {
      if (req.body[field] === undefined) continue;
      const next = round2(req.body[field]);
      if (before[field] != null && round2(before[field]) === next) continue;
      model.updatePaymentField(`UPDATE reservations SET ${field} = ?, updatedAt = datetime('now') WHERE id = ?`, next, id);
      changes.push({ field, label, from: before[field] == null ? 'vide' : formatEurosFr(before[field]), to: formatEurosFr(next) });
    }
    if (changes.length > 0) model.addHistoryEntry(Number(id), 'update', changes);
  }
  if (balancePaid !== undefined) {
    const beforeRow = model.getRow(Number(id));
    const wasBalancePaid = Number(beforeRow?.balancePaid || 0) === 1;
    const willBeBalancePaid = Boolean(balancePaid);
    const date = willBeBalancePaid ? (balancePaidDate || localTodayIso()) : null;
    try {
      if (!wasBalancePaid && willBeBalancePaid) {
        // specs/reservation-payment-ledger.md rule 37 — the money was received: a stay whose stored
        // amounts no longer match today's engine (priced under an earlier rule) keeps the payment, its
        // per-line split falls back to the stored amounts, and the operator is told.
        const recorded = recordStayPayment(stayPaymentDeps(), { reservationId: Number(id), bucket: 'balance', paidDate: date, keepPaymentOnCaptureFailure: true, origin: 'fiche' });
        if (recorded && recorded.captureFailed && recorded.captureFailed.length) captureWarnings.push('balance');
      } else db.transaction(() => {
        if (wasBalancePaid && !willBeBalancePaid) {
          clearContribsOnUnflip({ db, reservationId: Number(id), bucket: 'balance' });
        }
        model.updatePaymentField(
          "UPDATE reservations SET balancePaid = ?, balancePaidDate = ?, updatedAt = datetime('now') WHERE id = ?",
          willBeBalancePaid ? 1 : 0, date, id,
        );
        if (wasBalancePaid !== willBeBalancePaid) model.releaseStayBucket(Number(id), 'balance');
      })();
    } catch (err) {
      return res.status(409).json({ error: `Capture des contributions impossible : ${err.message}`, code: 'CONTRIB_CAPTURE_FAILED' });
    }
  }
  // specs/defer-arrival-complement-to-checkout.md §3.3 rules 12-14 — « Percevoir en fin de séjour »
  // from the fiche. It writes the SAME column the arrival SAS recap writes: one marker, two entry
  // points, the last gesture wins. Traced in the history (rule 19): it is a money decision.
  if (complementDeferredToCheckout !== undefined) {
    const beforeDefer = model.getRow(Number(id));
    const was = Number(beforeDefer?.complementDeferredToCheckout || 0) === 1;
    const next = Boolean(complementDeferredToCheckout);
    if (was !== next) {
      const label = (v) => (v ? 'Perçu en fin de séjour' : 'Perçu à l\'arrivée');
      model.setComplementDeferredToCheckout(Number(id), next);
      model.addHistoryEntry(Number(id), 'update', [
        { field: 'complementDeferredToCheckout', label: 'Complément d\'arrivée', from: label(was), to: label(next) },
      ]);
    }
  }
  if (complementPaid !== undefined || complementPaidCash !== undefined) {
    // Arrival complement: normal (compta) paid OR « payé en liquide » (cash, off the books — spec
    // cash-complement-and-endofstay-finance.md §3.2). See resolveComplementPayment for the rules.
    const before = model.getRow(Number(id));
    const today = localTodayIso();
    const { paid, cash, date } = resolveComplementPayment({
      paidInput: complementPaid, cashInput: complementPaidCash, dateInput: complementPaidDate,
      prevPaid: before?.complementPaid, prevCash: before?.complementPaidCash, prevDate: before?.complementPaidDate,
      today,
    });
    model.updatePaymentField(
      "UPDATE reservations SET complementPaid = ?, complementPaidDate = ?, complementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?",
      paid, date, cash, id,
    );
    // specs/single-payment-at-check-in.md §3.2 rules 8-9 — a complement FLIPPED from the fiche stops
    // being the SAS's: its ownership marker goes, and so does any single payment that named it. Only
    // on a real change, so saving the fiche for an unrelated reason never dissolves a group.
    if (Number(before?.complementPaid || 0) !== Number(paid || 0)) model.releaseComplementBucket(Number(id));
    // specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rule 3 (élargi le 2026-08-22) —
    // encaisser le complément d'arrivée le CLÔT : on fige ici l'état des extras, pour que tout ce qui
    // sera vendu ensuite parte au complément de fin de séjour au lieu de se perdre entre les
    // échéances. Idempotent : une base déjà posée n'est jamais réécrite.
    if (paid) model.captureArrivalExtrasBaseline(Number(id));
    // specs/defer-arrival-complement-to-checkout.md §3.2 rule 8 — when the complement was deferred to
    // check-out, the fiche shows ONE card for ONE collection: marking it paid (or « caisse interne »)
    // settles BOTH buckets with the same date, and un-marking clears both. The amounts stay separate
    // in the DB — only the payment marking is shared.
    if (Number(before?.complementDeferredToCheckout || 0) === 1
      && Number(before?.endOfStayComplementAmount || 0) > 0
      && endOfStayComplementPaid === undefined && endOfStayComplementPaidCash === undefined) {
      model.updatePaymentField(
        "UPDATE reservations SET endOfStayComplementPaid = ?, endOfStayComplementPaidDate = ?, endOfStayComplementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?",
        paid, date, cash, id,
      );
    }
  }
  if (endOfStayComplementPaid !== undefined || endOfStayComplementPaidCash !== undefined) {
    // End-of-stay complement (departure SAS): same paid / cash model as the arrival complement (§3.1).
    const before = model.getRow(Number(id));
    const today = localTodayIso();
    const { paid, cash, date } = resolveComplementPayment({
      paidInput: endOfStayComplementPaid, cashInput: endOfStayComplementPaidCash, dateInput: endOfStayComplementPaidDate,
      prevPaid: before?.endOfStayComplementPaid, prevCash: before?.endOfStayComplementPaidCash, prevDate: before?.endOfStayComplementPaidDate,
      today,
    });
    model.updatePaymentField(
      "UPDATE reservations SET endOfStayComplementPaid = ?, endOfStayComplementPaidDate = ?, endOfStayComplementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?",
      paid, date, cash, id,
    );
    // specs/single-payment-from-the-fiche.md rule 2bis — flipped from the fiche, it leaves any single
    // payment that named it: the group must never claim a collection that is no longer true.
    if (Number(before?.endOfStayComplementPaid || 0) !== Number(paid || 0)) {
      model.releaseEndOfStayBucket(Number(id));
      // …et ce n'est plus le SAS départ qui possède cet encaissement, quel que soit le sens du
      // basculement (specs/recall-unpaid-arrival-complement-at-checkout.md rule 9bis).
      model.clearEndOfStayDepartureMarker(Number(id));
    }
  }
  if (cautionReceived !== undefined) {
    const date = cautionReceivedDate || (cautionReceived ? localTodayIso() : null);
    if (cautionReceived) {
      // specs/caution-live-from-property.md §3 rule 2 — freeze the live property caution on receipt.
      model.updatePaymentField('UPDATE reservations SET cautionReceived = 1, cautionReceivedDate = ?, cautionAmount = (SELECT defaultCautionAmount FROM properties WHERE id = reservations.propertyId), updatedAt = datetime(\'now\') WHERE id = ?', date, id);
    } else {
      // specs/reservation-payment-ledger.md rule 14 — undoing the receipt undoes the return too: a
      // caution never received cannot have been given back.
      model.updatePaymentField('UPDATE reservations SET cautionReceived = 0, cautionReceivedDate = NULL, cautionReturned = 0, cautionReturnedDate = NULL, updatedAt = datetime(\'now\') WHERE id = ?', id);
    }
  }
  if (cautionReturned !== undefined) {
    const date = cautionReturnedDate || (cautionReturned ? localTodayIso() : null);
    model.updatePaymentField('UPDATE reservations SET cautionReturned = ?, cautionReturnedDate = ?, updatedAt = datetime(\'now\') WHERE id = ?', cautionReturned ? 1 : 0, date, id);
  }
  if (checkInReady !== undefined) {
    model.updatePaymentField('UPDATE reservations SET checkInReady = ?, updatedAt = datetime(\'now\') WHERE id = ?', checkInReady ? 1 : 0, id);
  }
  if (checkInDone !== undefined) {
    model.updatePaymentField('UPDATE reservations SET checkInDone = ?, updatedAt = datetime(\'now\') WHERE id = ?', checkInDone ? 1 : 0, id);
  }
  if (checkOutDone !== undefined) {
    model.updatePaymentField('UPDATE reservations SET checkOutDone = ?, updatedAt = datetime(\'now\') WHERE id = ?', checkOutDone ? 1 : 0, id);
  }
  // specs/plugins-phase-3a-online-payment.md rule 23 — a bucket settled by hand retires its open link
  // at once; the next poll deactivates it at the provider after checking it was not paid meanwhile.
  if (depositPaid || balancePaid || complementPaid) {
    try { require('../models/paymentLinksModel').retireSettled(); } catch { /* no link table: nothing to retire */ }
  }
  res.json(captureWarnings.length
    ? { ok: true, warning: 'Encaissement enregistré. Ses montants diffèrent du calcul actuel du séjour : la répartition comptable reprend les montants enregistrés.' }
    : { ok: true });
}

function remove(req, res) {
  const existing = model.getForArchiveCheck(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Réservation non trouvée' });
  const today = localTodayIso();
  // Same per-reservation unlock as `update` (rule 17a): an admin who unlocked the fiche may delete a
  // stay that has ended.
  if (existing.endDate < today && !pastUnlockRequested(req)) {
    return res.status(403).json({ error: 'Cette réservation est archivée (terminée) et ne peut plus être modifiée.' });
  }
  model.remove(req.params.id);
  res.json({ ok: true });
  emitPluginEvent('reservation.deleted', { reservationId: Number(req.params.id) });
}

module.exports = {
  suggestBeds, platformCommission, previewMidStayNote, list, search, occupiedDates, getById, getHistory, calculatePrice,
  create, update, performUpdate, updatePayment, settleArrivalPayment, remove,
};

// Test surface: the guard of a payment mark, exercised without an HTTP round-trip.
module.exports.__test = { paymentMarkRefusal };
