/**
 * Reservations controller — orchestrates each endpoint: parse input → finance validation → pricing
 * engine → occupancy/capacity checks → model writes → response shaping. Holds the flow that used to
 * live inline in routes/reservations.js; all SQL is in reservationsModel, all rules in utils.
 */

const db = require('../database');
const { calculateReservationQuote } = require('../utils/pricing');
const { validateFinanceInputs } = require('../utils/financeValidation');
const { getNightBlocksFromTimes, buildOccupiedDatesFromReservations } = require('../utils/occupancy');
const { computeNextIcalSyncLocked, getTodayIsoDate } = require('../utils/reservationHelpers');
const { buildAuditSnapshotFromPayload, computeAuditChanges } = require('../utils/reservationAudit');
const { suggestBedDistribution } = require('../utils/bedDistribution');
const { captureContribsOnFlip, clearContribsOnUnflip } = require('../utils/forceItemContribsCapture');
const { resolveComplementPayment } = require('../utils/complementPayment');
const establishmentClosuresModel = require('../models/establishmentClosuresModel');
const googleCalendarSync = require('../utils/googleCalendarSync');
const reservationsModel = require('../models/reservationsModel');
const settingsModel = require('../models/settingsModel');
const propertyOptionDefaultsModel = require('../models/propertyOptionDefaultsModel');
const platformsModel = require('../models/platformsModel');
const { ADMIN, RECEPTION, userHasRole } = require('../constants/roles');
const { toReceptionReservationView, toReceptionReservationList, toReceptionPaymentPatch } = require('../utils/receptionView');

// specs/reception-role-checkin-only.md §3.2 — a reception-only user (holds `reception`, not `admin`)
// receives finance-stripped reservation payloads and may write only the check-in/out status flags.
function isReceptionOnly(req) {
  return userHasRole(req.user, RECEPTION) && !userHasRole(req.user, ADMIN);
}

