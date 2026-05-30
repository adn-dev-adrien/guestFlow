/**
 * Reservations controller — orchestrates each endpoint: parse input → finance validation → pricing
 * engine → occupancy/capacity checks → model writes → response shaping. Holds the flow that used to
 * live inline in routes/reservations.js; all SQL is in reservationsModel, all rules in utils.
 */

const db = require('../database');
const { calculateReservationQuote } = require('../utils/pricing');
const { validateFinanceInputs, validateClientGrossAmount } = require('../utils/financeValidation');
const { getNightBlocksFromTimes, buildOccupiedDatesFromReservations } = require('../utils/occupancy');
const { computeNextIcalSyncLocked, getTodayIsoDate } = require('../utils/reservationHelpers');
const { buildAuditSnapshotFromPayload, computeAuditChanges } = require('../utils/reservationAudit');
const { suggestBedDistribution } = require('../utils/bedDistribution');
const establishmentClosuresModel = require('../models/establishmentClosuresModel');
const reservationsModel = require('../models/reservationsModel');

const model = reservationsModel;

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
  res.json(model.list({ propertyId, clientId, from, to }));
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
  res.json(reservation);
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
    balanceAmount: req.body.balanceAmount,
    offeredOptionIds: req.body.offeredOptionIds,
    lockedOptionUnits: req.body.lockedOptionUnits,
    lockedResourceUnits: req.body.lockedResourceUnits,
    lockedNightlyBreakdown: lockedPricing.lockedNightlyBreakdown,
    lockedOptionLines: lockedPricing.lockedOptionLines,
    lockedResourceLines: lockedPricing.lockedResourceLines,
    platform: req.body.platform,
  });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });
  res.json(quote);
}

function create(req, res) {
  const financeError = validateFinanceInputs({
    customPrice: { value: req.body.customPrice, kind: 'money' },
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    balanceAmount: { value: req.body.balanceAmount, kind: 'money' },
    cautionAmount: { value: req.body.cautionAmount, kind: 'money' },
    clientGrossAmount: { value: req.body.clientGrossAmount, kind: 'money' },
    discountPercent: { value: req.body.discountPercent, kind: 'percentage' },
  });
  if (financeError) return res.status(400).json({ error: financeError });

  const {
    propertyId, clientId, startDate, endDate, adults, children, teens, babies,
    singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
    forceMinNights, forceCapacity,
    options: reservationOptions, customOptions: reservationCustomOptions, resources: reservationResources,
  } = req.body;

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
    balanceAmount: req.body.balanceAmount,
    offeredOptionIds: req.body.offeredOptionIds,
  });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });
  if (quote.minNightsBreached && !forceMinNights) {
    return res.status(409).json({
      error: `Cette réservation comporte ${quote.nights} nuit(s), inférieur au minimum requis (${quote.requiredMinNights}).`,
      code: 'MIN_NIGHTS', requiredMinNights: quote.requiredMinNights, nights: quote.nights, minNightsRules: quote.minNightsRules,
    });
  }

  const grossError = validateClientGrossAmount(req.body.clientGrossAmount, quote.finalPrice);
  if (grossError) return res.status(400).json({ error: grossError });

  const nightBlocks = getNightBlocksFromTimes(checkInTime, checkOutTime);
  const validationError = model.validateAvailability(propertyId, startDate, endDate, checkInTime, checkOutTime, null, nightBlocks);
  if (validationError) return res.status(409).json(validationError);

  const capacityError = checkCapacity({ propertyId, adults, children, teens, babies, babyBeds, singleBeds, doubleBeds, forceCapacity });
  if (capacityError) return res.status(400).json({ error: capacityError });

  const babyError = checkBabyBeds({ propertyId, startDate, endDate, children, babies, babyBeds, excludeId: null });
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

  res.json({ id: reservationId });
}

