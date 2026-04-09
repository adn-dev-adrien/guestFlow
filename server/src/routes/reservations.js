const router = require('express').Router();
const db = require('../database');
const { sentenceCase } = require('../utils/textFormatters');
const { calculateReservationQuote } = require('../utils/pricing');

const HISTORY_FIELD_LABELS = {
  propertyId: 'Logement',
  clientId: 'Client',
  startDate: 'Date arrivée',
  endDate: 'Date départ',
  adults: 'Adultes',
  children: 'Enfants',
  teens: 'Ados',
  babies: 'Bébés',
  singleBeds: 'Lits simples',
  doubleBeds: 'Lits doubles',
  babyBeds: 'Lits bébé',
  checkInTime: 'Heure arrivée',
  checkOutTime: 'Heure départ',
  platform: 'Plateforme',
  totalPrice: 'Prix hébergement',
  discountPercent: 'Réduction (%)',
  finalPrice: 'Prix final',
  depositAmount: 'Acompte',
  depositDueDate: 'Date acompte',
  balanceAmount: 'Solde',
  balanceDueDate: 'Date solde',
  notes: 'Notes',
  cautionAmount: 'Caution',
  cautionReceived: 'Caution reçue',
  cautionReceivedDate: 'Date réception caution',
  cautionReturned: 'Caution restituée',
  cautionReturnedDate: 'Date restitution caution',
  optionsSignature: 'Options',
  resourcesSignature: 'Ressources',
};

function normalizeHistoryValue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return Math.round(value * 100) / 100;
  return value;
}

function getOptionsSignature(lines) {
  return (lines || [])
    .map((line) => ({
      optionId: Number(line.optionId),
      quantity: Number(line.quantity || 0),
      totalPrice: Number(line.totalPrice || 0),
    }))
    .sort((a, b) => a.optionId - b.optionId)
    .map((line) => `${line.optionId}:${line.quantity}:${line.totalPrice.toFixed(2)}`)
    .join('|');
}

function getResourcesSignature(lines) {
  return (lines || [])
    .map((line) => ({
      resourceId: Number(line.resourceId),
      quantity: Number(line.quantity || 0),
      totalPrice: Number(line.totalPrice || 0),
    }))
    .sort((a, b) => a.resourceId - b.resourceId)
    .map((line) => `${line.resourceId}:${line.quantity}:${line.totalPrice.toFixed(2)}`)
    .join('|');
}

function getReservationAuditSnapshotFromDb(reservationId) {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
  if (!row) return null;
  const options = db.prepare('SELECT optionId, quantity, totalPrice FROM reservation_options WHERE reservationId = ?').all(reservationId);
  const resources = db.prepare('SELECT resourceId, quantity, totalPrice FROM reservation_resources WHERE reservationId = ?').all(reservationId);
  return {
    propertyId: Number(row.propertyId),
    clientId: Number(row.clientId),
    startDate: row.startDate || null,
    endDate: row.endDate || null,
    adults: Number(row.adults || 0),
    children: Number(row.children || 0),
    teens: Number(row.teens || 0),
    babies: Number(row.babies || 0),
    singleBeds: row.singleBeds === null ? null : Number(row.singleBeds),
    doubleBeds: row.doubleBeds === null ? null : Number(row.doubleBeds),
    babyBeds: row.babyBeds === null ? null : Number(row.babyBeds),
    checkInTime: row.checkInTime || null,
    checkOutTime: row.checkOutTime || null,
    platform: row.platform || null,
    totalPrice: Number(row.totalPrice || 0),
    discountPercent: Number(row.discountPercent || 0),
    finalPrice: Number(row.finalPrice || 0),
    depositAmount: Number(row.depositAmount || 0),
    depositDueDate: row.depositDueDate || null,
    balanceAmount: Number(row.balanceAmount || 0),
    balanceDueDate: row.balanceDueDate || null,
    notes: row.notes || null,
    cautionAmount: Number(row.cautionAmount || 0),
    cautionReceived: Number(row.cautionReceived || 0),
    cautionReceivedDate: row.cautionReceivedDate || null,
    cautionReturned: Number(row.cautionReturned || 0),
    cautionReturnedDate: row.cautionReturnedDate || null,
    optionsSignature: getOptionsSignature(options),
    resourcesSignature: getResourcesSignature(resources),
  };
}

