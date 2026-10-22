// Guests added after a platform booking — specs/platform-extra-guest-complement.md §3.5 rule 16.
// The fiche shows the in-brut part (never offerable) apart from the added guests (in complement).
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import PricingSummary from '../PricingSummary';

const SPLIT_QUOTE = {
  nights: 2, nightlyBreakdown: [], totalPrice: 600, finalPrice: 720,
  includedGuests: 2, extraGuestCount: 3, extraGuestUnitPrice: 20, extraGuestPriceUnit: 'per_night',
  extraGuestSurchargeOriginal: 120, extraGuestSurcharge: 120,
  extraGuestInBrutCount: 2, extraGuestInBrutSurcharge: 80,
  extraGuestComplementCount: 1, extraGuestComplementOriginal: 40, extraGuestComplementSurcharge: 40,
  platformPaidGuests: 4, extraGuestSurchargeOffered: false,
  optionLines: [], resourceLines: [],
};

function renderSummary(quote, onToggle = vi.fn()) {
  render(<PricingSummary quote={quote} form={{}} onToggleExtraGuestOffered={onToggle} />);
  return onToggle;
}

test('the added guests get their own line with the complement chip and « Offrir »', () => {
  const onToggle = renderSummary(SPLIT_QUOTE);
  expect(screen.getByText('Voyageurs ajoutés · 1 pers.')).toBeInTheDocument();
  expect(screen.getByText('Au-delà des 4 personnes payées à la plateforme')).toBeInTheDocument();
  expect(screen.getByText(/2 pers. au-delà de 2 incluses/)).toBeInTheDocument();
  const offerButtons = screen.getAllByRole('button', { name: 'Offrir' });
  expect(offerButtons).toHaveLength(1);
  fireEvent.click(offerButtons[0]);
  expect(onToggle).toHaveBeenCalledWith(true);
});

test('on a pinned brut the part the platform billed carries no « Offrir »', () => {
  renderSummary({ ...SPLIT_QUOTE, extraGuestCount: 2, extraGuestComplementCount: 0, extraGuestComplementOriginal: 0, extraGuestComplementSurcharge: 0, extraGuestSurchargeOriginal: 80 });
  expect(screen.getByText(/2 pers. au-delà de 2 incluses/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Offrir' })).not.toBeInTheDocument();
});
