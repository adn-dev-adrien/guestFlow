/**
 * Rebuild the pricing-engine input of a STORED reservation.
 *
 * The one way to re-price a booking exactly as its fiche does: the persisted guests, dates, options,
 * custom options, resources and locked snapshots, in the shape `calculateReservationQuote` expects.
 * Whoever needs the numbers of a saved stay — the per-bucket contrib capture at a payment flip, the
 * « Suivi taxe de séjour » declaration — replays this rather than re-deriving prices from SQL, so a
 * stay can never carry two different amounts in two different screens.
 *
 * « Exactly as its fiche does » is literal: the stay fields come from the stored row, the locked
 * snapshot (nights, lines, tariff) from the same reader the save uses, and the server-side context
 * (booking date, tourist-tax freeze) from the same helpers (`reservationQuoteContext`); what needs the
 * application's own models (platform settings, mid-stay state) is added by `quoteStoredReservation`. Audit 2026-10-28: a replay that left half of it out priced 22 of 57 stays
 * away from their fiche, and the installment plans, restamped buckets and tax declaration built on it
 * followed.
 *
 * Pure read: it touches no state and decides nothing.
 */
const { scheduleQuoteInputs, frozenTouristTaxInputs } = require('./reservationQuoteContext');

// The two card-option columns, kept out of the SELECT on a schema that predates them.
function cardColumns(db) {
  const present = new Set(db.prepare('PRAGMA table_info(reservation_options)').all().map((c) => c.name));
  return ['cardOccurrences', 'cardPersons'].filter((name) => present.has(name));
}