function getReservationAuditSnapshotFromPayload(payload, quote) {
  return {
    propertyId: Number(payload.propertyId),
    clientId: Number(payload.clientId),
    startDate: payload.startDate || null,
    endDate: payload.endDate || null,
    adults: Number(payload.adults || 0),
    children: Number(payload.children || 0),
    teens: Number(payload.teens || 0),
    babies: Number(payload.babies || 0),
    singleBeds: payload.singleBeds === null || payload.singleBeds === undefined || payload.singleBeds === '' ? null : Number(payload.singleBeds),
    doubleBeds: payload.doubleBeds === null || payload.doubleBeds === undefined || payload.doubleBeds === '' ? null : Number(payload.doubleBeds),
    babyBeds: payload.babyBeds === null || payload.babyBeds === undefined || payload.babyBeds === '' ? null : Number(payload.babyBeds),
    checkInTime: payload.checkInTime || null,
    checkOutTime: payload.checkOutTime || null,
    platform: payload.platform || null,
    totalPrice: Number(quote.totalPrice || 0),
    discountPercent: Number(payload.discountPercent || 0),
    finalPrice: Number(quote.finalPrice || 0),
    depositAmount: Number(quote.depositAmount || 0),
    depositDueDate: quote.depositDueDate || payload.depositDueDate || null,
    balanceAmount: Number(quote.balanceAmount || 0),
    balanceDueDate: quote.balanceDueDate || payload.balanceDueDate || null,
    notes: sentenceCase(payload.notes) || null,
    cautionAmount: Number(payload.cautionAmount || 0),
    cautionReceived: payload.cautionReceived ? 1 : 0,
    cautionReceivedDate: payload.cautionReceivedDate || null,
    cautionReturned: payload.cautionReturned ? 1 : 0,
    cautionReturnedDate: payload.cautionReturnedDate || null,
    optionsSignature: getOptionsSignature(quote.optionLines || []),
    resourcesSignature: getResourcesSignature(quote.resourceLines || []),
  };
}

function computeAuditChanges(beforeSnapshot, afterSnapshot) {
  const keys = Object.keys(HISTORY_FIELD_LABELS);
  const changes = [];
  keys.forEach((key) => {
    const beforeValue = normalizeHistoryValue(beforeSnapshot?.[key]);
    const afterValue = normalizeHistoryValue(afterSnapshot?.[key]);
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.push({
        field: key,
        label: HISTORY_FIELD_LABELS[key] || key,
        from: beforeValue,
        to: afterValue,
      });
    }
  });
  return changes;
}

function addReservationHistoryEntry(reservationId, eventType, changes) {
  db.prepare('INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, ?, ?)')
    .run(reservationId, eventType, JSON.stringify(changes || []));
}

function computeNextIcalSyncLocked(existingReservation) {
  if (!existingReservation) return 0;
  if (String(existingReservation.sourceType || '') === 'ical') return 1;
  return Number(existingReservation.icalSyncLocked || 0);
}

// List reservations (optionally filter by propertyId, clientId, date range)
router.get('/', (req, res) => {
  const { propertyId, clientId, from, to } = req.query;
  let sql = `
    SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName
    FROM reservations r
    JOIN clients c ON r.clientId = c.id
    JOIN properties p ON r.propertyId = p.id
    WHERE 1=1
  `;
  const params = [];
  if (propertyId) { sql += ' AND r.propertyId = ?'; params.push(propertyId); }
  if (clientId) { sql += ' AND r.clientId = ?'; params.push(clientId); }
  if (from) { sql += ' AND r.endDate >= ?'; params.push(from); }
  if (to) { sql += ' AND r.startDate <= ?'; params.push(to); }
  sql += ' ORDER BY r.startDate';
  const reservations = db.prepare(sql).all(...params);
  res.json(reservations);
});

