// specs/pricing/pricing-components.md rules 16, 31, 39 (end review R3-6) — the « Remise » chip shows the line's discount total as the server summed it;
// the screen adds nothing.
import React from 'react';
import { render, screen } from '@testing-library/react';
import SaleDetailList from '../SaleDetailList';

const line = (over) => ({
  ref: 'option:7', kind: 'option', label: 'Bain nordique', quantity: 1, totalCents: 2500, sourceLabel: 'Fiche', status: 'dueAtArrival', statusLabel: 'À payer à l’arrivée',
  collectAt: 'arrival', momentLabel: 'À l’arrivée', discountCents: 1000, stayDiscountShareCents: 500, ...over,
});

test('rule 39 — the chip reads `discountTotalCents`, never a sum of its parts', () => {
  const { unmount } = render(<SaleDetailList detail={{ lines: [line({ discountTotalCents: 1500 })], totals: { dueCents: 2500 } }} />);
  expect(screen.getByText(/Remise 15,00/)).toBeInTheDocument();
  unmount();
  render(<SaleDetailList detail={{ lines: [line({ discountTotalCents: 0 })], totals: { dueCents: 2500 } }} />);
  expect(screen.queryByText(/Remise/)).toBeNull();
});
