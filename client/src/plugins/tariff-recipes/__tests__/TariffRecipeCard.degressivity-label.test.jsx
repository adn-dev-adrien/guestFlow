import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import TariffRecipeCard from '../TariffRecipeCard';
import api from '../../../api';

// specs/tariff-recipes/spec.md §3.2 (2026-10-27 audit) — the card printed the recipe's raw
// fractional discount « 7 nuits −42.857142857142854 % »; it now renders the server's French label.

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getTariffRecipes: vi.fn().mockResolvedValue({ recipes: [] }),
    getTariffRecipe: vi.fn(),
  },
}));

test('the degressivity line is the server label, never the raw float', async () => {
  api.getTariffRecipe.mockResolvedValue({
    recipe: {
      id: 'gite-2027', horizonYears: 2,
      lengthOfStayDiscounts: [{ nights: 7, discountPct: 42.857142857142854 }],
      seasons: [{ label: 'Basse saison', pricePerNight: 100, minNights: 2 }],
    },
    labels: { lengthOfStayDiscounts: '7 nuits −42,9 %' },
  });
  render(<TariffRecipeCard propertyId={1} activeRecipeId="gite-2027" appliedVersion="3.0.0" />);
  expect(await screen.findByText(/7 nuits −42,9 %/)).toBeInTheDocument();
  expect(screen.queryByText(/42\.857/)).toBeNull();
});
