// specs/pricing-components.md §3 rules 1, 2, 3 and 6 — TOURIST TAX alone: the three property modes, a frozen base, the
// French captions, and the tax of the guests added after what a platform billed. No DB, plain objects.
const test = require('node:test');
const assert = require('node:assert/strict');
const touristTax = require('../utils/pricing/touristTax');
const pricing = require('../utils/pricing');

const { computeTouristTaxBreakdown, resolveAddedGuestsTouristTax } = touristTax;
const NBSP = ' ';

test('rule 6 — pricing.js re-exports the very functions of TOURIST TAX', () => {
  assert.equal(pricing.computeTouristTaxBreakdown, computeTouristTaxBreakdown);
});

test('rule 3 — per person per night: rate × nights × adults, with its caption', () => {
  const tax = computeTouristTaxBreakdown({ touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 1.5, nights: 3, adults: 2, occupants: 3 });
  assert.equal(tax.touristTaxTotal, 9);
  assert.equal(tax.touristTaxUnitAmount, 1.5);
  assert.equal(tax.touristTaxLabel, `1,50${NBSP}€ × 2 adultes × 3 nuits`);
  assert.equal(computeTouristTaxBreakdown({ nights: 1, adults: 1, touristTaxPerDayPerPerson: 1 }).touristTaxMode, 'per_day_per_person');
});

test('rule 3 — percentage of the accommodation: per occupant-night base HT × commune % + department %', () => {
  const tax = computeTouristTaxBreakdown({
    touristTaxMode: 'percentage_accommodation', touristTaxPercentage: 5, touristTaxDepartmentPercentage: 10,
    nights: 2, adults: 2, occupants: 4, accommodationAmountTtc: 440, accommodationVatRate: 10,
  });
  assert.equal(tax.touristTaxPricePerNightHt, 200);
  assert.equal(tax.touristTaxPerOccupantNightPriceHt, 50);
  assert.equal(tax.touristTaxMunicipalUnitAmount, 2.5);
  assert.equal(tax.touristTaxDepartmentUnitAmount, 0.25);
  assert.equal(tax.touristTaxUnitAmount, 2.75);
  assert.equal(tax.touristTaxTotal, 11);
  assert.equal(tax.touristTaxBaseHt, 400);
  assert.ok(tax.touristTaxLabel.includes(`5,00${NBSP}%`));
});

test('rule 3 — percentage and fixed adds the fixed amount per adult-night', () => {
  const tax = computeTouristTaxBreakdown({
    touristTaxMode: 'percentage_and_fixed', touristTaxPercentage: 5, touristTaxDepartmentPercentage: 0, touristTaxFixedAmount: 0.5,
    nights: 2, adults: 2, occupants: 2, accommodationAmountTtc: 220, accommodationVatRate: 10,
  });
  assert.equal(tax.touristTaxUnitAmount, 3);
  assert.equal(tax.touristTaxTotal, 12);
  assert.ok(tax.touristTaxLabel.includes(`+ 0,50${NBSP}€`));
});

test('rule 3 — a frozen base HT is used verbatim instead of today\'s tariff', () => {
  const inputs = {
    touristTaxMode: 'percentage_accommodation', touristTaxPercentage: 5, touristTaxDepartmentPercentage: 0,
    nights: 3, adults: 2, occupants: 2, accommodationAmountTtc: 9999, accommodationVatRate: 10,
  };
  const frozen = computeTouristTaxBreakdown({ ...inputs, accommodationAmountHt: 300 });
  assert.equal(frozen.touristTaxBaseHt, 300);
  assert.equal(frozen.touristTaxTotal, 15);
  const nullBase = computeTouristTaxBreakdown({ ...inputs, accommodationAmountHt: null });
  assert.notEqual(nullBase.touristTaxBaseHt, 0, 'a legacy frozen row without a base is not read as 0 €');
});

test('rule 3 — blanks and negatives give a zero tax, never NaN', () => {
  const tax = computeTouristTaxBreakdown({ touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: -2, nights: undefined, adults: 'x' });
  assert.equal(tax.touristTaxTotal, 0);
  assert.equal(computeTouristTaxBreakdown({}).touristTaxTotal, 0);
});

test('rule 3 — formatters: French thousands, comma, non-breaking space, minus sign', () => {
  assert.equal(touristTax.frenchEuros(1234.5), `1${NBSP}234,50${NBSP}€`);
  assert.equal(touristTax.frenchPercent(5), `5,00${NBSP}%`);
  assert.equal(touristTax.frenchNumber(-3.456), '−3,46');
});

test('rule 3 — the tax of added guests is the gap between the current party and the party the platform billed', () => {
  const taxInputs = { touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 2, nights: 3 };
  const added = resolveAddedGuestsTouristTax({ ...taxInputs, adults: 4, occupants: 4, paidAdults: 2, paidOccupants: 2 });
  assert.deepEqual(added, { paidTotal: 12, added: 12 });
  assert.deepEqual(resolveAddedGuestsTouristTax({ ...taxInputs, adults: 2, occupants: 2, paidAdults: 3, paidOccupants: 3 }), { paidTotal: 18, added: 0 });
});

test('rule 3 — a percentage tax gap of less than a cent per night and adult is rounding noise, not a sale', () => {
  const taxInputs = {
    touristTaxMode: 'percentage_accommodation', touristTaxPercentage: 5, touristTaxDepartmentPercentage: 0,
    nights: 1, accommodationAmountTtc: 100, accommodationVatRate: 0,
  };
  const noise = resolveAddedGuestsTouristTax({ ...taxInputs, adults: 2, occupants: 2, paidAdults: 2, paidOccupants: 2 });
  assert.equal(noise.added, 0);
});

test('rule 3 — the included-services deduction sums unit price × units, rounded once', () => {
  assert.equal(touristTax.sumIncludedServicesDeduction([{ unitPrice: 12.5, units: 2 }, null, { unitPrice: 8, units: 3 }]), 49);
  assert.equal(touristTax.sumIncludedServicesDeduction([{ unitPrice: 6.5, units: 3 * 2 }]), 39, 'persons × nights are the caller\'s units');
  assert.equal(touristTax.sumIncludedServicesDeduction(undefined), 0);
});

test('rule 3 — the tax base is the tariff less the deduction, floored at zero; a platform brut derives it from the brut', () => {
  const none = { platformGrossPin: null, preArrivalOptionsResources: 0, withheldTouristTaxInBrut: 0, extraGuestInBrutSurcharge: 40 };
  assert.deepEqual(
    touristTax.resolveTaxBase({ ...none, taxBaseBeforeDeduction: 300, touristTaxIncludedInRateDeduction: 49 }),
    { taxAccommodationPaid: 300, taxBaseAccommodation: 251, touristTaxBrutInconsistent: false },
  );
  assert.equal(touristTax.resolveTaxBase({ ...none, taxBaseBeforeDeduction: 30, touristTaxIncludedInRateDeduction: 49 }).taxBaseAccommodation, 0);
  const brut = {
    platformGrossPin: 500, preArrivalOptionsResources: 60, withheldTouristTaxInBrut: 10, extraGuestInBrutSurcharge: 40, taxBaseBeforeDeduction: 300, touristTaxIncludedInRateDeduction: 20,
  };
  assert.deepEqual(touristTax.resolveTaxBase(brut), { taxAccommodationPaid: 430, taxBaseAccommodation: 370, touristTaxBrutInconsistent: false });
  assert.equal(touristTax.resolveTaxBase({ ...brut, platformGrossPin: 100 }).touristTaxBrutInconsistent, true);
});
