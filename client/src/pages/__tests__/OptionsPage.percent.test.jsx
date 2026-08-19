import React from 'react';
import { render, screen } from '@testing-library/react';

import { OptionPriceSection } from '../OptionsPage';

// specs/cancellation-insurance.md §3.1 + §6.1 — the `percent_of_stay` price type stores a
// PERCENTAGE, so every price field of the option form switches unit, bounds and helper text.

const PROPERTIES = [{ id: 1, name: 'Le Lodge' }, { id: 2, name: 'La Cabane' }];

function renderSection(form) {
  render(<OptionPriceSection form={form} setForm={vi.fn()} properties={PROPERTIES} />);
}

test('a percentage option asks for a percentage, capped at 100', () => {
  renderSection({ priceType: 'percent_of_stay', price: 4, propertyIds: [] });

  const field = screen.getByLabelText('Pourcentage (%)');
  expect(field).toHaveValue(4);
  expect(field).toHaveAttribute('max', '100');
  expect(screen.queryByLabelText('Prix (EUR)')).not.toBeInTheDocument();
});

test('the helper says what the percentage bites on — the accommodation, nothing else', () => {
  renderSection({ priceType: 'percent_of_stay', price: 4, propertyIds: [] });
  expect(screen.getByText(/hors\s+options, ressources et taxe de séjour/)).toBeInTheDocument();
});

test('every other price type keeps the euro field, uncapped', () => {
  renderSection({ priceType: 'per_stay', price: 80, propertyIds: [] });

  const field = screen.getByLabelText('Prix (EUR)');
  expect(field).toHaveValue(80);
  expect(field).not.toHaveAttribute('max');
  expect(screen.queryByLabelText('Pourcentage (%)')).not.toBeInTheDocument();
});

test('per-property mode asks for one percentage per property, with a percentage fallback hint', () => {
  renderSection({
    priceType: 'percent_of_stay', price: 4, propertyIds: [1, 2],
    perPropertyPricing: true, propertyPrices: { 2: 6 },
  });

  expect(screen.getAllByLabelText('Pourcentage (%)')).toHaveLength(2);
  expect(screen.getByText(/pourcentage de base \(4 %\)/)).toBeInTheDocument();
  expect(screen.getAllByPlaceholderText('4 (pourcentage de base)')).toHaveLength(2);
});
