import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

// specs/per-property-default-options.md — a property-default option configured « offered » is INCLUDED
// in the night rate: the summary shows « Comprise » + « incluse dans le tarif » at 0 €, NOT the green
// « ✓ Offert » with the struck-through original price (which stays for a one-off geste commercial).

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

test('included-in-rate option → « Comprise » + « incluse dans le tarif » + 0,00€, never « ✓ Offert »', () => {
  renderSummary([
    { optionId: 10, title: 'Petit-déjeuner', quantity: 1, offered: true, includedInRate: true, totalPrice: 0, originalTotalPrice: 25 },
  ]);
  expect(screen.getByText('incluse dans le tarif')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Comprise' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '✓ Offert' })).toBeNull();
  // Shown at 0 €, NOT the struck-through original price.
  expect(screen.getAllByText('0.00€').length).toBeGreaterThan(0);
  expect(screen.queryByText('25.00€')).toBeNull();
});

test('a one-off offered option (not included) keeps « ✓ Offert » + the struck-through price', () => {
  renderSummary([
    { optionId: 11, title: 'Parking', quantity: 1, offered: true, totalPrice: 0, originalTotalPrice: 15 },
  ]);
  expect(screen.getByRole('button', { name: '✓ Offert' })).toBeInTheDocument();
  expect(screen.queryByText('incluse dans le tarif')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Comprise' })).toBeNull();
  // The struck-through original price (15) is shown, not 0.
  expect(screen.getByText('15.00€')).toBeInTheDocument();
});
