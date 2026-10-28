/**
 * The pricing summary of a STORED reservation, shaped like the live quote so the fiche renders it with
 * the very component that renders the quote (specs/reservation-payment-ledger.md rules 44-45, 50-52).
 *
 * Every amount and date is the one saved on the fiche; the lines (options, custom options, resources)
 * are the saved rows, with the flags the summary needs to word them. What a fresh engine run would add
 * is left out on purpose: nothing from today's calculation is printed next to a stored total.
 *
 * Pure but for the reads it is handed (`db`, the settings VAT rate): the controller owns the caller.
 */

const { summaryCascade } = require('./quoteHeadline');
const { isPlatformCollectingTouristTax, isTouristTaxRemittedByOwner } = require('./pricing');
const { saleChannel } = require('./saleChannel');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const flag = (v) => Number(v || 0) === 1;

function safeAll(db, sql, ...params) {
  try { return db.prepare(sql).all(...params); } catch { return []; }
}

// An offered line is saved at 0: its real price is what the unit price and the billed units make. A line
// that is NOT offered is exactly what was saved, a free one (0 €) included.
function realPrice(line, offered) {
  if (!offered || Number(line.totalPrice) > 0) return round2(line.totalPrice);
  return round2(Number(line.unitPrice || 0) * Number(line.billedUnits || 0));
}

function storedOptionLines(db, row) {
  const defaultOffered = new Set(
    safeAll(db, 'SELECT optionId FROM property_option_defaults WHERE propertyId = ? AND offered = 1', row.propertyId)
      .map((r) => Number(r.optionId)),
  );
  const options = safeAll(db, `
    SELECT ro.optionId, o.title, ro.quantity, ro.unitPrice, ro.billedUnits, ro.priceType, ro.totalPrice,
           ro.offered, ro.inComplement, ro.acompteContribTtc, ro.soldeContribTtc
      FROM reservation_options ro LEFT JOIN options o ON o.id = ro.optionId
     WHERE ro.reservationId = ? ORDER BY o.title COLLATE NOCASE`, row.id).map((r) => {
    const offered = flag(r.offered);
    const real = realPrice(r, offered);
    return {
      optionId: Number(r.optionId),
      title: r.title || '',
      quantity: Number(r.quantity || 1),
      unitPrice: Number(r.unitPrice || 0),
      billedUnits: Number(r.billedUnits || 0),
      priceType: r.priceType,
      originalTotalPrice: real,
      totalPrice: offered ? 0 : real,
      offered,
      includedInRate: offered && defaultOffered.has(Number(r.optionId)),
      inComplement: flag(r.inComplement) ? 1 : 0,
      acompteContribTtc: r.acompteContribTtc,
      soldeContribTtc: r.soldeContribTtc,
    };
  });
  const customs = safeAll(db, `
    SELECT id, description, amount, offered, inComplement, acompteContribTtc, soldeContribTtc
      FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id`, row.id).map((r) => {
    const offered = flag(r.offered);
    return {
      isCustom: true,
      customOptionId: Number(r.id),
      customKey: `custom_${r.id}`,
      title: r.description,
      quantity: 1,
      unitPrice: round2(r.amount),
      billedUnits: 1,
      priceType: 'per_stay',
      originalTotalPrice: round2(r.amount),
      totalPrice: offered ? 0 : round2(r.amount),
      offered,
      inComplement: flag(r.inComplement) ? 1 : 0,
      acompteContribTtc: r.acompteContribTtc,
      soldeContribTtc: r.soldeContribTtc,
    };
  });
  return [...options, ...customs];
}

function storedResourceLines(db, row) {
  return safeAll(db, `
    SELECT rr.resourceId, r.name, rr.quantity, rr.unitPrice, rr.billedUnits, rr.priceType, rr.totalPrice,
           rr.offered, rr.inComplement, rr.acompteContribTtc, rr.soldeContribTtc
      FROM reservation_resources rr LEFT JOIN resources r ON r.id = rr.resourceId
     WHERE rr.reservationId = ? ORDER BY r.name COLLATE NOCASE`, row.id).map((r) => {
    const offered = flag(r.offered);
    const real = realPrice(r, offered);
    return {
      resourceId: Number(r.resourceId),
      name: r.name || '',
      quantity: Number(r.quantity || 1),
      unitPrice: Number(r.unitPrice || 0),
      billedUnits: Number(r.billedUnits || 0),
      priceType: r.priceType,
      originalTotalPrice: real,
      totalPrice: offered ? 0 : real,
      offered,
      inComplement: flag(r.inComplement) ? 1 : 0,
      acompteContribTtc: r.acompteContribTtc,
      soldeContribTtc: r.soldeContribTtc,
    };
  });
}

/**
 * The saved nights, or `[]` when they no longer add up to the saved price of the nights (`totalPrice`, as the
 * live card compares them): « Détail » is then not offered.
 */
function storedNightlyBreakdown(db, row, nightsTotal) {
  const nights = safeAll(db, `
    SELECT date, seasonLabel, pricingMode, price FROM reservation_nights WHERE reservationId = ? ORDER BY date`, row.id)
    .map((n, index) => ({
      date: n.date, nightNumber: index + 1, pricingMode: n.pricingMode, seasonLabel: n.seasonLabel, price: round2(n.price),
    }));
  const sum = round2(nights.reduce((total, n) => total + n.price, 0));
  return nights.length > 0 && Math.abs(sum - nightsTotal) <= 0.01 ? nights : [];
}

