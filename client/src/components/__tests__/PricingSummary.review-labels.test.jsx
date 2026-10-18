// specs/review-2026-10-18-reservations.md rules 1 and 5 — the summary of an empty fiche shows no
// « (NaN nuit) », and a breakfast the server says counts mornings reads « · 3 matins », not « ×3 ».
import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import PricingSummary from '../PricingSummary';

const BREAKFAST = { id: 6, title: 'Petit déjeuner', price: 8, priceType: 'per_person_per_night', autoOptionType: 'breakfast' };

function renderSummary({ quote, form = {} }) {
  return render(
    <PricingSummary
      quote={quote}
      form={{ startDate: '', endDate: '', customPrice: '', platform: 'direct', depositPaid: 0, balancePaid: 0, ...form }}
      selectedProperty={{ name: 'Gîte' }}
      offeredOptionIds={new Set()}
      propertyOptions={[BREAKFAST]}
      availableResources={[]}
      parsedTotalPrice={null}
      accommodationDiscountedPriceDisplay={null}
      onToggleOptionOffered={vi.fn()}
    />,
  );
}

test('rule 1 — no dates, no night count', () => {
  renderSummary({ quote: null });
  expect(screen.queryByText(/NaN/)).toBeNull();
  expect(screen.queryByText(/nuit\)/)).toBeNull();
});

test('rule 1 — with the server\'s night count, it shows', () => {
  renderSummary({
    quote: { nights: 3, finalPrice: 300, totalStayPrice: 300, optionLines: [], resourceLines: [] },
    form: { startDate: '2099-03-08', endDate: '2099-03-11' },
  });
  expect(screen.getByText('(3 nuits)')).toBeInTheDocument();
});

test('rule 5 — a line counting mornings reads « · 3 matins »', () => {
  renderSummary({
    quote: {
      nights: 3, finalPrice: 444, totalStayPrice: 444, resourceLines: [], optionsTotal: 144,
      optionLines: [{ optionId: 6, title: 'Petit déjeuner', quantity: 3, unitPrice: 8, billedUnits: 18, totalPrice: 144, priceType: 'per_person_per_night', quantityUnit: 'morning' }],
    },
    form: { startDate: '2099-03-08', endDate: '2099-03-11' },
  });
  expect(screen.getByText('Petit déjeuner · 3 matins')).toBeInTheDocument();
  expect(screen.queryByText('Petit déjeuner ×3')).toBeNull();
});

test('rule 5 — without a unit, the quantity keeps its « ×N »', () => {
  renderSummary({
    quote: {
      nights: 3, finalPrice: 348, totalStayPrice: 348, resourceLines: [], optionsTotal: 48,
      optionLines: [{ optionId: 6, title: 'Petit déjeuner', quantity: 6, unitPrice: 8, billedUnits: 6, totalPrice: 48, priceType: 'per_person_per_night', toBeScheduled: true }],
    },
    form: { startDate: '2099-03-08', endDate: '2099-03-11' },
  });
  expect(screen.getByText('Petit déjeuner ×6')).toBeInTheDocument();
});