// specs/platform-deposit-toggle.md — resolve the GLOBAL per-platform "takes an acompte?" flag from the
// platform name, to feed the pricing engine. Direct / unknown → 0 (no acompte).
function resolvePlatformTakesDeposit(platform) {
  if (platform == null || String(platform).trim() === '' || String(platform).toLowerCase() === 'direct') return 0;
  try { return platformsModel.getDepositMode(platform); } catch (_) { return 0; }
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

// Shared capacity/baby-bed validation for create & update. Returns an error string or null.
function checkCapacity({ propertyId, adults, children, teens, babies, babyBeds, singleBeds, doubleBeds, forceCapacity }) {
  const property = model.getPropertyCapacity(propertyId);
  if (!property) return null;
  const adultsCount = Number(adults || 1);
  const childrenCount = Number(children || 0);
  const teensCount = Number(teens || 0);
  const babiesCount = Number(babies || 0);
  const babyBedsCount = Number(babyBeds || 0);
  const childrenSleepingInBabyBeds = Math.max(0, Math.min(childrenCount, babyBedsCount - babiesCount));
  const childrenTeensCount = Math.max(0, childrenCount - childrenSleepingInBabyBeds) + teensCount;
  const totalGuests = adultsCount + childrenCount + teensCount + babiesCount;
  const totalMax = Number(property.maxAdults || 0) + Number(property.maxChildren || 0) + Number(property.maxBabies || 0);

  if (!forceCapacity && adultsCount > Number(property.maxAdults || 0)) {
    return `Le nombre d'adultes (${adultsCount}) dépasse la capacité du logement (${property.maxAdults || 0}).`;
  }
  if (!forceCapacity && childrenTeensCount > Number(property.maxChildren || 0)) {
    return `Le nombre d'enfants + ados hors lit bébé (${childrenTeensCount}) dépasse la capacité du logement (${property.maxChildren || 0}).`;
  }
  if (!forceCapacity && babiesCount > Number(property.maxBabies || 0)) {
    return `Le nombre de bébés (${babiesCount}) dépasse la capacité du logement (${property.maxBabies || 0}).`;
  }
  if (!forceCapacity && totalGuests > totalMax) {
    return `Le nombre total de personnes (${totalGuests}) dépasse la capacité du logement (${totalMax}).`;
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
  res.json(isReceptionOnly(req) ? toReceptionReservationList(rows) : rows);
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

function getById(req, res) {
  const reservation = model.getByIdWithDetails(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
  res.json(isReceptionOnly(req) ? toReceptionReservationView(reservation) : reservation);
}

function getHistory(req, res) {
  const reservation = model.getHistoryMeta(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });
  res.json(model.getHistory(req.params.id));
}

function calculatePrice(req, res) {
  const financeError = validateFinanceInputs({
    customPrice: { value: req.body.customPrice, kind: 'money' },
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    depositAmountOverride: { value: req.body.depositAmountOverride, kind: 'money' },
    balanceAmount: { value: req.body.balanceAmount, kind: 'money' },
    discountPercent: { value: req.body.discountPercent, kind: 'percentage' },
  });
  if (financeError) return res.status(400).json({ error: financeError });

  const propertyId = Number(req.body.propertyId);
  if (typeof db.ensureDefaultTimedOptionsForProperty === 'function' && Number.isFinite(propertyId) && propertyId > 0) {
    db.ensureDefaultTimedOptionsForProperty(propertyId);
  }

  const reservationId = Number(req.body.reservationId || 0);
  const forceCurrentPricing = Boolean(req.body.forceCurrentPricing);
  let lockedPricing = {
    lockedNightlyBreakdown: req.body.lockedNightlyBreakdown,
    lockedOptionLines: req.body.lockedOptionLines,
    lockedResourceLines: req.body.lockedResourceLines,
  };
  if (reservationId > 0 && !forceCurrentPricing) {
    const existingReservation = model.getPropertyIdOf(reservationId);
    if (existingReservation && Number(existingReservation.propertyId) === Number(req.body.propertyId)) {
      lockedPricing = model.getPricingSnapshot(reservationId);
    }
  }

  // specs/tourist-tax-freeze-past-with-refresh.md — when the client asks to freeze the tourist tax
  // (a PAST reservation, not being refreshed), source the frozen amount from the stored reservation so
  // the engine pins it instead of recomputing. No reservationId / no stored row → no freeze.
  let frozenTouristTax = null;
  if (req.body.freezeTouristTax && reservationId > 0) {
    frozenTouristTax = db.prepare('SELECT touristTaxTotal, touristTaxRate FROM reservations WHERE id = ?').get(reservationId);
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
    balanceAmount: req.body.balanceAmount,
    offeredOptionIds: req.body.offeredOptionIds,
    lockedOptionUnits: req.body.lockedOptionUnits,
    lockedResourceUnits: req.body.lockedResourceUnits,
    lockedNightlyBreakdown: lockedPricing.lockedNightlyBreakdown,
    lockedOptionLines: lockedPricing.lockedOptionLines,
    lockedResourceLines: lockedPricing.lockedResourceLines,
    platform: req.body.platform,
    touristTaxInComplement: req.body.touristTaxInComplement,
    autoOptionsInComplement: req.body.autoOptionsInComplement,
    freezeTouristTax: Boolean(frozenTouristTax),
    frozenTouristTaxTotal: frozenTouristTax ? frozenTouristTax.touristTaxTotal : 0,
    frozenTouristTaxRate: frozenTouristTax ? frozenTouristTax.touristTaxRate : 0,
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
  });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });
  res.json(quote);
}

function create(req, res) {
  const financeError = validateFinanceInputs({
    customPrice: { value: req.body.customPrice, kind: 'money' },
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    depositAmountOverride: { value: req.body.depositAmountOverride, kind: 'money' },
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
    forceMinNights, forceCapacity,
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
    discountPercent: req.body.discountPercent,
    customPrice: req.body.customPrice,
    selectedOptions: reservationOptions,
    customOptions: reservationCustomOptions,
    selectedResources: reservationResources,
    extraGuestSurchargeOffered: req.body.extraGuestSurchargeOffered,
    depositAmount: req.body.depositAmount,
    depositAmountOverride: req.body.depositAmountOverride,
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
  });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });
  if (quote.minNightsBreached && !forceMinNights) {
    return res.status(409).json({
      error: `Cette réservation comporte ${quote.nights} nuit(s), inférieur au minimum requis (${quote.requiredMinNights}).`,
      code: 'MIN_NIGHTS', requiredMinNights: quote.requiredMinNights, nights: quote.nights, minNightsRules: quote.minNightsRules,
    });
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
    babyBeds: effectiveBabyBeds, singleBeds: effectiveSingleBeds, doubleBeds: effectiveDoubleBeds,
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

  res.json({ id: reservationId, reservationNumber: model.getReservationNumber(reservationId) });
  // Fire-and-forget Google push — never awaited, never fails the request (spec rule 19).
  googleCalendarSync.schedulePush(reservationId);
}

