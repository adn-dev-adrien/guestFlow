/**
 * Reservations controller — orchestrates each endpoint: parse input → finance validation → pricing
 * engine → occupancy/capacity checks → model writes → response shaping. Holds the flow that used to
 * live inline in routes/reservations.js; all SQL is in reservationsModel, all rules in utils.
 */

const db = require('../database');
const { calculateReservationQuote } = require('../utils/pricing');
const { validateFinanceInputs } = require('../utils/financeValidation');
const { parseGroup, collectibleArrivalBuckets } = require('../utils/arrivalPaymentGroup');
const { validateArrivalPaymentDate } = require('../utils/arrivalPaymentDate');
const { buildArrivalPaymentDetail } = require('../utils/arrivalPaymentDetail');
const { resolveArrivalPaymentAdjustment } = require('../utils/arrivalPaymentAdjustment');
const { arrivalPaymentAdjustment } = require('../utils/reservationSettlement');
const { getNightBlocksFromTimes, buildOccupiedDatesFromReservations } = require('../utils/occupancy');
const { computeNextIcalSyncLocked, getTodayIsoDate } = require('../utils/reservationHelpers');
const { buildAuditSnapshotFromPayload, computeAuditChanges } = require('../utils/reservationAudit');
const { suggestBedDistribution } = require('../utils/bedDistribution');
const { checkGuestCapacity } = require('../utils/capacity');
const { captureContribsOnFlip, clearContribsOnUnflip } = require('../utils/forceItemContribsCapture');
const { resolveComplementPayment } = require('../utils/complementPayment');
const { isTouristTaxFrozen } = require('../utils/touristTaxFreeze');
const { sasDetailAmount, sasDetailAmountAuto, storedMidStayLines } = require('../utils/midStayExtras');
const establishmentClosuresModel = require('../models/establishmentClosuresModel');
const googleCalendarSync = require('../utils/googleCalendarSync');
const reservationsModel = require('../models/reservationsModel');
const settingsModel = require('../models/settingsModel');
const refundsModel = require('../models/refundsModel');
const refundsController = require('./refundsController');
const propertyOptionDefaultsModel = require('../models/propertyOptionDefaultsModel');
const { carriedOfferedDefaultsToRestore } = require('../utils/propertyDefaultOptions');
const platformsModel = require('../models/platformsModel');
const { DEFAULT_PAYOUT_DUE_DAYS } = require('../utils/platformPayout');
const { isReceptionOnly } = require('../constants/roles');
const { isWithinSasWindow, sasLockReason } = require('../utils/sasEditWindow');
const { isDevisExpired } = require('../utils/devisValidity');
const { toReceptionReservationView, toReceptionReservationList, toReceptionPaymentPatch } = require('../utils/receptionView');
const { buildLiveCheckoutComplement } = require('../utils/checkoutComplement');

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
    if (settle) model.settleMidStayNote(reservationId, { items: settle.items, cash: Boolean(settle.cash) });
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
    const freeMinutes = model.getResourceFreeMinutes(propertyId, rr.resourceId);
    const usesHourlyQuantity = resource.priceType === 'per_hour'
      || Number(resource.isComplex || 0) === 1
      || resource.isComplex === true
      || String(resource.isComplex || '').toLowerCase() === 'true'
      || freeMinutes > 0;
    if (!usesHourlyQuantity) {
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

function list(req, res) {
  const { propertyId, clientId, from, to } = req.query;
  const rows = model.list({ propertyId, clientId, from, to });
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

function calculatePrice(req, res) {
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
  if (financeError) return res.status(400).json({ error: financeError });

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
  let frozenTouristTax = null;
  if (reservationId > 0 && !req.body.refreshTouristTax) {
    const stored = db.prepare(`
      SELECT id, touristTaxTotal, touristTaxRate, touristTaxInComplement, touristTaxDeclaredAt,
             touristTaxFrozenAt, touristTaxFrozenBaseHt, touristTaxFrozenOccupants,
             balancePaid, complementPaid
      FROM reservations WHERE id = ?
    `).get(reservationId);
    if (stored && isTouristTaxFrozen(db, stored)) frozenTouristTax = stored;
  }

  const quote = calculateReservationQuote({
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
    freezeTouristTax: Boolean(frozenTouristTax),
    frozenTouristTaxTotal: frozenTouristTax ? frozenTouristTax.touristTaxTotal : 0,
    frozenTouristTaxRate: frozenTouristTax ? frozenTouristTax.touristTaxRate : 0,
    frozenTouristTaxBaseHt: frozenTouristTax ? frozenTouristTax.touristTaxFrozenBaseHt : null,
    frozenTouristTaxOccupants: frozenTouristTax ? frozenTouristTax.touristTaxFrozenOccupants : null,
    frozenTouristTaxAt: frozenTouristTax ? frozenTouristTax.touristTaxFrozenAt : null,
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
    // specs/platform-deposit-toggle.md — whether this platform takes an acompte (global per platform).
    platformTakesDeposit: resolvePlatformTakesDeposit(req.body.platform),
    // specs/platform-payout-due-date.md — the platform's payout delay, which sets the solde deadline
    // at `endDate + N` instead of the guest-facing J-30.
    platformPayoutDueDays: resolvePlatformPayoutDueDays(req.body.platform),
  });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });
  // specs/defer-arrival-complement-to-checkout.md §3.2 rule 7bis — the merged « complément de fin de
  // séjour » block, rebuilt from THIS quote so the card follows every edit live instead of showing
  // the last save. Payment flags and the deferral marker come from the stored row: the fiche's
  // buttons persist them immediately, so the row is always current.
  if (reservationId > 0) {
    const row = model.getRow(reservationId);
    if (row) quote.checkoutComplement = buildLiveCheckoutComplement({ row, quote });
  }

  res.json(quote);
}

