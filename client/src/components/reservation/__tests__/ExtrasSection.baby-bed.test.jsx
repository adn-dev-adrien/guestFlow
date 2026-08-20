import React from 'react';
import { render, screen, within } from '@testing-library/react';

import ExtrasSection from '../ExtrasSection';
import { ReservationFormProvider } from '../ReservationFormContext';
import { makeMockContext } from '../mockReservationForm';

// specs/baby-bed-supplement.md §6 — the cot supplement is engine-derived: its read-only row shows up
// exactly when the ENGINE billed it, reads as a price per cot for the stay, and can never be ticked
// by hand. Keying the row on the quote (not on the counter) is what keeps it honest on a booking
// taken before the supplement existed: stored cots, no line, no row.

const COT_OPTION = {
  id: 30, title: 'Lit bébé', description: '', priceType: 'per_stay', price: 5,
  autoOptionType: 'baby_bed', autoEnabled: 1, countsAsBedLinen: 0,
};

const quoteWithCot = { optionLines: [{ optionId: 30, title: 'Lit bébé', quantity: 2, totalPrice: 10 }] };

function renderExtras({ form = {}, pricingQuote = null } = {}) {
  const value = makeMockContext({ propertyOptions: [COT_OPTION], pricingQuote, form });
  return render(
    <ReservationFormProvider value={value}>
      <ExtrasSection />
    </ReservationFormProvider>
  );
}

test('no cot billed → the supplement row stays out of the way', () => {
  renderExtras({ form: { babyBeds: '' }, pricingQuote: { optionLines: [] } });
  expect(screen.queryByText('Lit bébé')).not.toBeInTheDocument();
});

test('a booking the engine does not bill shows no row, even with cots on it (§3.3)', () => {
  // The grandfathered case: cots ARE on the booking, the engine deliberately bills nothing.
  renderExtras({ form: { babyBeds: 2 }, pricingQuote: { optionLines: [] } });
  expect(screen.queryByText('Lit bébé')).not.toBeInTheDocument();
});

test('a billed cot → a read-only row priced per cot, for the stay', () => {
  renderExtras({ form: { babyBeds: 2 }, pricingQuote: quoteWithCot });
  expect(screen.getByText('Lit bébé')).toBeInTheDocument();
  expect(screen.getByText(/5,00\s?€ par lit bébé, pour le séjour/)).toBeInTheDocument();
  expect(screen.getByText('Ajout automatique')).toBeInTheDocument();
  // The « Lits bébé » counter is the only input: the Switch is engine-owned. Scoped to the row —
  // the resources below have switches of their own.
  const row = screen.getByText('Lit bébé').closest('.MuiCard-root');
  expect(within(row).getByRole('switch')).toBeDisabled();
});

test('the row shows no « seuil nuit complète » — that belongs to the timed options', () => {
  renderExtras({ form: { babyBeds: 1 }, pricingQuote: quoteWithCot });
  expect(screen.queryByText(/seuil nuit complète/)).not.toBeInTheDocument();
});
