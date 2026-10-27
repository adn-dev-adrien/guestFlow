const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTouristTaxBreakdown } = require('../utils/pricing').__test;

// specs/tourist-tax-matches-the-office-calculation.md rule 18 (spec review 2026-10-27,
// M2). The caption printed « (272.55EUR HT ÷ 3 nuits ÷ 2 occupants = 90.85EUR HT/nuit) x 5.00% … »:
// the « = 90,85 » was the per-night price BEFORE the occupant division, so the shown arithmetic was
// false, and the figures were English-formatted. It now reads exactly as the spec writes it.

const NBSP = '\u00a0';
const PERCENT = {
  touristTaxMode: 'percentage_accommodation', touristTaxPercentage: 5, touristTaxDepartmentPercentage: 10,
  accommodationVatRate: 10,
};

test('percentage mode: the spec shape, French figures, no false intermediate', () => {
  const out = computeTouristTaxBreakdown({ ...PERCENT, nights: 3, adults: 2, occupants: 2, accommodationAmountTtc: 299.81 });
  assert.equal(
    out.touristTaxLabel,
    `(272,55${NBSP}€ HT ÷ 3 nuits ÷ 2 occupants) × 5,00${NBSP}% + 10,00${NBSP}% dep = ${out.touristTaxUnitAmount.toFixed(2).replace('.', ',')}${NBSP}€/adulte/nuit`,
  );
  assert.doesNotMatch(out.touristTaxLabel, /EUR|\bx\b|\d\.\d/);
});

test('the shown figures reproduce the unit amount to the cent', () => {
  for (const occupants of [2, 5]) {
    const out = computeTouristTaxBreakdown({ ...PERCENT, nights: 3, adults: occupants, occupants, accommodationAmountTtc: 299.81 });
    const recomputed = (out.touristTaxBaseHt / 3 / occupants) * 0.05 * 1.10;
    assert.ok(Math.abs(recomputed - out.touristTaxUnitAmount) <= 0.011, `${occupants} occupants: ${recomputed} vs ${out.touristTaxUnitAmount}`);
  }
});

test('thousands are grouped and the fixed part is in euros', () => {
  const out = computeTouristTaxBreakdown({
    ...PERCENT, touristTaxMode: 'percentage_and_fixed', touristTaxFixedAmount: 0.2,
    nights: 7, adults: 4, occupants: 4, accommodationAmountTtc: 2552.03,
  });
  assert.match(out.touristTaxLabel, new RegExp(`^\\(2${NBSP}320,08${NBSP}€ HT ÷ 7 nuits ÷ 4 occupants\\) × 5,00${NBSP}% \\+ 10,00${NBSP}% dep \\+ 0,20${NBSP}€ = `));
});

test('per-person mode reads « 1,36 € × 2 adultes × 3 nuits »', () => {
  const out = computeTouristTaxBreakdown({ touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 1.36, nights: 3, adults: 2, occupants: 2 });
  assert.equal(out.touristTaxLabel, `1,36${NBSP}€ × 2 adultes × 3 nuits`);
});