function create(req, res) {
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
    discountPercent: { value: req.body.discountPercent, kind: 'percentage' },
  });
  if (financeError) return res.status(400).json({ error: financeError });

  // Reservation number override collision guard (specs/reservation-number-and-search.md §3 rule 4).
  const numberError = reservationNumberOverrideError(req.body.reservationNumber, null);
  if (numberError) return res.status(400).json(numberError);

  // Data invariant: never persist an empty platform — see `normalisePlatform`.
  req.body.platform = normalisePlatform(req.body.platform);

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
  const reservationOptions = (() => {
    if (!propertyId) return rawReservationOptions || [];
    const defaults = propertyOptionDefaultsModel.listForProperty(Number(propertyId));
    if (!defaults || defaults.length === 0) return rawReservationOptions || [];
    const existing = new Set((rawReservationOptions || []).map((o) => Number(o.optionId)));
    const toAdd = defaults
      .filter((d) => !existing.has(Number(d.optionId)))
      .map((d) => ({ optionId: Number(d.optionId), quantity: 1 }));
    return [...(rawReservationOptions || []), ...toAdd];
  })();

  // specs/bed-config-in-linen-card.md §3 rule 7 — single/double bed counts are only meaningful
  // when the saved reservation carries at least one `countsAsBedLinen = 1` option, so we zero them
  // when no bed-linen option applies. BABY BEDS are exempt (§10 follow-up 2026-06-08): a baby bed is
  // an independent physical resource needed whenever there are babies, regardless of the bed-linen
  // option — the laundry aggregation already gates baby-bed linen on the option separately. We coerce
  // BEFORE `checkCapacity` so a misbehaving client can't trip the "exceeds capacity" error on values
  // that won't be persisted. Mutating `req.body` is intentional: the model reads from it.
  const bedLinenIncluded = hasBedLinenOption(reservationOptions);
  const effectiveSingleBeds = bedLinenIncluded ? singleBeds : 0;
  const effectiveDoubleBeds = bedLinenIncluded ? doubleBeds : 0;
  const effectiveBabyBeds   = babyBeds;
  req.body.singleBeds = effectiveSingleBeds;
  req.body.doubleBeds = effectiveDoubleBeds;
  req.body.babyBeds   = effectiveBabyBeds;

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

  const quote = calculateReservationQuote({
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
    // specs/platform-deposit-toggle.md — whether this platform takes an acompte (global per platform).
    platformTakesDeposit: resolvePlatformTakesDeposit(req.body.platform),
    // specs/platform-payout-due-date.md — the platform's payout delay, which sets the solde deadline
    // at `endDate + N` instead of the guest-facing J-30.
    platformPayoutDueDays: resolvePlatformPayoutDueDays(req.body.platform),
    // specs/payment-schedule-and-cancellation.md §3.1 — booked today: the acompte is due
    // `depositDueDays` from now, the solde 30 days before arrival at the earliest.
    ...scheduleQuoteInputs(0),
  });
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

  const nightBlocks = getNightBlocksFromTimes(checkInTime, checkOutTime);
  // The model rejects `startDate < today` by default. When the admin escape hatch is ON
  // (Paramètres → Réservations passées), that single guard is lifted so backfilling /
  // correcting a past reservation is possible. Overlap / capacity / closures still apply.
  const validationError = model.validateAvailability(
    propertyId, startDate, endDate, checkInTime, checkOutTime, null, nightBlocks,
    { allowPastDates: settingsModel.allowEditPastReservations() },
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

  const reservationId = model.insertReservation(req.body, quote, nightBlocks);
  model.addHistoryEntry(reservationId, 'create', [
    { field: 'sourceType', label: 'Origine', from: null, to: 'Création manuelle' },
  ]);
  if (reservationOptions && reservationOptions.length > 0) model.insertOptions(reservationId, quote.optionLines);
  if (reservationCustomOptions && reservationCustomOptions.length > 0) model.insertCustomOptions(reservationId, quote.optionLines);
  model.insertNights(reservationId, quote.nightlyBreakdown);

  if (reservationResources && reservationResources.length > 0) {
    const resourceError = insertResourceLines(reservationId, quote, { propertyId, startDate, endDate, excludeId: null });
    if (resourceError) return res.status(resourceError.status).json(resourceError.body);
  }

  // specs/mid-stay-extras-to-end-of-stay-complement.md §3.1 rule 3 — a reservation created while the
  // stay is already running (walk-in, saisie a posteriori, import iCal) takes its own extras as the
  // baseline: nothing it was created with counts as sold mid-stay.
  model.captureArrivalExtrasBaselineIfDue(reservationId);

  // specs/adjustable-complement-amounts.md §3.6 rule 36 — the fiche decides how an adjusted complement
  // splits across the accounting postes, and stores it. Runs after the lines: it reads them.
  model.syncComplementAllocation(reservationId, { autoAmount: quote.complementAmountAuto });

  res.json({ id: reservationId, reservationNumber: model.getReservationNumber(reservationId) });
  // Fire-and-forget Google push — never awaited, never fails the request (spec rule 19).
  googleCalendarSync.schedulePush(reservationId);
  // No acompte request leaves here (specs/payment-schedule-and-cancellation.md §1 amendment, rule 36):
  // the booking raises a `deposit_to_request` row on the dashboard instead, and the operator sends it.
}