// Get single reservation with options
router.get('/:id', (req, res) => {
  const reservation = db.prepare(`
    SELECT r.*, c.lastName, c.firstName, c.email, c.phone, p.name as propertyName
    FROM reservations r
    JOIN clients c ON r.clientId = c.id
    JOIN properties p ON r.propertyId = p.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });

  reservation.options = db.prepare(`
    SELECT ro.*, o.title, o.description, o.priceType as currentPriceType, o.price as currentUnitPrice
    FROM reservation_options ro
    JOIN options o ON ro.optionId = o.id
    WHERE ro.reservationId = ?
  `).all(req.params.id);

  reservation.resources = db.prepare(`
    SELECT rr.*, rs.name, rs.note, rs.propertyId, rs.priceType
    FROM reservation_resources rr
    JOIN resources rs ON rr.resourceId = rs.id
    WHERE rr.reservationId = ?
  `).all(req.params.id);

  reservation.nights = db.prepare(`
    SELECT date, seasonLabel, pricingMode, price
    FROM reservation_nights
    WHERE reservationId = ?
    ORDER BY date
  `).all(req.params.id);

  res.json(reservation);
});

router.get('/:id/history', (req, res) => {
  const reservation = db.prepare('SELECT id, createdAt FROM reservations WHERE id = ?').get(req.params.id);
  if (!reservation) return res.status(404).json({ error: 'Réservation non trouvée' });

  const rows = db.prepare(`
    SELECT id, eventType, changedFields, createdAt
    FROM reservation_history
    WHERE reservationId = ?
    ORDER BY datetime(createdAt) DESC, id DESC
  `).all(req.params.id);

  const history = rows.map((row) => {
    let changedFields = [];
    try {
      changedFields = JSON.parse(row.changedFields || '[]');
    } catch {
      changedFields = [];
    }
    return {
      id: row.id,
      eventType: row.eventType,
      createdAt: row.createdAt,
      changedFields,
    };
  });

  res.json(history);
});

function getReservationPricingSnapshot(reservationId) {
  const lockedNightlyBreakdown = db.prepare(`
    SELECT date, seasonLabel, pricingMode, price
    FROM reservation_nights
    WHERE reservationId = ?
    ORDER BY date
  `).all(reservationId);

  const lockedOptionLines = db.prepare(`
    SELECT optionId, quantity, unitPrice, billedUnits, priceType, totalPrice
    FROM reservation_options
    WHERE reservationId = ?
  `).all(reservationId);

  const lockedResourceLines = db.prepare(`
    SELECT resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice
    FROM reservation_resources
    WHERE reservationId = ?
  `).all(reservationId);

  return {
    lockedNightlyBreakdown,
    lockedOptionLines,
    lockedResourceLines,
  };
}

// Calculate price for a potential reservation
router.post('/calculate-price', (req, res) => {
  const reservationId = Number(req.body.reservationId || 0);
  const forceCurrentPricing = Boolean(req.body.forceCurrentPricing);
  let lockedPricing = {
    lockedNightlyBreakdown: req.body.lockedNightlyBreakdown,
    lockedOptionLines: req.body.lockedOptionLines,
    lockedResourceLines: req.body.lockedResourceLines,
  };

  if (reservationId > 0 && !forceCurrentPricing) {
    const existingReservation = db.prepare('SELECT propertyId FROM reservations WHERE id = ?').get(reservationId);
    if (existingReservation && Number(existingReservation.propertyId) === Number(req.body.propertyId)) {
      lockedPricing = getReservationPricingSnapshot(reservationId);
    }
  }

  const quote = calculateReservationQuote({
    db,
    propertyId: Number(req.body.propertyId),
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
    selectedResources: req.body.selectedResources,
    depositPaid: req.body.depositPaid,
    balancePaid: req.body.balancePaid,
    depositAmount: req.body.depositAmount,
    balanceAmount: req.body.balanceAmount,
    lockedOptionUnits: req.body.lockedOptionUnits,
    lockedResourceUnits: req.body.lockedResourceUnits,
    lockedNightlyBreakdown: lockedPricing.lockedNightlyBreakdown,
    lockedOptionLines: lockedPricing.lockedOptionLines,
    lockedResourceLines: lockedPricing.lockedResourceLines,
  });
  if (quote.error) return res.status(quote.status || 400).json({ error: quote.error });
  res.json(quote);
});

// Helper to parse time string to decimal hours
function timeToHour(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

// Shared validation for create and update
// excludeId: reservation ID to exclude (for updates)
function validateReservation(propertyId, startDate, endDate, checkInTime, checkOutTime, excludeId) {
  const property = db.prepare('SELECT cleaningHours FROM properties WHERE id = ?').get(propertyId);
  const cleaning = property ? (property.cleaningHours ?? 3) : 3;

  // Reject past start dates
  const today = new Date().toISOString().split('T')[0];
  if (startDate < today) {
    return { error: 'Impossible de réserver dans le passé.' };
  }

  // Strict overlap: reservations whose date range overlaps (excluding same-day turnover)
  let overlapSql = 'SELECT id FROM reservations WHERE propertyId = ? AND startDate < ? AND endDate > ?';
  const overlapParams = [propertyId, endDate, startDate];
  if (excludeId) {
    overlapSql += ' AND id != ?';
    overlapParams.push(excludeId);
  }
  const strictOverlaps = db.prepare(overlapSql).all(...overlapParams);
  if (strictOverlaps.length > 0) {
    return { error: 'Ce logement est déjà réservé pour ces dates.' };
  }

  // Turnover at start: existing reservation ending on our start date
  let prevSql = 'SELECT checkOutTime FROM reservations WHERE propertyId = ? AND endDate = ?';
  const prevParams = [propertyId, startDate];
  if (excludeId) { prevSql += ' AND id != ?'; prevParams.push(excludeId); }
  const prevRes = db.prepare(prevSql).get(...prevParams);
  if (prevRes) {
    const prevCheckOut = timeToHour(prevRes.checkOutTime || '10:00');
    const newCheckIn = timeToHour(checkInTime || '15:00');
    if (newCheckIn < prevCheckOut + cleaning) {
      const availH = String(Math.floor(prevCheckOut + cleaning)).padStart(2, '0');
      const availM = (prevCheckOut + cleaning) % 1 >= 0.5 ? '30' : '00';
      return {
        error: `Arrivée impossible à ${checkInTime || '15:00'}. Le logement n'est disponible qu'à partir de ${availH}:${availM} (départ ${prevRes.checkOutTime || '10:00'} + ${cleaning}h ménage).`
      };
    }
  }

  // Turnover at end: existing reservation starting on our end date
  let nextSql = 'SELECT checkInTime FROM reservations WHERE propertyId = ? AND startDate = ?';
  const nextParams = [propertyId, endDate];
  if (excludeId) { nextSql += ' AND id != ?'; nextParams.push(excludeId); }
  const nextRes = db.prepare(nextSql).get(...nextParams);
  if (nextRes) {
    const newCheckOut = timeToHour(checkOutTime || '10:00');
    const nextCheckIn = timeToHour(nextRes.checkInTime || '15:00');
    if (newCheckOut + cleaning > nextCheckIn) {
      const maxCheckOut = nextCheckIn - cleaning;
      const maxH = String(Math.floor(maxCheckOut)).padStart(2, '0');
      const maxM = maxCheckOut % 1 >= 0.5 ? '30' : '00';
      return {
        error: `Départ à ${checkOutTime || '10:00'} + ${cleaning}h de ménage empêche l'arrivée du client suivant à ${nextRes.checkInTime || '15:00'}. L'heure de départ maximale est ${maxH}:${maxM}.`
      };
    }
  }

  return null; // no error
}

function getArchivedReservationError(reservationId) {
  const existing = db.prepare('SELECT id, endDate FROM reservations WHERE id = ?').get(reservationId);
  if (!existing) return { status: 404, body: { error: 'Réservation non trouvée' } };
  const today = new Date().toISOString().split('T')[0];
  if (existing.endDate < today) {
    return {
      status: 403,
      body: { error: 'Cette réservation est archivée (terminée) et ne peut plus être modifiée.' },
    };
  }
  return null;
}

// Create reservation
router.post('/', (req, res) => {
  const {
    propertyId, clientId, startDate, endDate, adults, children, teens, babies,
    singleBeds, doubleBeds, babyBeds,
    checkInTime, checkOutTime,
    platform, discountPercent, customPrice,
    forceMinNights,
    depositAmount, depositDueDate, balanceAmount, balanceDueDate, notes,
    cautionAmount,
    options: reservationOptions,
    resources: reservationResources
  } = req.body;

  const quote = calculateReservationQuote({
    db,
    propertyId: Number(propertyId),
    startDate,
    endDate,
    checkInTime,
    checkOutTime,
    adults,
    children,
    teens,
    discountPercent,
    customPrice,
    selectedOptions: reservationOptions,
    selectedResources: reservationResources,
    depositAmount,
    balanceAmount,
  });
  if (quote.error) {
    return res.status(quote.status || 400).json({ error: quote.error });
  }
  if (quote.minNightsBreached && !forceMinNights) {
    return res.status(409).json({
      error: `Cette réservation comporte ${quote.nights} nuit(s), inférieur au minimum requis (${quote.requiredMinNights}).`,
      code: 'MIN_NIGHTS',
      requiredMinNights: quote.requiredMinNights,
      nights: quote.nights,
      minNightsRules: quote.minNightsRules,
    });
  }

  const validationError = validateReservation(propertyId, startDate, endDate, checkInTime, checkOutTime, null);
  if (validationError) {
    return res.status(409).json(validationError);
  }

  const property = db.prepare('SELECT singleBeds, doubleBeds, maxAdults, maxChildren, maxBabies FROM properties WHERE id = ?').get(propertyId);
  if (property) {
    const adultsCount = Number(adults || 1);
    const childrenCount = Number(children || 0);
    const teensCount = Number(teens || 0);
    const babiesCount = Number(babies || 0);
    const babyBedsCount = Number(babyBeds || 0);
    const childrenSleepingInBabyBeds = Math.max(0, Math.min(childrenCount, babyBedsCount - babiesCount));
    const childrenTeensCount = Math.max(0, childrenCount - childrenSleepingInBabyBeds) + teensCount;
    const totalGuests = adultsCount + childrenCount + teensCount + babiesCount;
    const totalMax = Number(property.maxAdults || 0) + Number(property.maxChildren || 0) + Number(property.maxBabies || 0);

    if (adultsCount > Number(property.maxAdults || 0)) {
      return res.status(400).json({ error: `Le nombre d'adultes (${adultsCount}) dépasse la capacité du logement (${property.maxAdults || 0}).` });
    }
    if (childrenTeensCount > Number(property.maxChildren || 0)) {
      return res.status(400).json({ error: `Le nombre d'enfants + ados hors lit bébé (${childrenTeensCount}) dépasse la capacité du logement (${property.maxChildren || 0}).` });
    }
    if (babiesCount > Number(property.maxBabies || 0)) {
      return res.status(400).json({ error: `Le nombre de bébés (${babiesCount}) dépasse la capacité du logement (${property.maxBabies || 0}).` });
    }
    if (totalGuests > totalMax) {
      return res.status(400).json({ error: `Le nombre total de personnes (${totalGuests}) dépasse la capacité du logement (${totalMax}).` });
    }

    if (singleBeds !== null && singleBeds !== undefined && singleBeds !== '' && Number(singleBeds) > Number(property.singleBeds || 0)) {
      return res.status(400).json({ error: `Le nombre de lits simples (${singleBeds}) dépasse la capacité du logement (${property.singleBeds || 0}).` });
    }
    if (doubleBeds !== null && doubleBeds !== undefined && doubleBeds !== '' && Number(doubleBeds) > Number(property.doubleBeds || 0)) {
      return res.status(400).json({ error: `Le nombre de lits doubles (${doubleBeds}) dépasse la capacité du logement (${property.doubleBeds || 0}).` });
    }
  }

  const childrenCount = Number(children || 0);
  const babiesCount = Number(babies || 0);
  const babyBedsCount = Number(babyBeds || 0);
  if (babyBedsCount > babiesCount + childrenCount) {
    return res.status(400).json({ error: `Le nombre de lits bébé (${babyBedsCount}) ne peut pas dépasser le nombre total de bébés et d'enfants (${babiesCount + childrenCount}).` });
  }

  const babyResources = db.prepare(`
    SELECT * FROM resources
    WHERE (lower(name) = lower('Lit bébé') OR lower(name) = lower('Lit bebe'))
      AND (propertyId IS NULL OR propertyId = ?)
  `).all(propertyId);
  const babyTotal = babyResources.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
  const babyHasGlobal = babyResources.some(r => r.propertyId === null);
  let babyReservedSql = 'SELECT COALESCE(SUM(COALESCE(babyBeds, 0)), 0) as reserved FROM reservations WHERE startDate < ? AND endDate > ?';
  const babyReservedParams = [endDate, startDate];
  if (!babyHasGlobal) {
    babyReservedSql += ' AND propertyId = ?';
    babyReservedParams.push(propertyId);
  }
  const babyReserved = db.prepare(babyReservedSql).get(...babyReservedParams).reserved || 0;
  const babyAvailable = Math.max(0, Number(babyTotal) - Number(babyReserved));
  if (babyBedsCount > babyAvailable) {
    return res.status(400).json({ error: `Lits bébé indisponibles: ${babyAvailable} restant(s) pour cette période.` });
  }

  const result = db.prepare(`
    INSERT INTO reservations (propertyId, clientId, startDate, endDate, adults, children, teens, babies,
      singleBeds, doubleBeds, babyBeds,
      checkInTime, checkOutTime,
      platform, totalPrice, discountPercent, finalPrice, depositAmount, depositDueDate,
      balanceAmount, balanceDueDate, sourceType, sourcePlatformKey, sourceIcalSourceId, sourceIcalEventUid, icalSyncLocked,
      notes, cautionAmount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, NULL, NULL, 0, ?, ?)
  `).run(
    propertyId, clientId, startDate, endDate, adults || 1, children || 0, teens || 0, babies || 0,
    singleBeds ?? null, doubleBeds ?? null, babyBeds ?? null,
    checkInTime || '15:00', checkOutTime || '10:00',
    platform || 'direct', quote.totalPrice, quote.discountPercent || 0, quote.finalPrice,
    quote.depositAmount || 0, quote.depositDueDate || depositDueDate || null, quote.balanceAmount || 0, quote.balanceDueDate || balanceDueDate || null, sentenceCase(notes),
    cautionAmount || 0
  );

  const reservationId = result.lastInsertRowid;

  addReservationHistoryEntry(reservationId, 'create', [
    { field: 'sourceType', label: 'Origine', from: null, to: 'Création manuelle' },
  ]);

  // Insert reservation options
  if (reservationOptions && reservationOptions.length > 0) {
    const insertOpt = db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const opt of quote.optionLines || []) {
      insertOpt.run(
        reservationId,
        opt.optionId,
        opt.quantity || 1,
        Number(opt.unitPrice || 0),
        Number(opt.billedUnits || 0),
        opt.priceType || 'per_stay',
        opt.totalPrice || 0,
      );
    }
  }

  if (quote.nightlyBreakdown && quote.nightlyBreakdown.length > 0) {
    const insertNight = db.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)');
    for (const night of quote.nightlyBreakdown) {
      insertNight.run(
        reservationId,
        night.date,
        night.seasonLabel || 'Standard',
        night.pricingMode || 'fixed',
        Number(night.price || 0),
      );
    }
  }

  // Insert reservation resources with availability check
  if (reservationResources && reservationResources.length > 0) {
    const insertRes = db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const rr of quote.resourceLines || []) {
      const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(rr.resourceId);
      if (!resource) return res.status(400).json({ error: `Ressource introuvable (id=${rr.resourceId})` });
      const reserved = db.prepare(`
        SELECT COALESCE(SUM(rr2.quantity), 0) as reserved
        FROM reservation_resources rr2
        JOIN reservations r2 ON r2.id = rr2.reservationId
        WHERE rr2.resourceId = ? AND r2.startDate < ? AND r2.endDate > ?
      `).get(rr.resourceId, endDate, startDate).reserved || 0;
      const available = Number(resource.quantity) - Number(reserved);
      if (Number(rr.quantity || 0) > available) {
        return res.status(409).json({ error: `Ressource '${resource.name}' indisponible: ${available} restant(s) pour cette période.` });
      }
      const unitPrice = rr.unitPrice !== undefined ? Number(rr.unitPrice) : Number(resource.price || 0);
      const qty = Number(rr.quantity) || 1;
      insertRes.run(
        reservationId,
        rr.resourceId,
        qty,
        unitPrice,
        Number(rr.billedUnits || qty),
        rr.priceType || resource.priceType || 'per_stay',
        rr.totalPrice || unitPrice * qty,
      );
    }
  }

  res.json({ id: reservationId });
});

