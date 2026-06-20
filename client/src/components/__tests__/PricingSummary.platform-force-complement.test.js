import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

// specs/force-extras-complement-on-platform.md §3 rule 1bis + §7.2.
// On non-direct platform reservations, operator-added extras (regular options, custom options,
// resources) KEEP their per-line <ComplementChip> so the operator can pull a line back OUT of
// Complément. Only engine-derived auto-options (early/late check, `autoEnabled = 1`) stay chip-less
// on platform — their routing is the algorithm's. The "Offrir / ✓ Offert" Button is always intact.

const PROPERTY_OPTIONS = [
  { id: 10, title: 'Petit-déjeuner', price: 10, priceType: 'per_person' },
];
const PROPERTY_OPTIONS_WITH_AUTO = [
  { id: 10, title: 'Petit-déjeuner', price: 10, priceType: 'per_person' },
  { id: 11, title: 'Départ tardif', price: 25, priceType: 'per_stay', autoEnabled: 1 },
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

function renderSummary({
  form,
  quote = QUOTE_WITH_EXTRAS,
  propertyOptions = PROPERTY_OPTIONS,
  onToggleOptionOffered = vi.fn(),
  onToggleResourceOffered = vi.fn(),
  onToggleOptionInComplement = vi.fn(),
} = {}) {
  return {
    onToggleOptionOffered,
    onToggleResourceOffered,
    onToggleOptionInComplement,
    ...render(
      <PricingSummary
        quote={quote}
        form={form}
        selectedProperty={{ name: 'Villa A' }}
        offeredOptionIds={new Set()}
        propertyOptions={propertyOptions}
        availableResources={AVAILABLE_RESOURCES}
        parsedTotalPrice={1000}
        accommodationDiscountedPriceDisplay={'1000.00'}
        onToggleExtraGuestOffered={vi.fn()}
        onToggleOptionOffered={onToggleOptionOffered}
        onToggleCustomOptionOffered={vi.fn()}
        onToggleResourceOffered={onToggleResourceOffered}
        onToggleOptionInComplement={onToggleOptionInComplement}
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

test('platform reservation: operator-added extras KEEP their <ComplementChip> (override affordance)', () => {
  renderSummary({ form: { ...BASE_FORM, platform: 'Airbnb' } });
  // Both the option + resource lines are non-forced here (inComplement: 0) → 2 "+ compl." chips,
  // now shown on platform too so the operator can route them back IN.
  expect(screen.getAllByText('+ compl.')).toHaveLength(2);
  // "Offrir" buttons stay intact alongside.
  expect(screen.getAllByRole('button', { name: 'Offrir' })).toHaveLength(2);
});

test('platform reservation: clicking the option chip flips it back into Complément', async () => {
  const user = userEvent.setup();
  const onToggleOptionInComplement = vi.fn();
  renderSummary({ form: { ...BASE_FORM, platform: 'Airbnb' }, onToggleOptionInComplement });
  // The first "+ compl." chip is the option line's; clicking it routes the line into Complément.
  await user.click(screen.getAllByText('+ compl.')[0]);
  // (optionId, isAuto, next) — non-auto option flipped ON.
  expect(onToggleOptionInComplement).toHaveBeenCalledWith(10, false, true);
});

test('platform reservation: an AUTO option (autoEnabled = 1) stays chip-less even when in Complément', () => {
  const quoteWithAuto = {
    ...QUOTE_WITH_EXTRAS,
    optionLines: [
      { optionId: 10, title: 'Petit-déjeuner', quantity: 2, totalPrice: 20, offered: false, inComplement: 0 },
      { optionId: 11, title: 'Départ tardif', quantity: 1, totalPrice: 25, offered: false, inComplement: 1, autoExtraHours: 8 },
    ],
    resourceLines: [],
  };
  renderSummary({ form: { ...BASE_FORM, platform: 'Airbnb' }, quote: quoteWithAuto, propertyOptions: PROPERTY_OPTIONS_WITH_AUTO });
  // The regular breakfast keeps its "+ compl." chip; the auto late-checkout (inComplement: 1 →
  // would be a clickable "compl." chip on direct) renders chip-less on platform.
  expect(screen.getAllByText('+ compl.')).toHaveLength(1);
  expect(screen.queryByText('compl.')).not.toBeInTheDocument();
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