function update(req, res) {
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
    discountPercent: { value: req.body.discountPercent, kind: 'percentage' },
  });
  if (financeError) return res.status(400).json({ error: financeError });

  // Data invariant: never persist an empty platform — see `normalisePlatform`.
  req.body.platform = normalisePlatform(req.body.platform);

  const id = Number(req.params.id);

  const cancelled = cancelledGuard(id);
  if (cancelled) return res.status(cancelled.status).json(cancelled.body);

  // Reservation number override collision guard (specs/reservation-number-and-search.md §3 rule 4) —
  // a blank value keeps the existing number (handled in the model), so only a non-empty duplicate fails.
  const numberError = reservationNumberOverrideError(req.body.reservationNumber, id);
  if (numberError) return res.status(400).json(numberError);

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

  // specs/bed-config-in-linen-card.md §3 rule 7 — invariant on save: zero single/double bed
  // counts when the submitted option set carries no bed-linen option (no linen contract).
  // BABY BEDS are exempt (§10 follow-up 2026-06-08): kept regardless — they track an
  // independent resource.
  const bedLinenIncluded = hasBedLinenOption(reservationOptions);
  const effectiveSingleBeds = bedLinenIncluded ? singleBeds : 0;
  const effectiveDoubleBeds = bedLinenIncluded ? doubleBeds : 0;
  const effectiveBabyBeds   = babyBeds;
  req.body.singleBeds = effectiveSingleBeds;
  req.body.doubleBeds = effectiveDoubleBeds;
  req.body.babyBeds   = effectiveBabyBeds;

  const beforeAuditSnapshot = model.getAuditSnapshotFromDb(id);
  // `pastReservationLocked` gates the 14-field allowlist below. An admin can drop this
  // lock by toggling `allowEditPastReservations` in Paramètres (see
  // specs/admin-unlock-past-reservations.md). Default is OFF — the lock holds as before.
  const pastReservationLocked = Boolean(beforeAuditSnapshot?.startDate && beforeAuditSnapshot.startDate <= getTodayIsoDate())
    && !settingsModel.allowEditPastReservations();

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

  const quote = calculateReservationQuote({
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
    depositAmount: req.body.depositAmount,
    depositAmountOverride: req.body.depositAmountOverride,
    // specs/adjustable-complement-amounts.md §3.2 rule 13 — applied last by the engine, over every
    // other branch, so it corrects even a frozen complement.
    complementAmountOverride: req.body.complementAmountOverride,
    balanceAmount: req.body.balanceAmount,
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
    // specs/platform-deposit-toggle.md — whether this platform takes an acompte (global per platform).
    platformTakesDeposit: resolvePlatformTakesDeposit(req.body.platform),
    // specs/platform-payout-due-date.md — the platform's payout delay, which sets the solde deadline
    // at `endDate + N` instead of the guest-facing J-30.
    platformPayoutDueDays: resolvePlatformPayoutDueDays(req.body.platform),
    ...midStayQuoteInputs(id),
    // The acompte deadline was promised on the booking day: an edit never moves it (rule 4).
    ...scheduleQuoteInputs(id),
  });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });

  const afterAuditSnapshot = buildAuditSnapshotFromPayload(req.body, quote);
  if (pastReservationLocked) {
    const allowedLockedFields = new Set([
      'clientId', 'platform', 'touristTaxRate', 'touristTaxTotal', 'discountPercent', 'finalPrice',
      'extraGuestSurchargeOffered', 'depositAmount', 'balanceAmount', 'depositPaid', 'balancePaid',
      'cautionReceived', 'cautionReceivedDate', 'cautionReturned', 'cautionReturnedDate',
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
    const forbiddenChanges = computeAuditChanges(beforeAuditSnapshot, afterAuditSnapshot)
      .filter((change) => !allowedLockedFields.has(change.field));
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
    // Compare on the fields that genuinely define "did the reservation move / who occupies it" AND that
    // are always stored as real values — property + dates, and the guest counts. We deliberately do NOT
    // compare check-in/out TIMES or bed counts here: iCal imports store those as NULL and the fiche fills
    // them from the property defaults on load, so a naive equality would see a phantom "change" on every
    // edit of an imported reservation — exactly the case we must unblock (specs/edit-reservation-blocked-by-overlap.md).
    const placementUnchanged = existingReservation
      && sameNum(prev.propertyId, propertyId)
      && sameStr(prev.startDate, startDate) && sameStr(prev.endDate, endDate);
    const occupancyUnchanged = existingReservation
      && sameNum(prev.propertyId, propertyId)
      && sameNum(prev.adults, adults) && sameNum(prev.children, children)
      && sameNum(prev.teens, teens) && sameNum(prev.babies, babies);

    // Same logic as the `create` flow: lift the model-level "no past startDate" guard when
    // the admin escape hatch is ON, so the user can keep a past startDate while editing
    // unrelated fields. See specs/admin-unlock-past-reservations.md.
    if (!placementUnchanged) {
      const validationError = model.validateAvailability(
        propertyId, startDate, endDate, checkInTime, checkOutTime, id, nightBlocks,
        { allowPastDates: settingsModel.allowEditPastReservations() },
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
  model.updateReservation(id, modelPayload, quote, nightBlocks, nextIcalSyncLocked);

  if (!pastReservationLocked && reservationOptions) model.replaceOptions(id, quote.optionLines);
  if (!pastReservationLocked) {
    model.deleteCustomOptions(id);
    if (reservationCustomOptions) model.insertCustomOptions(id, quote.optionLines);
  }
  if (!pastReservationLocked) model.replaceNights(id, quote.nightlyBreakdown);

  if (!pastReservationLocked && reservationResources) {
    model.deleteResources(id);
    const resourceError = insertResourceLines(id, quote, { propertyId, startDate, endDate, excludeId: id });
    if (resourceError) return res.status(resourceError.status).json(resourceError.body);
  }

  // specs/mid-stay-extras-to-end-of-stay-complement.md §3.4 rule 11 — the engine has computed what was
  // sold during the stay; store it as the mid-stay lines of the end-of-stay complement (the SAS-owned
  // lines are preserved, the amount is re-totalled). Frozen once that complement is collected.
  model.syncMidStayComplement(id, quote.midStayExtrasLines);

  // specs/adjustable-complement-amounts.md §3.6 rule 36 — same ventilation, recomputed at every save
  // so a new option or a re-priced line moves the postes, never the announced total.
  model.syncComplementAllocation(id, { autoAmount: quote.complementAmountAuto });

  const changes = computeAuditChanges(beforeAuditSnapshot, afterAuditSnapshot);
  if (existingReservation && String(existingReservation.sourceType || '') === 'ical' && Number(existingReservation.icalSyncLocked || 0) !== 1 && nextIcalSyncLocked === 1) {
    changes.push({ field: 'icalSyncLocked', label: 'Synchronisation iCal', from: 'Active', to: 'Verrouillée après modification manuelle' });
  }
  if (changes.length > 0) model.addHistoryEntry(id, 'update', changes);

  res.json({ ok: true, reservationNumber: model.getReservationNumber(id) });
  googleCalendarSync.schedulePush(id);
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
  if (financeError) return res.status(400).json({ error: financeError });
  const existing = model.getBasic(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Réservation non trouvée' });
  const cancelledPayment = cancelledGuard(Number(req.params.id));
  if (cancelledPayment) return res.status(cancelledPayment.status).json(cancelledPayment.body);

  // specs/mid-stay-notes.md — settle / cancel a « note en séjour ». Runs FIRST: both actions are
  // transactional and self-contained, and a rejection must leave the whole PATCH without effect.
  const noteError = applyMidStayNoteActions(Number(req.params.id), req.body);
  if (noteError) return res.status(noteError.status).json(noteError.body);

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
    const date = willBeDepositPaid ? (depositPaidDate || new Date().toISOString().split('T')[0]) : null;
    try {
      db.transaction(() => {
        if (!wasDepositPaid && willBeDepositPaid) {
          captureContribsOnFlip({ db, reservation: beforeRow, bucket: 'deposit' });
        } else if (wasDepositPaid && !willBeDepositPaid) {
          clearContribsOnUnflip({ db, reservationId: Number(id), bucket: 'deposit' });
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
  if (balancePaid !== undefined) {
    const beforeRow = model.getRow(Number(id));
    const wasBalancePaid = Number(beforeRow?.balancePaid || 0) === 1;
    const willBeBalancePaid = Boolean(balancePaid);
    const date = willBeBalancePaid ? (balancePaidDate || new Date().toISOString().split('T')[0]) : null;
    try {
      db.transaction(() => {
        if (!wasBalancePaid && willBeBalancePaid) {
          captureContribsOnFlip({ db, reservation: beforeRow, bucket: 'balance' });
        } else if (wasBalancePaid && !willBeBalancePaid) {
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
    const today = new Date().toISOString().split('T')[0];
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
    const today = new Date().toISOString().split('T')[0];
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
    const date = cautionReceivedDate || (cautionReceived ? new Date().toISOString().split('T')[0] : null);
    if (cautionReceived) {
      // specs/caution-live-from-property.md §3 rule 2 — freeze the live property caution on receipt.
      model.updatePaymentField('UPDATE reservations SET cautionReceived = 1, cautionReceivedDate = ?, cautionAmount = (SELECT defaultCautionAmount FROM properties WHERE id = reservations.propertyId), updatedAt = datetime(\'now\') WHERE id = ?', date, id);
    } else {
      model.updatePaymentField('UPDATE reservations SET cautionReceived = 0, cautionReceivedDate = ?, updatedAt = datetime(\'now\') WHERE id = ?', date, id);
    }
  }
  if (cautionReturned !== undefined) {
    const date = cautionReturnedDate || (cautionReturned ? new Date().toISOString().split('T')[0] : null);
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
  res.json({ ok: true });
}

function remove(req, res) {
  const existing = model.getForArchiveCheck(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Réservation non trouvée' });
  const today = new Date().toISOString().split('T')[0];
  // Same admin escape hatch as `update`: when `allowEditPastReservations` is ON the past-end
  // rejection is dropped. See specs/admin-unlock-past-reservations.md.
  if (existing.endDate < today && !settingsModel.allowEditPastReservations()) {
    return res.status(403).json({ error: 'Cette réservation est archivée (terminée) et ne peut plus être modifiée.' });
  }
  model.remove(req.params.id);
  res.json({ ok: true });
  googleCalendarSync.scheduleDelete(Number(req.params.id));
}

module.exports = {
  suggestBeds, list, search, occupiedDates, getById, getHistory, calculatePrice,
  create, update, updatePayment, settleArrivalPayment, remove,
};