// Update reservation
router.put('/:id', (req, res) => {
  const archivedError = getArchivedReservationError(Number(req.params.id));
  if (archivedError) {
    return res.status(archivedError.status).json(archivedError.body);
  }

  const {
    propertyId, clientId, startDate, endDate, adults, children, teens, babies,
    singleBeds, doubleBeds, babyBeds,
    checkInTime, checkOutTime,
    platform, discountPercent, customPrice,
    forceMinNights,
    refreshPricingToCurrent,
    depositAmount, depositDueDate, depositPaid, balanceAmount, balanceDueDate, balancePaid, notes,
    cautionAmount, cautionReceived, cautionReceivedDate, cautionReturned, cautionReturnedDate,
    options: reservationOptions,
    resources: reservationResources
  } = req.body;

  const beforeAuditSnapshot = getReservationAuditSnapshotFromDb(Number(req.params.id));

  const existingReservation = db.prepare('SELECT propertyId, sourceType, icalSyncLocked FROM reservations WHERE id = ?').get(Number(req.params.id));
  const canReuseLockedPricing = !refreshPricingToCurrent
    && existingReservation
    && Number(existingReservation.propertyId) === Number(propertyId);
  const lockedPricing = canReuseLockedPricing
    ? getReservationPricingSnapshot(Number(req.params.id))
    : { lockedNightlyBreakdown: [], lockedOptionLines: [], lockedResourceLines: [] };

  const quote = calculateReservationQuote({
    db,
    propertyId: Number(propertyId),
    startDate,
    endDate,
    checkInTime,
    checkOutTime,
    adults,
    children,
    teens,
    discountPercent,
    customPrice,
    selectedOptions: reservationOptions,
    selectedResources: reservationResources,
    depositPaid,
    balancePaid,
    depositAmount,
    balanceAmount,
    lockedNightlyBreakdown: lockedPricing.lockedNightlyBreakdown,
    lockedOptionLines: lockedPricing.lockedOptionLines,
    lockedResourceLines: lockedPricing.lockedResourceLines,
  });
  if (quote.error) {
    return res.status(quote.status || 400).json({ error: quote.error });
  }
  if (quote.minNightsBreached && !forceMinNights) {
    return res.status(409).json({
      error: `Cette réservation comporte ${quote.nights} nuit(s), inférieur au minimum requis (${quote.requiredMinNights}).`,
      code: 'MIN_NIGHTS',
      requiredMinNights: quote.requiredMinNights,
      nights: quote.nights,
      minNightsRules: quote.minNightsRules,
    });
  }

  const validationError = validateReservation(propertyId, startDate, endDate, checkInTime, checkOutTime, Number(req.params.id));
  if (validationError) {
    return res.status(409).json(validationError);
  }

  const property = db.prepare('SELECT singleBeds, doubleBeds, maxAdults, maxChildren, maxBabies FROM properties WHERE id = ?').get(propertyId);
  if (property) {
    const adultsCount = Number(adults || 1);
    const childrenCount = Number(children || 0);
    const teensCount = Number(teens || 0);
    const babiesCount = Number(babies || 0);
    const babyBedsCount = Number(babyBeds || 0);
    const childrenSleepingInBabyBeds = Math.max(0, Math.min(childrenCount, babyBedsCount - babiesCount));
    const childrenTeensCount = Math.max(0, childrenCount - childrenSleepingInBabyBeds) + teensCount;
    const totalGuests = adultsCount + childrenCount + teensCount + babiesCount;
    const totalMax = Number(property.maxAdults || 0) + Number(property.maxChildren || 0) + Number(property.maxBabies || 0);

    if (adultsCount > Number(property.maxAdults || 0)) {
      return res.status(400).json({ error: `Le nombre d'adultes (${adultsCount}) dépasse la capacité du logement (${property.maxAdults || 0}).` });
    }
    if (childrenTeensCount > Number(property.maxChildren || 0)) {
      return res.status(400).json({ error: `Le nombre d'enfants + ados hors lit bébé (${childrenTeensCount}) dépasse la capacité du logement (${property.maxChildren || 0}).` });
    }
    if (babiesCount > Number(property.maxBabies || 0)) {
      return res.status(400).json({ error: `Le nombre de bébés (${babiesCount}) dépasse la capacité du logement (${property.maxBabies || 0}).` });
    }
    if (totalGuests > totalMax) {
      return res.status(400).json({ error: `Le nombre total de personnes (${totalGuests}) dépasse la capacité du logement (${totalMax}).` });
    }

    if (singleBeds !== null && singleBeds !== undefined && singleBeds !== '' && Number(singleBeds) > Number(property.singleBeds || 0)) {
      return res.status(400).json({ error: `Le nombre de lits simples (${singleBeds}) dépasse la capacité du logement (${property.singleBeds || 0}).` });
    }
    if (doubleBeds !== null && doubleBeds !== undefined && doubleBeds !== '' && Number(doubleBeds) > Number(property.doubleBeds || 0)) {
      return res.status(400).json({ error: `Le nombre de lits doubles (${doubleBeds}) dépasse la capacité du logement (${property.doubleBeds || 0}).` });
    }
  }

  const childrenCount = Number(children || 0);
  const babiesCount = Number(babies || 0);
  const babyBedsCount = Number(babyBeds || 0);
  if (babyBedsCount > babiesCount + childrenCount) {
    return res.status(400).json({ error: `Le nombre de lits bébé (${babyBedsCount}) ne peut pas dépasser le nombre total de bébés et d'enfants (${babiesCount + childrenCount}).` });
  }

  const babyResources = db.prepare(`
    SELECT * FROM resources
    WHERE (lower(name) = lower('Lit bébé') OR lower(name) = lower('Lit bebe'))
      AND (propertyId IS NULL OR propertyId = ?)
  `).all(propertyId);
  const babyTotal = babyResources.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
  const babyHasGlobal = babyResources.some(r => r.propertyId === null);
  let babyReservedSql = 'SELECT COALESCE(SUM(COALESCE(babyBeds, 0)), 0) as reserved FROM reservations WHERE startDate < ? AND endDate > ? AND id != ?';
  const babyReservedParams = [endDate, startDate, req.params.id];
  if (!babyHasGlobal) {
    babyReservedSql += ' AND propertyId = ?';
    babyReservedParams.push(propertyId);
  }
  const babyReserved = db.prepare(babyReservedSql).get(...babyReservedParams).reserved || 0;
  const babyAvailable = Math.max(0, Number(babyTotal) - Number(babyReserved));
  if (babyBedsCount > babyAvailable) {
    return res.status(400).json({ error: `Lits bébé indisponibles: ${babyAvailable} restant(s) pour cette période.` });
  }

  const nextIcalSyncLocked = computeNextIcalSyncLocked(existingReservation);

  db.prepare(`
    UPDATE reservations SET propertyId=?, clientId=?, startDate=?, endDate=?, adults=?, children=?, teens=?, babies=?,
      singleBeds=?, doubleBeds=?, babyBeds=?,
      checkInTime=?, checkOutTime=?,
      platform=?, totalPrice=?, discountPercent=?, finalPrice=?, depositAmount=?, depositDueDate=?,
      depositPaid=?, balanceAmount=?, balanceDueDate=?, balancePaid=?, notes=?,
      cautionAmount=?, cautionReceived=?, cautionReceivedDate=?, cautionReturned=?, cautionReturnedDate=?, icalSyncLocked=?,
      updatedAt=datetime('now')
    WHERE id=?
  `).run(
    propertyId, clientId, startDate, endDate, adults || 1, children || 0, teens || 0, babies || 0,
    singleBeds ?? null, doubleBeds ?? null, babyBeds ?? null,
    checkInTime || '15:00', checkOutTime || '10:00',
    platform || 'direct', quote.totalPrice, quote.discountPercent || 0, quote.finalPrice,
    quote.depositAmount || 0, quote.depositDueDate || depositDueDate || null, depositPaid ? 1 : 0,
    quote.balanceAmount || 0, quote.balanceDueDate || balanceDueDate || null, balancePaid ? 1 : 0, sentenceCase(notes),
    cautionAmount || 0, cautionReceived ? 1 : 0, cautionReceivedDate || null,
    cautionReturned ? 1 : 0, cautionReturnedDate || null, nextIcalSyncLocked,
    req.params.id
  );

  // Rebuild reservation options
  if (reservationOptions) {
    db.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(req.params.id);
    const insertOpt = db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const opt of quote.optionLines || []) {
      insertOpt.run(
        req.params.id,
        opt.optionId,
        opt.quantity || 1,
        Number(opt.unitPrice || 0),
        Number(opt.billedUnits || 0),
        opt.priceType || 'per_stay',
        opt.totalPrice || 0,
      );
    }
  }

  db.prepare('DELETE FROM reservation_nights WHERE reservationId = ?').run(req.params.id);
  if (quote.nightlyBreakdown && quote.nightlyBreakdown.length > 0) {
    const insertNight = db.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, ?)');
    for (const night of quote.nightlyBreakdown) {
      insertNight.run(
        req.params.id,
        night.date,
        night.seasonLabel || 'Standard',
        night.pricingMode || 'fixed',
        Number(night.price || 0),
      );
    }
  }

  // Rebuild reservation resources with availability check
  if (reservationResources) {
    db.prepare('DELETE FROM reservation_resources WHERE reservationId = ?').run(req.params.id);
    const insertRes = db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const rr of quote.resourceLines || []) {
      const resource = db.prepare('SELECT * FROM resources WHERE id = ?').get(rr.resourceId);
      if (!resource) return res.status(400).json({ error: `Ressource introuvable (id=${rr.resourceId})` });
      const reserved = db.prepare(`
        SELECT COALESCE(SUM(rr2.quantity), 0) as reserved
        FROM reservation_resources rr2
        JOIN reservations r2 ON r2.id = rr2.reservationId
        WHERE rr2.resourceId = ? AND r2.startDate < ? AND r2.endDate > ? AND rr2.reservationId != ?
      `).get(rr.resourceId, endDate, startDate, req.params.id).reserved || 0;
      const available = Number(resource.quantity) - Number(reserved);
      if (Number(rr.quantity || 0) > available) {
        return res.status(409).json({ error: `Ressource '${resource.name}' indisponible: ${available} restant(s) pour cette période.` });
      }
      const unitPrice = rr.unitPrice !== undefined ? Number(rr.unitPrice) : Number(resource.price || 0);
      const qty = Number(rr.quantity) || 1;
      insertRes.run(
        req.params.id,
        rr.resourceId,
        qty,
        unitPrice,
        Number(rr.billedUnits || qty),
        rr.priceType || resource.priceType || 'per_stay',
        rr.totalPrice || unitPrice * qty,
      );
    }
  }

  const afterAuditSnapshot = getReservationAuditSnapshotFromPayload(req.body, quote);
  const changes = computeAuditChanges(beforeAuditSnapshot, afterAuditSnapshot);
  if (existingReservation && String(existingReservation.sourceType || '') === 'ical' && Number(existingReservation.icalSyncLocked || 0) !== 1 && nextIcalSyncLocked === 1) {
    changes.push({
      field: 'icalSyncLocked',
      label: 'Synchronisation iCal',
      from: 'Active',
      to: 'Verrouillée après modification manuelle',
    });
  }
  if (changes.length > 0) {
    addReservationHistoryEntry(Number(req.params.id), 'update', changes);
  }

  res.json({ ok: true });
});