function update(req, res) {
  const financeError = validateFinanceInputs({
    customPrice: { value: req.body.customPrice, kind: 'money' },
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    depositAmountOverride: { value: req.body.depositAmountOverride, kind: 'money' },
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

  // Reservation number override collision guard (specs/reservation-number-and-search.md §3 rule 4) —
  // a blank value keeps the existing number (handled in the model), so only a non-empty duplicate fails.
  const numberError = reservationNumberOverrideError(req.body.reservationNumber, id);
  if (numberError) return res.status(400).json(numberError);

  const {
    propertyId, clientId, startDate, endDate, adults, children, teens, babies,
    singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
    forceMinNights, forceCapacity, refreshPricingToCurrent,
    options: rawUpdateOptions, customOptions: reservationCustomOptions, resources: reservationResources,
  } = req.body;

  // specs/reservation-option-immutability.md rule 3 — an existing reservation is frozen: on
  // update we persist exactly the operator's submitted option set. Property defaults are NOT
  // re-merged here (they apply on CREATE only, see the create path above), so editing a
  // reservation never adds an option it did not already carry. Options the reservation does
  // carry are present in `rawUpdateOptions` and thus preserved.
  const reservationOptions = rawUpdateOptions || [];
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
    : { lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] };

  // Per-reservation opt-out of the deposit/balance split. When ON, force-zero the deposit-
  // paid fields too so the accounting export emits a single journal entry. The pricing
  // engine reads depositDisabled directly to short-circuit the deposit math.
  // See specs/disable-deposit-per-reservation.md.
  const depositDisabledFlag = req.body.depositDisabled ? 1 : 0;
  const effectiveDepositPaid = depositDisabledFlag ? false : req.body.depositPaid;
  const effectiveDepositPaidDate = depositDisabledFlag ? null : req.body.depositPaidDate;

  const quote = calculateReservationQuote({
    db,
    propertyId: Number(propertyId),
    startDate, endDate, checkInTime, checkOutTime,
    adults, children, teens, babies,
    discountPercent: req.body.discountPercent,
    customPrice: req.body.customPrice,
    selectedOptions: reservationOptions,
    customOptions: reservationCustomOptions,
    selectedResources: reservationResources,
    extraGuestSurchargeOffered: req.body.extraGuestSurchargeOffered,
    depositPaid: effectiveDepositPaid,
    balancePaid: req.body.balancePaid,
    complementPaid: req.body.complementPaid,
    depositAmount: req.body.depositAmount,
    depositAmountOverride: req.body.depositAmountOverride,
    balanceAmount: req.body.balanceAmount,
    complementAmount: req.body.complementAmount,
    offeredOptionIds: req.body.offeredOptionIds,
    lockedNightlyBreakdown: lockedPricing.lockedNightlyBreakdown,
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
        babyBeds: effectiveBabyBeds, singleBeds: effectiveSingleBeds, doubleBeds: effectiveDoubleBeds,
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
  const modelPayload = depositDisabledFlag
    ? { ...req.body, depositPaid: false, depositPaidDate: null }
    : req.body;
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

  const changes = computeAuditChanges(beforeAuditSnapshot, afterAuditSnapshot);
  if (existingReservation && String(existingReservation.sourceType || '') === 'ical' && Number(existingReservation.icalSyncLocked || 0) !== 1 && nextIcalSyncLocked === 1) {
    changes.push({ field: 'icalSyncLocked', label: 'Synchronisation iCal', from: 'Active', to: 'Verrouillée après modification manuelle' });
  }
  if (changes.length > 0) model.addHistoryEntry(id, 'update', changes);

  res.json({ ok: true, reservationNumber: model.getReservationNumber(id) });
  googleCalendarSync.schedulePush(id);
}

// NOTE: updatePayment deliberately has no Google hook — payment/caution/SAS fields don't
// appear in the calendar event (spec rule 21).
function updatePayment(req, res) {
  // specs/reception-role-checkin-only.md §3.5 rule 10 — a reception-only user may flip ONLY the
  // check-in/out status flags through this endpoint; every financial field in the same payload is
  // dropped before any processing (fail-closed field guard).
  if (isReceptionOnly(req)) {
    req.body = toReceptionPaymentPatch(req.body);
  }
  const financeError = validateFinanceInputs({
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    balanceAmount: { value: req.body.balanceAmount, kind: 'money' },
    cautionAmount: { value: req.body.cautionAmount, kind: 'money' },
  });
  if (financeError) return res.status(400).json({ error: financeError });
  const existing = model.getBasic(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Réservation non trouvée' });

  const { depositPaid, depositPaidDate, balancePaid, balancePaidDate,
    complementPaid, complementPaidDate, complementPaidCash,
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
      })();
    } catch (err) {
      return res.status(409).json({ error: `Capture des contributions impossible : ${err.message}`, code: 'CONTRIB_CAPTURE_FAILED' });
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
  create, update, updatePayment, remove,
};
