import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

// specs/per-property-default-options.md — a property-default option configured « offered » is INCLUDED
// in the night rate: the summary labels it « Comprise » + « incluse dans le tarif », not the green
// « ✓ Offert » of a one-off geste commercial. Both, however, show their REAL price STRUCK THROUGH and
// bill 0 — the guest has to see what the rate already covers AND what it is worth
// (specs/tariff-recipes/spec.md §3.8).

const PROPERTY_OPTIONS = [
  { id: 10, title: 'Petit-déjeuner', price: 25, priceType: 'per_stay' },
  { id: 11, title: 'Parking', price: 15, priceType: 'per_stay' },
];

const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 200, customPrice: '',
  platform: 'direct', touristTaxTotal: 0, depositAmount: 60, balanceAmount: 140, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0,
};

function renderSummary(optionLines, quoteOverrides = {}) {
  return render(
    <PricingSummary
      quote={{
        finalPrice: 200, totalStayPrice: 200, nights: 2, touristTaxTotal: 0, touristTaxOriginalTotal: 0,
        optionLines, resourceLines: [], ...quoteOverrides,
      }}
      form={FORM}
      selectedProperty={{ name: 'Villa A' }}
      offeredOptionIds={new Set()}
      propertyOptions={PROPERTY_OPTIONS}
      availableResources={[]}
      parsedTotalPrice={200}
      accommodationDiscountedPriceDisplay={'200.00'}
      onToggleOptionOffered={vi.fn()}
    />
  );
}

test('included-in-rate option → « Comprise » + « incluse dans le tarif » + its real price struck through', () => {
  renderSummary([
    { optionId: 10, title: 'Petit-déjeuner', quantity: 1, offered: true, includedInRate: true, totalPrice: 0, originalTotalPrice: 25 },
  ]);
  expect(screen.getByText('incluse dans le tarif')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Comprise' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '✓ Offert' })).toBeNull();
  // The real price is shown, struck through — not a bare 0 €.
  const amount = screen.getByText('25,00 €');
  expect(amount).toBeInTheDocument();
  expect(getComputedStyle(amount).textDecoration).toContain('line-through');
});

test('a one-off offered option (not included) keeps « ✓ Offert » + the struck-through price', () => {
  renderSummary([
    { optionId: 11, title: 'Parking', quantity: 1, offered: true, totalPrice: 0, originalTotalPrice: 15 },
  ]);
  expect(screen.getByRole('button', { name: '✓ Offert' })).toBeInTheDocument();
  expect(screen.queryByText('incluse dans le tarif')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Comprise' })).toBeNull();
  // The struck-through original price (15) is shown, not 0.
  expect(screen.getByText('15,00 €')).toBeInTheDocument();
});

// specs/tourist-tax-included-services-deduction.md rule 13 — the summary says the subtraction out
// loud: the accommodation charged, minus what the rate already covers, is what the commune is
// declared on.
const TAXED_QUOTE = {
  touristTaxTotal: 15, touristTaxOriginalTotal: 15, touristTaxUnitAmount: 2.5,
  touristTaxAdultsCount: 2, touristTaxNights: 3, touristTaxLabel: '(90.85EUR HT/nuit ÷ 2 occupants) x 5.00% + 10.00% dep = 2.50EUR/adulte/nuit',
};

test('the tourist-tax caption shows the deduction of the services included in the rate', () => {
  renderSummary(
    [{ optionId: 10, title: 'Petit-déjeuner', quantity: 1, offered: true, includedInRate: true, totalPrice: 0, originalTotalPrice: 25 }],
    { ...TAXED_QUOTE, touristTaxBaseBeforeDeduction: 359.79, touristTaxIncludedInRateDeduction: 60 },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Afficher détail' }));
  expect(screen.getByText('Base : 359,79 € − 60,00 € de prestations comprises')).toBeInTheDocument();
});

test('no deduction → no caption', () => {
  renderSummary(
    [{ optionId: 11, title: 'Parking', quantity: 1, totalPrice: 15, originalTotalPrice: 15 }],
    { ...TAXED_QUOTE, touristTaxBaseBeforeDeduction: 359.79, touristTaxIncludedInRateDeduction: 0 },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Afficher détail' }));
  expect(screen.getByText(/^Base: /)).toBeInTheDocument();
  expect(screen.queryByText(/de prestations comprises/)).toBeNull();
});

// specs/welcome-pack-auto-options.md §6 — a welcome-pack line says how many units the rate covers on
// the left, and what they are worth in the AMOUNT column: greyed, struck through, one size down,
// right above the 0,00 € it explains. It used to sit under the « + compl. » chip, where it read as a
// second label rather than as a price.
test('a welcome-pack line prints the covered value above its amount, struck through', () => {
  renderSummary([
    { optionId: 10, title: 'Jus de pomme 1L', quantity: 1, totalPrice: 0, originalTotalPrice: 5, freeUnits: 1, freeUnitsAmount: 5 },
  ]);
  expect(screen.getByText('dont 1 inclus dans le tarif')).toBeInTheDocument();

  const covered = screen.getByText('5,00 €');
  expect(getComputedStyle(covered).textDecoration).toContain('line-through');
  // Same column as the line's amount, and above it.
  const amount = [...covered.parentElement.children].find((el) => el !== covered);
  expect(amount).toHaveTextContent('0,00 €');
  expect(covered.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
