/**
 * The arrival recap payload (specs/sas-arrival-total-server-side.md §4.3) — what the dialog renders,
 * shaped from a plan of `reservationsModel.planArrivalSas`. Pure: every input is handed in.
 *
 *   plan         — the plan (lines, totals, sales)
 *   stayPayment  — `buildStayPayment()` of the controller ({ applicable, total }), on the acompte and solde the plan leaves (rule 117)
 *   arrivalPayment — `buildArrivalPayment()` ({ complementOpen })
 *   saleOffers   — `sasSales` of the SAS payload, to file each sold line under its step
 *   nothingToCollect — the server's « Rien à percevoir » answer for the stored buckets
 *   credits      — the sale detail's rule-104 credits (`saleDetail.credits`): the arrival's is listed as a read-only line
 */

const sdk = require('../sdk');

const { round2, isUnifiable } = sdk.coreModule('arrivalSasPlan');

// One sold line as the dialog renders it (specs/breakfast-offer-price-server-side.md rule 5): the
// moments, the covers each serves, the billed quantity, the unit price and the amount — all priced
// by the plan. Nothing sold: no covers either — the draft carries none to answer for.
function saleEntry(offer, line) {
  const perPerson = Boolean(offer.perPerson);
  if (!line) {
    return {
      optionId: Number(offer.optionId), moments: 0, servedPersons: null, units: 0, unitPrice: round2(offer.unitPrice), amount: 0,
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

// Pricing-components rule 104 (loop t5 S5-3) — the money paid on a line since lowered, which the arrival complement takes: a read-only line of
// its own (« Déjà réglé : … », negative), so the lines the reception reads sum to the complement it collects. `credits` = the sale detail's.
const creditLine = (credit) => ({
  key: null, group: 'existing', kind: 'credit', label: credit.label, qty: 1, unitPrice: round2(credit.totalCents / 100),
  real: round2(credit.totalCents / 100), billed: round2(credit.totalCents / 100), offerable: false, offered: false,
});

// Loop t6 (unverified note of the round-6 review) — the credit is the STORED stay's, the plan may be a draft's: a draft that offers the line the
// credit sat on asks less than its listed lines by less than the credit (or not at all). The recap lists only the part of the credit that explains
// why this plan's complement is below its listed lines, so the lines always sum to the complement asked.
function arrivalCredits(plan, credits) {
  const listed = round2((plan.lines || []).reduce((sum, line) => sum + (Number(line.billed) || 0), 0));
  let left = round2(listed - round2(plan.arrivalComplementTotal));
  const shown = [];
  for (const credit of (credits || []).filter((entry) => entry.bucket === 'arrival')) {
    const cents = Math.min(-Number(credit.totalCents || 0), Math.round(left * 100));
    if (cents <= 0) break;
    shown.push({ ...credit, totalCents: -cents });
    left = round2(left - cents / 100);
  }
  return shown;
}

function shapeArrivalRecap(plan, {
  stayPayment = {}, arrivalPayment = {}, saleOffers = null, nothingToCollect = false, credits = [],
} = {}) {
  const stayDue = stayPayment.applicable ? round2(stayPayment.total) : 0;
  const arrivalComplementTotal = round2(plan.arrivalComplementTotal);
  return {
    lines: [
      ...plan.lines.map(({ optionId, moments, servedPersons, ...line }) => line),
      ...arrivalCredits(plan, credits).map(creditLine),
    ],
    existingTotal: round2(plan.existingTotal),
    addedTotal: round2(plan.addedTotal),
    arrivalComplementTotal,
    stayDue,
    // Pricing-components rule 117 (loop t8 S8-1) — the « Séjour à régler » block of THIS plan: the stay page renders it once a preview answered.
    stayPayment,
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