function buildReservationEngineInput(db, reservation, { refreshTouristTax = false } = {}) {
  // `cardOccurrences` + `cardPersons` ride with the rest (specs/unscheduled-card-option.md rule 10).
  // Without them every planning-card line vanished from this replay — scheduled or not — because the
  // engine rebuilds such a line from its moments. Measured on production before the fix: 635 € of
  // option lines missing across 13 bookings, and a tourist-tax declaration 9,74 € above what the
  // fiches themselves say, the taxable base growing as the services dropped out of it.
  // Selected by name only when present, like every other reader of these two columns
  // (`bookingLinesModel`): a minimal test schema predates them.
  const optionColumns = [
    'optionId', 'quantity',
    ...cardColumns(db),
    'COALESCE(inComplement, 0) as inComplement', 'COALESCE(offered, 0) as offered',
  ];
  const optionRows = db.prepare(`
    SELECT ${optionColumns.join(', ')} FROM reservation_options WHERE reservationId = ?
  `).all(reservation.id);

  const customOptionRows = db.prepare(`
    SELECT id as customOptionId, description, amount, COALESCE(offered, 0) as offered,
      COALESCE(inComplement, 0) as inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id
  `).all(reservation.id);

  // specs/plugins-phase-3c-hourly-resources.md rule 5 — the sessions ride along, so a replay keeps the
  // hours placed (`scheduledHours`); the amount is the locked snapshot's either way.
  const hasSessions = db.prepare('PRAGMA table_info(reservation_resources)').all().some((c) => c.name === 'sessions');
  const resourceRows = db.prepare(`
    SELECT resourceId, quantity, COALESCE(offered, 0) as offered, COALESCE(inComplement, 0) as inComplement,
      ${hasSessions ? 'sessions' : 'NULL AS sessions'}
    FROM reservation_resources WHERE reservationId = ?
  `).all(reservation.id);
  const parseSessions = (raw) => {
    try { const parsed = JSON.parse(raw || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  };

  const offeredOptionIds = optionRows.filter((r) => Number(r.offered) === 1).map((r) => Number(r.optionId));

  // Locked snapshots so the engine reproduces the persisted line prices and the tariff the stay was
  // sold under (no drift from a refreshed unit price or tariff between save and payment).
  const lockedOptionLines = db.prepare(`
    SELECT optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
      COALESCE(inComplement, 0) as inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_options WHERE reservationId = ?
  `).all(reservation.id);
  const lockedResourceLines = db.prepare(`
    SELECT resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered,
      COALESCE(inComplement, 0) as inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_resources WHERE reservationId = ?
  `).all(reservation.id);
  const lockedNightlyBreakdown = db.prepare(`
    SELECT date, seasonLabel, pricingMode, price
    FROM reservation_nights WHERE reservationId = ? ORDER BY date
  `).all(reservation.id);
  // A row listed with a handful of columns does not carry the snapshot: read it, as the save does.
  let lockedTariff = null;
  try {
    const raw = reservation.tariffSnapshot !== undefined
      ? reservation.tariffSnapshot
      : (db.prepare('SELECT tariffSnapshot FROM reservations WHERE id = ?').get(reservation.id) || {}).tariffSnapshot;
    lockedTariff = raw ? JSON.parse(raw) : null;
  } catch { lockedTariff = null; }
  const depositDisabled = Number(reservation.depositDisabled || 0) === 1 ? 1 : 0;

  return {
    db,
    propertyId: reservation.propertyId,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    checkInTime: reservation.checkInTime,
    checkOutTime: reservation.checkOutTime,
    adults: reservation.adults,
    children: reservation.children,
    teens: reservation.teens,
    babies: reservation.babies,
    // specs/baby-bed-supplement.md — this quote must reprice IDENTICALLY to the fiche or the
    // conservation invariant below fails, so the cots and the booking id travel with the rest.
    babyBeds: reservation.babyBeds,
    bookingId: reservation.id,
    discountPercent: reservation.discountPercent,
    customPrice: reservation.customPrice,
    selectedOptions: optionRows.map((r) => ({
      optionId: r.optionId,
      quantity: r.quantity,
      inComplement: r.inComplement,
      // The engine parses the stored JSON itself (`normalizeCardOccurrences`); a NULL column means
      // « sold, not placed yet » and the line is then priced from its snapshot.
      cardOccurrences: r.cardOccurrences,
      cardPersons: r.cardPersons,
    })),
    customOptions: customOptionRows.map((r) => ({
      customOptionId: r.customOptionId,
      description: r.description,
      amount: r.amount,
      offered: r.offered,
      inComplement: r.inComplement,
      acompteContribTtc: r.acompteContribTtc,
      soldeContribTtc: r.soldeContribTtc,
    })),
    selectedResources: resourceRows.map((r) => ({
      resourceId: r.resourceId,
      quantity: r.quantity,
      offered: r.offered,
      inComplement: r.inComplement,
      sessions: parseSessions(r.sessions),
    })),
    // The save prices a stay without acompte as one whose acompte was never paid.
    depositPaid: depositDisabled ? false : reservation.depositPaid,
    balancePaid: reservation.balancePaid,
    complementPaid: reservation.complementPaid,
    depositAmount: reservation.depositAmount,
    balanceAmount: reservation.balanceAmount,
    complementAmount: reservation.complementAmount,
    depositDisabled,
    depositAmountOverride: reservation.depositAmountOverride,
    complementAmountOverride: reservation.complementAmountOverride,
    // Auto-options are derived by the engine, not sold lines: their routing travels in this parallel list,
    // which the fiche hydrates from the stored lines that already ride the complement.
    autoOptionsInComplement: lockedOptionLines.filter((l) => Number(l.inComplement) === 1).map((l) => Number(l.optionId)),
    offeredOptionIds,
    extraGuestSurchargeOffered: reservation.extraGuestSurchargeOffered,
    lockedNightlyBreakdown,
    lockedTariff,
    lockedOptionLines,
    lockedResourceLines,
    platform: reservation.platform,
    platformCommissionAmount: reservation.platformCommissionAmount,
    acompteCommissionAmount: reservation.acompteCommissionAmount,
    touristTaxInComplement: reservation.touristTaxInComplement,
    // specs/tourist-tax-matches-the-office-calculation.md rule 2 — the brut derives the tourist-tax
    // base again, so a replay that omitted it would price the stay on a different base than the
    // fiche and hand the « Suivi taxe de séjour » page a number the fiche never showed.
    platformGrossAmount: reservation.platformGrossAmount,
    // specs/platform-tourist-tax-out-of-the-commission.md rule 25 — the fiche reads the brut net of
    // this amount; a replay without it puts the withheld tax back in the solde, and the payment
    // capture then refuses to mark that solde paid.
    platformTouristTaxAmount: reservation.platformTouristTaxAmount,
    platformPaidGuests: reservation.platformPaidGuests,
    // The save of a stay left as it was sold pins a collected or declared tax (rule 17): so does its replay.
    ...frozenTouristTaxInputs(db, reservation.id, refreshTouristTax),
    ...scheduleQuoteInputs(db, reservation.id),
  };
}

module.exports = { buildReservationEngineInput };
