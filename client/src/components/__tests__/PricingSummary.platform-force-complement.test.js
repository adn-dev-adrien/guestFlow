import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

// specs/force-extras-complement-on-platform.md §3 rule 4 + §7.2.
// On non-direct platform reservations, PricingSummary hides the per-line
// <ComplementChip> (the small "compl." / "+ compl." chip) because the routing
// is server-forced — but keeps the "Offrir / ✓ Offert" Button intact so the
// operator can still make a geste commercial on an extra.

const PROPERTY_OPTIONS = [
  { id: 10, title: 'Petit-déjeuner', price: 10, priceType: 'per_person' },
];
const AVAILABLE_RESOURCES = [
  { id: 20, name: 'Vélo', price: 5, priceType: 'per_stay' },
];

const BASE_FORM = {
  startDate: '2099-09-15',
  endDate: '2099-09-17',
  finalPrice: 1000,
  customPrice: '',
  platform: 'direct',
  depositAmount: 300,
  balanceAmount: 700,
  cautionAmount: 0,
  depositPaid: 0,
  balancePaid: 0,
};

const QUOTE_WITH_EXTRAS = {
  finalPrice: 1000,
  totalStayPrice: 1000,
  nights: 2,
  touristTaxTotal: 0,
  touristTaxOfferedByPlatform: false,
  // One regular option line + one resource line, both NOT in complement (so the
  // 'simple' branch fires + the chip is rendered as "+ compl." on direct).
  optionLines: [
    { optionId: 10, title: 'Petit-déjeuner', quantity: 2, totalPrice: 20, offered: false, inComplement: 0 },
  ],
  resourceLines: [
    { resourceId: 20, name: 'Vélo', quantity: 1, totalPrice: 5, offered: false, inComplement: 0 },
  ],
  optionsTotal: 20,
  resourcesTotal: 5,
};

function renderSummary({ form, onToggleOptionOffered = vi.fn(), onToggleResourceOffered = vi.fn() } = {}) {
  return {
    onToggleOptionOffered,
    onToggleResourceOffered,
    ...render(
      <PricingSummary
        quote={QUOTE_WITH_EXTRAS}
        form={form}
        selectedProperty={{ name: 'Villa A' }}
        offeredOptionIds={new Set()}
        propertyOptions={PROPERTY_OPTIONS}
        availableResources={AVAILABLE_RESOURCES}
        parsedTotalPrice={1000}
        accommodationDiscountedPriceDisplay={'1000.00'}
        onToggleExtraGuestOffered={vi.fn()}
        onToggleOptionOffered={onToggleOptionOffered}
        onToggleCustomOptionOffered={vi.fn()}
        onToggleResourceOffered={onToggleResourceOffered}
        onToggleOptionInComplement={vi.fn()}
        onToggleCustomOptionInComplement={vi.fn()}
        onToggleResourceInComplement={vi.fn()}
        onToggleTouristTaxInComplement={vi.fn()}
      />
    ),
  };
}

test('direct reservation: per-line <ComplementChip> is rendered alongside the "Offrir" button', () => {
  renderSummary({ form: { ...BASE_FORM, platform: 'direct' } });
  // Two extras (1 option + 1 resource), both non-forced & non-offered → 2 "+ compl." chips.
  expect(screen.getAllByText('+ compl.')).toHaveLength(2);
  // Both "Offrir" buttons are rendered.
  expect(screen.getAllByRole('button', { name: 'Offrir' })).toHaveLength(2);
});

test('platform reservation: per-line <ComplementChip> is NOT rendered + "Offrir" button STAYS', () => {
  renderSummary({ form: { ...BASE_FORM, platform: 'Airbnb' } });
  // No per-line chip at all on the option + resource rows.
  expect(screen.queryByText('+ compl.')).not.toBeInTheDocument();
  expect(screen.queryByText('compl.')).not.toBeInTheDocument();
  // Both "Offrir" buttons stay clickable — the geste-commercial escape valve.
  expect(screen.getAllByRole('button', { name: 'Offrir' })).toHaveLength(2);
});

test('platform reservation: clicking "Offrir" on the option line still calls onToggleOptionOffered (intact handler)', async () => {
  const user = userEvent.setup();
  const onToggleOptionOffered = vi.fn();
  renderSummary({ form: { ...BASE_FORM, platform: 'GitesDeFrance' }, onToggleOptionOffered });
  const buttons = screen.getAllByRole('button', { name: 'Offrir' });
  // First button is the option line's; clicking it flips the offered flag.
  await user.click(buttons[0]);
  expect(onToggleOptionOffered).toHaveBeenCalledWith(10, true);
});
