/**
 * STEP vat — VAT (specs/pricing-components.md §3 rule 52).
 *
 * Splits the accommodation, options and resources TTC amounts into net and VAT through the VAT component.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney, toCents, fromCents } = require('../money');
const { vatOf } = require('../vat');

const step = {
  id: 'vat',
  requires: ['accommodationAdjustedPrice', 'extraGuestSurcharge', 'optionsTotal', 'resourcesTotal', 'settings', 'vatRate', 'vatRegime'],
  provides: [
    'accommodationNetPrice', 'accommodationVatAmount', 'familyVat', 'optionsNetPrice', 'optionsVatAmount',
    'resourcesNetPrice', 'resourcesVatAmount', 'totalNetPrice', 'totalVatAmount', 'vatPercentageAccommodation',
    'vatPercentageOptions', 'vatPercentageResources',
  ],
  apply(ctx) {
    const {
      accommodationAdjustedPrice, extraGuestSurcharge, optionsTotal, resourcesTotal, settings, vatRate, vatRegime,
    } = ctx;

    // VAT calculations (all prices are TTC - VAT already included). Two global rates: accommodation
    // has its own; options, custom options and resources all use the standard rate.
    const vatPercentageAccommodation = vatRate;
    const vatPercentageOptions = vatRate;
    const vatPercentageResources = vatRate;
    
    // For TTC prices: VAT amount = TTC × (vatRate / (100 + vatRate))
    // specs/single-vat-rate.md rule 13 — the extra-guest supplement is a supplement on the nights: it is
    // part of the accommodation's VAT base, as in the stored summary and the accounting export.
    const accommodationVatBase = roundMoney(accommodationAdjustedPrice + extraGuestSurcharge);
    const familyVat = vatOf([
      { amountCents: toCents(accommodationVatBase), vatClass: 'accommodation', customerContext: 'hosted', source: { kind: 'accommodation' } },
      { amountCents: toCents(optionsTotal), vatClass: 'options', customerContext: 'hosted', source: { kind: 'line' } },
      { amountCents: toCents(resourcesTotal), vatClass: 'resources', customerContext: 'hosted', source: { kind: 'line' } },
    ], { regime: vatRegime, settings: settings.vat });
    const [accommodationVat, optionsVat, resourcesVat] = ['accommodation', 'options', 'resources']
      .map((vatClass) => familyVat.groups.find((group) => group.vatClass === vatClass));
    const accommodationVatAmount = fromCents(accommodationVat.vatCents);
    const accommodationNetPrice = fromCents(accommodationVat.netCents);

    const optionsVatAmount = fromCents(optionsVat.vatCents);
    const optionsNetPrice = fromCents(optionsVat.netCents);

    const resourcesVatAmount = fromCents(resourcesVat.vatCents);
    const resourcesNetPrice = fromCents(resourcesVat.netCents);

    const totalVatAmount = fromCents(familyVat.totals.vatCents);
    const totalNetPrice = fromCents(familyVat.totals.netCents);

    return {
      ...ctx,
      accommodationNetPrice, accommodationVatAmount, familyVat, optionsNetPrice, optionsVatAmount,
      resourcesNetPrice, resourcesVatAmount, totalNetPrice, totalVatAmount, vatPercentageAccommodation,
      vatPercentageOptions, vatPercentageResources,
    };
  },
};

module.exports = step;
