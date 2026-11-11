/**
 * TOTALS — what the steps before it returned, added up (specs/pricing-components.md §3 rules 15, 51).
 *
 * Contract: `aggregateTotals({ accommodation, extraGuestSurcharge, optionsTotal, resourcesTotal, touristTaxTotal, subtotal,
 * vat })` → `{ finalPrice, discountAmount, totalStayPrice, vatByRate, breakdown }`. `finalPrice` is the sum of the four
 * priced parts, `totalStayPrice` that plus the tourist tax, `discountAmount` is what DISCOUNTS says the stay lost between
 * `subtotal` and `finalPrice`, `vatByRate` is the VAT component's per-rate rows as they came, `breakdown` lists the parts
 * in the order the fiche prints them.
 *
 * It holds no formula of its own: a sum of provided amounts, the discount unit's `discountAmountOf` and the VAT unit's
 * rows. Pure: no DB, no clock, no settings.
 */
const { sumMoney } = require('./money');
const { discountAmountOf } = require('./discounts');

function aggregateTotals({
  accommodation, extraGuestSurcharge, optionsTotal, resourcesTotal, touristTaxTotal, subtotal, vat,
}) {
  const finalPrice = sumMoney([accommodation, extraGuestSurcharge, optionsTotal, resourcesTotal]);
  const totalStayPrice = sumMoney([finalPrice, touristTaxTotal]);
  return {
    finalPrice,
    discountAmount: discountAmountOf({ subtotal, finalPrice }),
    totalStayPrice,
    vatByRate: vat ? vat.byRate : [],
    breakdown: [
      { key: 'accommodation', amount: accommodation },
      { key: 'extraGuests', amount: extraGuestSurcharge },
      { key: 'options', amount: optionsTotal },
      { key: 'resources', amount: resourcesTotal },
      { key: 'touristTax', amount: touristTaxTotal },
    ],
  };
}

module.exports = { aggregateTotals };
