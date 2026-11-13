/**
 * What a save of a started stay may do to its price, judged on the stored row and the engine's quote.
 *
 * - `unclaimedRise(stored, quote, { planClaim, openOverpayment })` — the part of a rise of finalPrice + touristTaxTotal that
 *   no unpaid bucket (acompte, solde, arrival complement, end-of-stay complement, and the unpaid installments of a plan:
 *   `planClaim`, euros, what the save's rebalance adds to them) takes on, nor the money already collected beyond the stored
 *   total (`openOverpayment`, euros, the ledger's trop-perçu before the save, net of the free refunds; capped at the rise);
 *   0 when nothing rises (specs/mid-stay-extras-to-end-of-stay-complement.md rule 20, readings of 2026-11-06: audit R26
 *   finding 1, D21 review L3, audit R27-RES-1).
 * - `unlockedPriceRefusal(stored, quote, { storedLines, quoteLines })` — D21: an unlocked fiche keeps its final price and
 *   its tourist tax, except for the drop that offering a line explains to the cent; the refusal `{ error, code }` or null
 *   (specs/settings-rationalization.md rule 35, D21 and its 2026-11-13 reading).
 */
const { formatEuros } = require('./reservationLedger');
const { extraLineKey } = require('./midStayExtras');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const flag = (v) => Number(v || 0) === 1;

const UNLOCKED_PRICE_CODE = 'UNLOCKED_PRICE_CHANGED';

function unclaimedRise(stored, quote, { planClaim = 0, openOverpayment = 0 } = {}) {
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
  const overCollected = Math.min(rise, Math.max(0, Number(openOverpayment || 0)));
  return Math.max(0, round2(rise - claimed - Number(planClaim || 0) - overCollected));
}

const isOffered = (line) => Number(line.offered || 0) === 1 || line.offered === true;

// What the lines newly offered by this save used to bill: the stored amount of every key that was billed
// and is now offered. Offering is a gesture the price follows, never a correction of the platform amounts.
function newlyOfferedAmount(storedLines, quoteLines) {
  const offeredNow = new Set((quoteLines || []).filter(isOffered).map(extraLineKey).filter(Boolean));
  return round2((storedLines || [])
    .filter((line) => !isOffered(line) && offeredNow.has(extraLineKey(line)))
    .reduce((sum, line) => sum + Number(line.totalPrice || 0), 0));
}

function dropExplainedByOffer(stored, quote, { storedLines, quoteLines }) {
  const drop = round2(Number(stored.finalPrice || 0) - Number(quote.finalPrice || 0));
  if (drop <= 0 || Number(stored.discountPercent || 0) !== Number(quote.discountPercent || 0)) return false;
  return Math.abs(drop - newlyOfferedAmount(storedLines, quoteLines)) <= 0.01;
}

function unlockedPriceRefusal(stored, quote, lines = {}) {
  if (round2(quote.finalPrice) !== round2(stored.finalPrice) && !dropExplainedByOffer(stored, quote, lines)) {
    return { error: `Fiche déverrouillée : le prix final doit rester à ${formatEuros(round2(stored.finalPrice))}.`, code: UNLOCKED_PRICE_CODE };
  }
  if (round2(quote.touristTaxTotal) !== round2(stored.touristTaxTotal)) {
    return { error: `Fiche déverrouillée : la taxe de séjour doit rester à ${formatEuros(round2(stored.touristTaxTotal))}.`, code: UNLOCKED_PRICE_CODE };
  }
  return null;
}

module.exports = { unclaimedRise, unlockedPriceRefusal, UNLOCKED_PRICE_CODE };
