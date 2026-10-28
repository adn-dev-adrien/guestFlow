/**
 * The notices the pricing summary of a fiche shows besides its figures, decided and worded by the server
 * (CLAUDE.md §6.0: the fiche renders them, it compares nothing). Each one is a warning, never a refusal.
 *
 *   TOURIST_TAX_STALE          the tourist tax the engine computes now is not the one the fiche stores
 *                              (a rule changed after the save: Booking switched to « nous reverse » the
 *                              tax). Carries the action that recomputes it on the next save.
 *   PLATFORM_COMMISSION_ODD    the commission entered on a platform stay is far above what the platform
 *                              is configured at, or eats half the sale (#22201: 91,5 % on a channel at
 *                              5 %) — almost always a typing slip, never silently booked.
 *
 * Pure: the caller hands over the figures.
 */

const COMMISSION_FACTOR_ALERT = 2;
const COMMISSION_SHARE_ALERT = 0.5;

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const euros = (value) => `${round2(value).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
const percent = (ratio) => `${(Math.round(ratio * 1000) / 10).toFixed(1).replace('.', ',')} %`;

function touristTaxStale({ quote, storedRow }) {
  if (!storedRow || storedRow.kind !== 'reservation' || !quote || quote.touristTaxFrozen) return null;
  const stored = round2(storedRow.touristTaxTotal);
  const current = round2(quote.touristTaxTotal);
  if (Math.abs(stored - current) < 0.01) return null;
  return {
    code: 'TOURIST_TAX_STALE',
    text: `Taxe de séjour à mettre à jour : ${euros(stored)} enregistrés, ${euros(current)} calculés.`,
    action: 'refreshTouristTax',
  };
}

function platformCommissionOdd({ commission, gross, platformLabel, configuredPercent }) {
  const amount = round2(commission);
  const base = round2(gross);
  if (!(amount > 0) || !(base > 0)) return null;
  const share = amount / base;
  const expected = Number(configuredPercent) > 0 ? Number(configuredPercent) / 100 : null;
  const tooHigh = share > COMMISSION_SHARE_ALERT || (expected !== null && share > expected * COMMISSION_FACTOR_ALERT);
  if (!tooHigh) return null;
  const against = expected !== null ? `, contre ${percent(expected)} attendus pour ${platformLabel}` : '';
  return {
    code: 'PLATFORM_COMMISSION_ODD',
    text: `Commission de ${euros(amount)} : ${percent(share)} du séjour${against}.`,
  };
}

module.exports = { touristTaxStale, platformCommissionOdd, COMMISSION_FACTOR_ALERT, COMMISSION_SHARE_ALERT };