function update(req, res) {
  const financeError = validateFinanceInputs({
    customPrice: { value: req.body.customPrice, kind: 'money' },
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    balanceAmount: { value: req.body.balanceAmount, kind: 'money' },
    cautionAmount: { value: req.body.cautionAmount, kind: 'money' },
    clientGrossAmount: { value: req.body.clientGrossAmount, kind: 'money' },
    discountPercent: { value: req.body.discountPercent, kind: 'percentage' },
  });
  if (financeError) return res.status(400).json({ error: financeError });

  const id = Number(req.params.id);
  const {
    propertyId, clientId, startDate, endDate, adults, children, teens, babies,
    singleBeds, doubleBeds, babyBeds, checkInTime, checkOutTime,
    forceMinNights, forceCapacity, refreshPricingToCurrent,
    options: reservationOptions, customOptions: reservationCustomOptions, resources: reservationResources,
  } = req.body;

  const beforeAuditSnapshot = model.getAuditSnapshotFromDb(id);
  const pastReservationLocked = Boolean(beforeAuditSnapshot?.startDate && beforeAuditSnapshot.startDate <= getTodayIsoDate());

  const existingReservation = model.getForUpdate(id);
  const canReuseLockedPricing = !refreshPricingToCurrent
    && existingReservation
    && Number(existingReservation.propertyId) === Number(propertyId);
  const lockedPricing = canReuseLockedPricing
    ? model.getPricingSnapshot(id)
    : { lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] };

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
    depositPaid: req.body.depositPaid,
    balancePaid: req.body.balancePaid,
    complementPaid: req.body.complementPaid,
    depositAmount: req.body.depositAmount,
    balanceAmount: req.body.balanceAmount,
    complementAmount: req.body.complementAmount,
    offeredOptionIds: req.body.offeredOptionIds,
    lockedNightlyBreakdown: lockedPricing.lockedNightlyBreakdown,
    lockedOptionLines: lockedPricing.lockedOptionLines,
    lockedResourceLines: lockedPricing.lockedResourceLines,
  });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });

  const grossError = validateClientGrossAmount(req.body.clientGrossAmount, quote.finalPrice);
  if (grossError) return res.status(400).json({ error: grossError });

  const afterAuditSnapshot = buildAuditSnapshotFromPayload(req.body, quote);
  if (pastReservationLocked) {
    const allowedLockedFields = new Set([
      'clientId', 'platform', 'touristTaxRate', 'touristTaxTotal', 'discountPercent', 'finalPrice',
      'extraGuestSurchargeOffered', 'depositAmount', 'balanceAmount', 'depositPaid', 'balancePaid',
      'cautionReceived', 'cautionReceivedDate', 'cautionReturned', 'cautionReturnedDate',
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
    const validationError = model.validateAvailability(propertyId, startDate, endDate, checkInTime, checkOutTime, id, nightBlocks);
    if (validationError) return res.status(409).json(validationError);

    const capacityError = checkCapacity({ propertyId, adults, children, teens, babies, babyBeds, singleBeds, doubleBeds, forceCapacity });
    if (capacityError) return res.status(400).json({ error: capacityError });

    const babyError = checkBabyBeds({ propertyId, startDate, endDate, children, babies, babyBeds, excludeId: id });
    if (babyError) return res.status(400).json({ error: babyError });
  }

  const nextIcalSyncLocked = computeNextIcalSyncLocked(existingReservation);
  model.updateReservation(id, req.body, quote, nightBlocks, nextIcalSyncLocked);

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

  res.json({ ok: true });
}

function updatePayment(req, res) {
  const financeError = validateFinanceInputs({
    depositAmount: { value: req.body.depositAmount, kind: 'money' },
    balanceAmount: { value: req.body.balanceAmount, kind: 'money' },
    cautionAmount: { value: req.body.cautionAmount, kind: 'money' },
  });
  if (financeError) return res.status(400).json({ error: financeError });
  const existing = model.getBasic(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Réservation non trouvée' });

  const { depositPaid, depositPaidDate, balancePaid, balancePaidDate,
    complementPaid, complementPaidDate,
    cautionReceived, cautionReceivedDate, cautionReturned, cautionReturnedDate,
    checkInReady, checkInDone, checkOutDone } = req.body;
  const id = req.params.id;
  if (depositPaid !== undefined) {
    // Real encaissement date: defaults to today on flip-to-paid (editable), cleared on flip-to-unpaid.
    const date = depositPaid ? (depositPaidDate || new Date().toISOString().split('T')[0]) : null;
    model.updatePaymentField(
      "UPDATE reservations SET depositPaid = ?, depositPaidDate = ?, updatedAt = datetime('now') WHERE id = ?",
      depositPaid ? 1 : 0, date, id,
    );
  }
  if (balancePaid !== undefined) {
    const date = balancePaid ? (balancePaidDate || new Date().toISOString().split('T')[0]) : null;
    model.updatePaymentField(
      "UPDATE reservations SET balancePaid = ?, balancePaidDate = ?, updatedAt = datetime('now') WHERE id = ?",
      balancePaid ? 1 : 0, date, id,
    );
  }
  if (complementPaid !== undefined) {
    // Same model as deposit / balance — defaults to today on flip-to-paid, cleared on flip-to-unpaid.
    const date = complementPaid ? (complementPaidDate || new Date().toISOString().split('T')[0]) : null;
    model.updatePaymentField(
      "UPDATE reservations SET complementPaid = ?, complementPaidDate = ?, updatedAt = datetime('now') WHERE id = ?",
      complementPaid ? 1 : 0, date, id,
    );
  }
  if (cautionReceived !== undefined) {
    const date = cautionReceivedDate || (cautionReceived ? new Date().toISOString().split('T')[0] : null);
    model.updatePaymentField('UPDATE reservations SET cautionReceived = ?, cautionReceivedDate = ?, updatedAt = datetime(\'now\') WHERE id = ?', cautionReceived ? 1 : 0, date, id);
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
  if (existing.endDate < today) {
    return res.status(403).json({ error: 'Cette réservation est archivée (terminée) et ne peut plus être modifiée.' });
  }
  model.remove(req.params.id);
  res.json({ ok: true });
}

module.exports = {
  suggestBeds, list, occupiedDates, getById, getHistory, calculatePrice,
  create, update, updatePayment, remove,
};
