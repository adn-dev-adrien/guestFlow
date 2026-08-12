import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

// specs/tariff-events-and-extra-guest-tiers/spec.md §3.1 — a tiered supplement has no single unit
// price, so the summary must render the rule the SERVER phrased rather than invent one from a
// number no night actually costs.

const FORM = {
  startDate: '2026-07-13', endDate: '2026-07-16', finalPrice: 558.47, customPrice: '',
  platform: 'direct', touristTaxTotal: 0, depositAmount: 0, balanceAmount: 0, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0,
};

function renderSummary(extra) {
  return render(
    <PricingSummary
      quote={{
        finalPrice: 558.47, totalStayPrice: 558.47, nights: 3, touristTaxTotal: 0,
        touristTaxOriginalTotal: 0, optionLines: [], resourceLines: [],
        includedGuests: 2, extraGuestCount: 2, extraGuestPriceUnit: 'per_night',
        ...extra,
      }}
      form={FORM}
      selectedProperty={{ name: 'Aventura Lodge' }}
      offeredOptionIds={new Set()}
      propertyOptions={[]}
      availableResources={[]}
      parsedTotalPrice={558.47}
      accommodationDiscountedPriceDisplay={'496.47'}
      onToggleOptionOffered={vi.fn()}
      onToggleExtraGuestOffered={vi.fn()}
    />
  );
}

test('the tier rule is shown verbatim instead of a single × price', () => {
  renderSummary({
    extraGuestUnitPrice: 0,
    extraGuestSurcharge: 62,
    extraGuestSurchargeOriginal: 62,
    extraGuestTiersLabel: '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit',
  });
  expect(screen.getByText(/2 pers. au-delà de 2 incluses — 15,00 € la 1ʳᵉ nuit, puis 8,00 €\/nuit/))
    .toBeInTheDocument();
});

// The regression this guards: the block used to require a non-zero single unit price, so a property
// priced ONLY by tiers would have billed 62 € and displayed nothing.
test('a tiered supplement shows even when the single unit price is 0', () => {
  renderSummary({
    extraGuestUnitPrice: 0,
    extraGuestSurcharge: 62,
    extraGuestSurchargeOriginal: 62,
    extraGuestTiersLabel: '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit',
  });
  expect(screen.getByText('Surcoût voyageurs')).toBeInTheDocument();
});

test('without tiers the historical « × price/nuit × N nuits » wording is untouched', () => {
  renderSummary({
    extraGuestUnitPrice: 27,
    extraGuestSurcharge: 108.54,
    extraGuestSurchargeOriginal: 108.54,
    extraGuestTiersLabel: null,
  });
  expect(screen.getByText(/2 pers. au-delà de 2 incluses × 27,00 €\/nuit × 3 nuits/)).toBeInTheDocument();
});
