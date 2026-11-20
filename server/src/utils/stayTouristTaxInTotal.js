// The tourist tax that sits INSIDE a stay's « total de séjour » (specs/stay-profile.md rule 22, D-HC9:
// the tax is never revenue). Pure.
//
// The total counts every bucket the operator keeps on the books (financeModel.totalSejour): acompte,
// solde, the two complements, the installments, net of commissions, each bucket left in the caisse
// interne excluded, net of book refunds. The tax is placed bucket by bucket as the accounting export
// books it (accounting-export `computeTaxTtcForKind`, specs/tourist-tax-on-solde.md,
// specs/accounting-books-the-money-collected.md rule 13, specs/platform-added-guests-tourist-tax.md
// rule 13): never on the acompte; on the solde (frozen in its contribs once paid) unless it is
// collected at arrival, then on the arrival complement; an installment plan carries it, the added
// guests' share riding the complement. A commission is taken on the stay, never on the tax, so a
// netted bucket still holds its whole tax; a bucket collected in the caisse interne holds none of the
// total's money, so none of its tax.

const nz = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const { roundMoneyStrict: round2 } = require('./pricing/money');

/**
 * @param {object} r   reservation row (touristTaxTotal, touristTaxAddedGuestsAmount, the tax contribs,
 *                     balancePaid, balancePaidCash, complementPaidCash)
 * @param {{ taxOnArrival?: boolean, hasPlan?: boolean, refundedTax?: number }} facts
 *   taxOnArrival — the tax is collected at arrival (forced to the complement, or the platform's mode);
 *   hasPlan — the stay is paid through an installment plan; refundedTax — tax given back by book refunds.
 * @returns {number} euros, never negative
 */
function touristTaxInTotal(r, { taxOnArrival = false, hasPlan = false, refundedTax = 0 } = {}) {
  const total = Math.max(0, round2(nz(r.touristTaxTotal)));
  if (total === 0) return 0;
  const added = Math.min(total, Math.max(0, round2(nz(r.touristTaxAddedGuestsAmount))));
  const inDeposit = nz(r.touristTaxAcompteContribTtc);
  const inBalance = nz(r.touristTaxSoldeContribTtc);
  let preArrival = 0;
  let complement = 0;
  let preArrivalCash = false;
  if (hasPlan) {
    preArrival = total - added;
    complement = added;
  } else if (taxOnArrival) {
    complement = Math.max(0, total - inDeposit - inBalance);
  } else {
    const frozen = nz(r.balancePaid) === 1 && r.touristTaxSoldeContribTtc != null ? round2(inDeposit + inBalance) : null;
    preArrival = frozen != null ? Math.min(frozen, total) : total - added;
    complement = frozen != null ? Math.max(0, total - frozen) : added;
    preArrivalCash = nz(r.balancePaidCash) === 1;
  }
  const kept = (preArrivalCash ? 0 : preArrival) + (nz(r.complementPaidCash) === 1 ? 0 : complement);
  return Math.max(0, round2(kept - Math.max(0, nz(refundedTax))));
}

module.exports = { touristTaxInTotal };