function nightsBetween(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000));
}

/**
 * @param {object} p
 * @param {object} p.row         the stored reservation row
 * @param {object} p.db
 * @param {{rate: number}} p.vatRegime   the VAT regime in force for the stay (`vatRegimeModel.forRow`)
 * @param {object} p.headline    `storedHeadlineOf(row)`
 * @param {number} p.refundsTotal   book refunds of the stay
 * @param {number} p.midStayRemaining  what the mid-stay notes still ask at check-out
 */
function buildStoredSummary({ row, db, vatRegime, headline, refundsTotal = 0, midStayRemaining = 0 }) {
  const channel = saleChannel(row.platform);
  const isPlatform = channel.namedChannel;
  const acompteCommission = isPlatform ? round2(row.acompteCommissionAmount) : 0;
  const soldeCommission = isPlatform ? round2(row.platformCommissionAmount) : 0;
  const totalCommission = round2(acompteCommission + soldeCommission);
  // With an installment plan the pre-arrival money is the plan's, not the (zeroed) acompte and solde.
  const preArrival = round2(Number(row.depositAmount || 0) + Number(row.balanceAmount || 0)
    + Number(row.installmentsPaidAmount || 0) + Number(row.installmentsUnpaidAmount || 0));
  const tax = round2(row.touristTaxTotal);

  const optionLines = storedOptionLines(db, row);
  const resourceLines = storedResourceLines(db, row);
  const optionsTotal = round2(optionLines.reduce((total, l) => total + l.totalPrice, 0));
  const resourcesTotal = round2(resourceLines.reduce((total, l) => total + l.totalPrice, 0));
  const accommodation = round2(Math.max(0, Number(row.finalPrice || 0) - optionsTotal - resourcesTotal));
  const vatRate = vatRegime.rate;
  const vatOf = (ttc) => round2(ttc * (vatRate / (100 + vatRate)));
  const totalVatAmount = round2(vatOf(accommodation) + vatOf(optionsTotal) + vatOf(resourcesTotal));

  // Who collects the tourist tax — the platform's own settings, the same three cases as the engine.
  const platformKey = String(row.platform || 'direct').trim().toLowerCase();
  const collects = isPlatformCollectingTouristTax(db, row.propertyId, platformKey);
  const remittedByOwner = isTouristTaxRemittedByOwner(db, row.propertyId, platformKey);
  const withheld = row.platformTouristTaxAmount == null || row.platformTouristTaxAmount === ''
    ? null : round2(row.platformTouristTaxAmount);
  // A tax the operator stated as withheld by the platform is the platform's, whatever the platform's mode
  // says today: the card prints it struck with its « Plateforme » tag and the cascade deducts it, so the
  // lines add up to the same « Total du séjour » as the sticky bar.
  const touristTaxOfferedByPlatform = (collects && !remittedByOwner) || withheld != null;

  const deferred = flag(row.complementDeferredToCheckout);
  const endOfStay = round2(row.endOfStayComplementAmount);
  const complement = round2(row.complementAmount);
  const complementSplit = {
    arrival: deferred ? 0 : complement,
    duringStay: 0,
    endOfStay: round2(endOfStay + (deferred ? complement : 0)),
  };

  const summary = {
    nights: nightsBetween(row.startDate, row.endDate),
    nightlyBreakdown: storedNightlyBreakdown(db, row, row.totalPrice == null ? accommodation : round2(row.totalPrice)),
    optionLines,
    resourceLines,
    accommodation,
    accommodationBase: row.totalPrice == null ? null : round2(row.totalPrice),
    optionsTotal,
    resourcesTotal,
    discountAmount: 0,
    vatRate,
    vatRegime,
    vatPercentageAccommodation: vatRate,
    totalVatAmount,
    totalNetPrice: round2(Number(row.finalPrice || 0) - totalVatAmount),
    depositDueDate: row.depositDueDate || null,
    balanceDueDate: row.balanceDueDate || null,
    finalPrice: round2(row.finalPrice),
    touristTaxTotal: tax,
    touristTaxOriginalTotal: tax,
    touristTaxInComplement: flag(row.touristTaxInComplement),
    touristTaxOfferedByPlatform,
    touristTaxCollectedOnArrival: !collects && isPlatform && tax > 0,
    touristTaxReversedByPlatform: !touristTaxOfferedByPlatform && collects && remittedByOwner && tax > 0,
    platformTouristTaxWithheld: withheld,
    platformSale: channel.platformSale,
    depositAmount: round2(row.depositAmount),
    balanceAmount: round2(row.balanceAmount),
    complementAmount: complement,
    endOfStayComplementTotal: endOfStay,
    midStaySettledTotal: 0,
    midStayRemainingTotal: round2(midStayRemaining),
    complementSplit,
    refundsTotal: round2(refundsTotal),
    preArrivalAmount: preArrival,
    totalStayPrice: round2(Number(row.finalPrice || 0) + tax),
    sejourNetTotal: headline ? (headline.label === 'Vous percevez' ? headline.amount : (headline.secondary ? headline.secondary.amount : headline.amount)) : null,
    acompteCommissionAmount: acompteCommission,
    platformCommissionAmount: soldeCommission,
    totalPlatformCommission: totalCommission,
    platformNetReceivedAmount: totalCommission > 0 ? round2(preArrival - totalCommission) : null,
    headline,
  };
  summary.summaryCascade = summaryCascade(summary);
  return summary;
}

module.exports = { buildStoredSummary };
