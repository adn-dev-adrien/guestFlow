/**
 * Rebuild the pricing-engine input of a STORED reservation.
 *
 * The one way to re-price a booking exactly as its fiche does: the persisted guests, dates, options,
 * custom options, resources and locked snapshots, in the shape `calculateReservationQuote` expects.
 * Whoever needs the numbers of a saved stay — the per-bucket contrib capture at a payment flip, the
 * « Suivi taxe de séjour » declaration — replays this rather than re-deriving prices from SQL, so a
 * stay can never carry two different amounts in two different screens.
 *
 * Pure read: it touches no state and decides nothing. The caller adds whatever the engine needs on
 * top (e.g. the tourist-tax freeze of a past stay).
 */

function buildReservationEngineInput(db, reservation) {
  const optionRows = db.prepare(`
    SELECT optionId, quantity, COALESCE(inComplement, 0) as inComplement, COALESCE(offered, 0) as offered
    FROM reservation_options WHERE reservationId = ?
  `).all(reservation.id);

  const customOptionRows = db.prepare(`
    SELECT id as customOptionId, description, amount, COALESCE(offered, 0) as offered,
      COALESCE(inComplement, 0) as inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id
  `).all(reservation.id);

  const resourceRows = db.prepare(`
    SELECT resourceId, quantity, COALESCE(offered, 0) as offered, COALESCE(inComplement, 0) as inComplement
    FROM reservation_resources WHERE reservationId = ?
  `).all(reservation.id);

  const offeredOptionIds = optionRows.filter((r) => Number(r.offered) === 1).map((r) => Number(r.optionId));

  // Locked snapshots so the engine reproduces the persisted line prices (no drift from a
  // refreshed unit price in `options` / `resources` between save and payment).
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
    })),
    depositPaid: reservation.depositPaid,
    balancePaid: reservation.balancePaid,
    complementPaid: reservation.complementPaid,
    depositAmount: reservation.depositAmount,
    balanceAmount: reservation.balanceAmount,
    complementAmount: reservation.complementAmount,
    offeredOptionIds,
    extraGuestSurchargeOffered: reservation.extraGuestSurchargeOffered,
    lockedNightlyBreakdown,
    lockedOptionLines,
    lockedResourceLines,
    platform: reservation.platform,
    touristTaxInComplement: reservation.touristTaxInComplement,
  };
}

module.exports = { buildReservationEngineInput };
