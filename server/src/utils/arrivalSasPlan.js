/**
 * The arithmetic of the arrival SAS plan (specs/sas-arrival-total-server-side.md §3.1).
 *
 * Pure functions on plain values, shared by the preview and the commit through
 * `reservationsModel.planArrivalSas`: the SAS-origin rows a commit leaves behind, and the arrival
 * complement it stores. Nothing here reads or writes the database.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * What one catalogue upsell (ménage, linge de toilette) contributes to the SAS-origin option sum
 * once the commit ran — the mirror of the commit's `applyUpsell`.
 *
 *   offer   — `getSasUpsellOptions()` entry ({ optionId, totalPrice, present, sasOrigin })
 *   stored  — the SAS-origin row as stored ({ totalPrice }) or null
 *   wanted  — tri-state: undefined = step not shown → the row is left as it is
 *   offered — « Offrir » → the row is kept at 0 €
 *
 * Returns `{ action: 'keep' | 'write' | 'delete' | 'none', total, real, offered }`.
 */
function upsellOutcome({ offer, stored, wanted, offered }) {
  const keep = () => (stored
    ? { action: 'keep', total: round2(stored.totalPrice), real: round2(offer && offer.totalPrice), offered: Number(stored.offered || 0) === 1 }
    : { action: 'none', total: 0, real: 0, offered: false });
  if (wanted === undefined || !offer || !offer.optionId) return keep();
  if (offer.present && !offer.sasOrigin) return { action: 'none', total: 0, real: 0, offered: false };
  if (wanted) {
    if (!(Number(offer.totalPrice) > 0)) return keep();
    return {
      action: 'write', total: offered ? 0 : round2(offer.totalPrice), real: round2(offer.totalPrice), offered: Boolean(offered),
    };
  }
  return offer.sasOrigin ? { action: 'delete', total: 0, real: 0, offered: false } : { action: 'none', total: 0, real: 0, offered: false };
}

/**
 * The arrival complement a commit stores (reservationsModel.js, the « REPLACE the SAS-origin lines »
 * block, then `reapplyComplementOverride`).
 *
 *   stored     — `complementAmount` before the run
 *   offerDelta — how the « Offrir » decisions on the pre-existing lines move it (negative = offered)
 *   override   — `complementAmountOverride`, or null
 *   priorSum   — what the previous run of this SAS had put in (SAS-origin rows, offered at 0)
 *   added      — what this run puts in (custom items not offered + SAS-origin option rows)
 */
function arrivalComplementAfter({ stored, offerDelta, override, priorSum, added }) {
  const overridden = override != null;
  const target = overridden ? Math.max(0, round2(override)) : null;
  const afterOffers = offerDelta === 0
    ? round2(stored)
    : (overridden ? target : Math.max(0, round2(Number(stored || 0) + offerDelta)));
  const engineAfter = Math.max(0, round2(afterOffers - priorSum + added));
  return {
    afterOffers,
    existingTotal: Math.max(0, round2(afterOffers - priorSum)),
    engineAfter,
    stored: overridden ? target : engineAfter,
  };
}

/**
 * specs/single-payment-at-check-in.md §3.1 rule 1, decided on the planned total
 * (specs/sas-arrival-total-server-side.md rule 9).
 */
function isUnifiable({ complementOpen, stayApplicable, arrivalComplementTotal }) {
  return Boolean(complementOpen) && Boolean(stayApplicable) && Number(arrivalComplementTotal) > 0;
}

/** Rule 22 — a difference of a cent or more between what the recap showed and what was stored. */
function totalDiffered(displayed, stored) {
  if (displayed === undefined || displayed === null || displayed === '') return false;
  const shown = Number(displayed);
  if (!Number.isFinite(shown)) return false;
  return Math.abs(round2(shown) - round2(stored)) >= 0.01;
}

module.exports = {
  round2, upsellOutcome, arrivalComplementAfter, isUnifiable, totalDiffered,
};
