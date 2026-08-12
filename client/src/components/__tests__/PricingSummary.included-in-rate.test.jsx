import React from 'react';
import { render, screen } from '@testing-library/react';
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

function renderSummary(optionLines) {
  return render(
    <PricingSummary
      quote={{ finalPrice: 200, totalStayPrice: 200, nights: 2, touristTaxTotal: 0, touristTaxOriginalTotal: 0, optionLines, resourceLines: [] }}
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
