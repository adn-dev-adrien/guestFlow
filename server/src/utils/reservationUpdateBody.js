/**
 * Stored reservation → the PUT body the fiche sends on « Enregistrer » (specs/gites-de-france-mail-intake.md
 * §4.1). The PUT rewrites every column from its body, so a server caller that wants to change three fields
 * must send the other hundred as they are: this is that « as they are », mirroring the fiche's load
 * (`client/src/utils/bookingFormHydration.js`) and save (`ReservationPage.jsx` handleSaveReservation)
 * mappings. The paid flags are not in it: the update reads them from the stored row anyway.
 *
 * @param {object} reservation  `reservationsModel.getByIdWithDetails(id)`
 * @param {Set<number>} autoEnabledOptionIds  option ids the engine adds itself (`options.autoEnabled = 1`)
 */

const blankToNull = (value) => (value === '' || value === undefined ? null : value);

function toUpdateBody(reservation, autoEnabledOptionIds = new Set()) {
  const r = reservation;
  const lines = r.options || [];
  const catalogueLines = lines.filter((o) => !o.isCustom);
  const isAuto = (o) => autoEnabledOptionIds.has(Number(o.optionId));

  return {
    propertyId: r.propertyId,
    clientId: r.clientId,
    reservationNumber: '',
    startDate: r.startDate,
    endDate: r.endDate,
    adults: r.adults,
    children: r.children,
    teens: r.teens,
    babies: r.babies,
    singleBeds: r.singleBeds,
    doubleBeds: r.doubleBeds,
    babyBeds: r.babyBeds,
    breakfastTime: r.breakfastTime || null,
    checkInTime: r.checkInTime || '15:00',
    checkOutTime: r.checkOutTime || '10:00',
    platform: r.platform,
    touristTaxInComplement: r.touristTaxInComplement ? 1 : 0,
    autoOptionsInComplement: catalogueLines
      .filter((o) => isAuto(o) && Number(o.inComplement || 0) === 1)
      .map((o) => Number(o.optionId)),
    totalPrice: r.totalPrice,
    discountPercent: r.discountPercent,
    finalPrice: r.finalPrice,
    customPrice: r.customPrice,
    extraGuestSurchargeOffered: r.extraGuestSurchargeOffered,
    depositAmount: r.depositAmount,
    depositDueDate: r.depositDueDate,
    depositAmountOverride: blankToNull(r.depositAmountOverride),
    complementAmountOverride: blankToNull(r.complementAmountOverride),
    endOfStayComplementAmountOverride: blankToNull(r.endOfStayComplementAmountOverride),
    depositDisabled: Boolean(r.depositDisabled),
    balanceAmount: r.balanceAmount,
    balanceDueDate: r.balanceDueDate,
    complementAmount: r.complementAmount,
    platformCommissionAmount: blankToNull(r.platformCommissionAmount),
    acompteCommissionAmount: blankToNull(r.acompteCommissionAmount),
    platformGrossAmount: blankToNull(r.platformGrossAmount),
    platformPayoutAmount: blankToNull(r.platformPayoutAmount),
    platformTouristTaxAmount: blankToNull(r.platformTouristTaxAmount),
    cautionAmount: r.cautionAmount,
    cautionReceived: r.cautionReceived,
    cautionReceivedDate: r.cautionReceivedDate,
    cautionReturned: r.cautionReturned,
    cautionReturnedDate: r.cautionReturnedDate,
    notes: r.notes,
    offeredOptionIds: catalogueLines.filter((o) => Boolean(o.offered)).map((o) => o.optionId),
    options: catalogueLines.filter((o) => !isAuto(o)).map((o) => ({
      optionId: o.optionId,
      quantity: o.quantity,
      inComplement: Number(o.inComplement || 0) === 1 ? 1 : 0,
      ...(Array.isArray(o.cardOccurrences) && o.cardOccurrences.length ? { cardOccurrences: o.cardOccurrences } : {}),
      ...(o.cardPersons != null ? { cardPersons: Number(o.cardPersons) } : {}),
    })),
    customOptions: lines.filter((o) => o.isCustom).map((o, index) => ({
      customKey: String(o.customOptionId || `custom_${index + 1}`),
      customOptionId: o.customOptionId != null ? Number(o.customOptionId) : undefined,
      description: String(o.title || o.description || '').trim(),
      amount: Number(o.originalTotalPrice ?? o.totalPrice ?? 0),
      offered: Boolean(o.offered),
      inComplement: Number(o.inComplement || 0) === 1 ? 1 : 0,
    })),
    resources: (r.resources || []).map((rr) => ({
      resourceId: rr.resourceId,
      quantity: rr.quantity,
      unitPrice: rr.unitPrice,
      offered: Boolean(rr.offered),
      inComplement: Number(rr.inComplement || 0) === 1 ? 1 : 0,
      sessions: Array.isArray(rr.sessions) ? rr.sessions : [],
    })),
  };
}

module.exports = { toUpdateBody };
