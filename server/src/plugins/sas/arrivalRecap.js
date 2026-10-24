/**
 * The arrival recap payload (specs/sas-arrival-total-server-side.md §4.3) — what the dialog renders,
 * shaped from a plan of `reservationsModel.planArrivalSas`. Pure: every input is handed in.
 *
 *   plan         — the plan (lines, totals, sales)
 *   stayPayment  — `buildStayPayment()` of the controller ({ applicable, total })
 *   arrivalPayment — `buildArrivalPayment()` ({ complementOpen })
 *   saleOffers   — `sasSales` of the SAS payload, to file each sold line under its step
 *   nothingToCollect — the server's « Rien à percevoir » answer for the stored buckets
 */

const sdk = require('../sdk');

const { round2, isUnifiable } = sdk.coreModule('arrivalSasPlan');

// One sold line as the dialog renders it (specs/breakfast-offer-price-server-side.md rule 5): the
// moments, the covers each serves, the billed quantity, the unit price and the amount — all priced
// by the plan. A line sold by a previous run (no intent in the draft) falls back on the offer.
function saleEntry(offer, line) {
  const perPerson = Boolean(offer.perPerson);
  if (!line) {
    return {
      optionId: Number(offer.optionId), moments: 0, servedPersons: perPerson ? Number(offer.selectedPersons) || null : null,
      units: 0, unitPrice: round2(offer.unitPrice), amount: 0,
    };
  }
  return {
    optionId: Number(offer.optionId),
    moments: line.moments != null ? line.moments : (offer.selected || []).length || null,
    servedPersons: line.servedPersons != null ? line.servedPersons : (perPerson ? Number(offer.selectedPersons) || null : null),
    units: Number(line.qty) || 0,
    unitPrice: round2(line.unitPrice),
    amount: round2(line.real),
  };
}

function salesBlock(plan, saleOffers) {
  const sold = new Map((plan.lines || [])
    .filter((l) => l.optionId != null)
    .map((l) => [Number(l.optionId), l]));
  const breakfastOffer = saleOffers && saleOffers.breakfast && saleOffers.breakfast.available ? saleOffers.breakfast : null;
  const cateringOptions = (saleOffers && saleOffers.catering && saleOffers.catering.options) || [];
  const catering = cateringOptions.map((o) => saleEntry(o, sold.get(Number(o.optionId))));
  return {
    breakfast: breakfastOffer ? saleEntry(breakfastOffer, sold.get(Number(breakfastOffer.optionId))) : null,
    catering: { options: catering, amount: round2(catering.reduce((s, o) => s + o.amount, 0)) },
  };
}

function shapeArrivalRecap(plan, {
  stayPayment = {}, arrivalPayment = {}, saleOffers = null, nothingToCollect = false,
} = {}) {
  const stayDue = stayPayment.applicable ? round2(stayPayment.total) : 0;
  const arrivalComplementTotal = round2(plan.arrivalComplementTotal);
  return {
    lines: plan.lines.map(({ optionId, moments, servedPersons, ...line }) => line),
    existingTotal: round2(plan.existingTotal),
    addedTotal: round2(plan.addedTotal),
    arrivalComplementTotal,
    stayDue,
    totalAtArrival: round2(stayDue + arrivalComplementTotal),
    unifiable: isUnifiable({
      complementOpen: arrivalPayment.complementOpen,
      stayApplicable: stayPayment.applicable,
      arrivalComplementTotal,
    }),
    complementOpen: Boolean(arrivalPayment.complementOpen),
    nothingToCollect: Boolean(nothingToCollect),
    supplementOutsideComplement: round2(plan.supplementOutsideComplement),
    adjusted: plan.adjusted,
    sales: salesBlock(plan, saleOffers),
  };
}

module.exports = { shapeArrivalRecap };