// Mark deposit/balance/caution as paid, or update check-in/out status
router.patch('/:id/payment', (req, res) => {
  const archivedError = getArchivedReservationError(Number(req.params.id));
  if (archivedError) {
    return res.status(archivedError.status).json(archivedError.body);
  }

  const { depositPaid, balancePaid, cautionReceived, cautionReceivedDate, cautionReturned, cautionReturnedDate,
    checkInReady, checkInDone, checkOutDone } = req.body;
  if (depositPaid !== undefined) {
    db.prepare('UPDATE reservations SET depositPaid = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(depositPaid ? 1 : 0, req.params.id);
  }
  if (balancePaid !== undefined) {
    db.prepare('UPDATE reservations SET balancePaid = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(balancePaid ? 1 : 0, req.params.id);
  }
  if (cautionReceived !== undefined) {
    const date = cautionReceivedDate || (cautionReceived ? new Date().toISOString().split('T')[0] : null);
    db.prepare('UPDATE reservations SET cautionReceived = ?, cautionReceivedDate = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(cautionReceived ? 1 : 0, date, req.params.id);
  }
  if (cautionReturned !== undefined) {
    const date = cautionReturnedDate || (cautionReturned ? new Date().toISOString().split('T')[0] : null);
    db.prepare('UPDATE reservations SET cautionReturned = ?, cautionReturnedDate = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(cautionReturned ? 1 : 0, date, req.params.id);
  }
  if (checkInReady !== undefined) {
    db.prepare('UPDATE reservations SET checkInReady = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(checkInReady ? 1 : 0, req.params.id);
  }
  if (checkInDone !== undefined) {
    db.prepare('UPDATE reservations SET checkInDone = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(checkInDone ? 1 : 0, req.params.id);
  }
  if (checkOutDone !== undefined) {
    db.prepare('UPDATE reservations SET checkOutDone = ?, updatedAt = datetime(\'now\') WHERE id = ?').run(checkOutDone ? 1 : 0, req.params.id);
  }
  res.json({ ok: true });
});

// Delete reservation
router.delete('/:id', (req, res) => {
  const archivedError = getArchivedReservationError(Number(req.params.id));
  if (archivedError) {
    return res.status(archivedError.status).json(archivedError.body);
  }

  db.prepare('DELETE FROM reservations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.__test = {
  computeNextIcalSyncLocked,
};
