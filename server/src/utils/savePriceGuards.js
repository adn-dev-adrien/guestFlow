/**
 * What a save of a started stay may do to its price, judged on the stored row and the engine's quote.
 *
 * - `unclaimedRise(stored, quote, { planClaim })` — the part of a rise of finalPrice + touristTaxTotal that no unpaid
 *   bucket (acompte, solde, arrival complement, end-of-stay complement, and the unpaid installments of a plan:
 *   `planClaim`, euros, what the save's rebalance adds to them) takes on; 0 when nothing rises
 *   (specs/mid-stay-extras-to-end-of-stay-complement.md rule 20, reading of 2026-11-06, audit R26 finding 1 and D21 review L3).
 * - `unlockedPriceRefusal(stored, quote)` — D21: an unlocked fiche keeps its final price and its tourist
 *   tax; the refusal `{ error, code }` or null (specs/settings-rationalization.md rule 35, D21).
 */
const { formatEuros } = require('./reservationLedger');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const flag = (v) => Number(v || 0) === 1;

const UNLOCKED_PRICE_CODE = 'UNLOCKED_PRICE_CHANGED';

function unclaimedRise(stored, quote, { planClaim = 0 } = {}) {
  const rise = round2(Number(quote.finalPrice || 0) + Number(quote.touristTaxTotal || 0)
    - Number(stored.finalPrice || 0) - Number(stored.touristTaxTotal || 0));
  if (rise <= 0) return 0;
  const open = [
    [!flag(stored.depositPaid) && !flag(stored.depositPaidCash), quote.depositAmount, stored.depositAmount],
    [!flag(stored.balancePaid) && !flag(stored.balancePaidCash), quote.balanceAmount, stored.balanceAmount],
    [!flag(stored.complementPaid) && !flag(stored.complementPaidCash), quote.complementAmount, stored.complementAmount],
    [!flag(stored.endOfStayComplementPaid) && !flag(stored.endOfStayComplementPaidCash),
      quote.endOfStayComplementTotal, stored.endOfStayComplementAmount],
  ];
  const claimed = open.reduce((sum, [unpaid, next, before]) => (unpaid ? sum + Number(next || 0) - Number(before || 0) : sum), 0);
  return Math.max(0, round2(rise - claimed - Number(planClaim || 0)));
}

function unlockedPriceRefusal(stored, quote) {
  if (round2(quote.finalPrice) !== round2(stored.finalPrice)) {
    return { error: `Fiche déverrouillée : le prix final doit rester à ${formatEuros(round2(stored.finalPrice))}.`, code: UNLOCKED_PRICE_CODE };
  }
  if (round2(quote.touristTaxTotal) !== round2(stored.touristTaxTotal)) {
    return { error: `Fiche déverrouillée : la taxe de séjour doit rester à ${formatEuros(round2(stored.touristTaxTotal))}.`, code: UNLOCKED_PRICE_CODE };
  }
  return null;
}

module.exports = { unclaimedRise, unlockedPriceRefusal, UNLOCKED_PRICE_CODE };
