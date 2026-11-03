// specs/non-card-option-served-persons.md rule 29 — the summary's line label prints the figure the server
// sends: a typed line is no longer « · 1 matin », or silent, whatever was typed.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import PricingSummary from '../PricingSummary';

const FORM = {
  finalPrice: 260, customPrice: '', platform: 'direct', touristTaxTotal: 0, depositAmount: 80, balanceAmount: 180, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0,
};

function renderSummary(optionLine) {
  return render(
    <PricingSummary
      quote={{
        finalPrice: 260, totalStayPrice: 260, nights: 3, touristTaxTotal: 0, touristTaxOriginalTotal: 0,
        optionLines: [optionLine], resourceLines: [], optionsTotal: Number(optionLine.totalPrice || 0),
      }}
      form={FORM}
      selectedProperty={{ name: 'Gîte' }}
      offeredOptionIds={new Set()}
      propertyOptions={[]}
      availableResources={[]}
      parsedTotalPrice={200}
      accommodationDiscountedPriceDisplay="200.00"
      onToggleOptionOffered={vi.fn()}
    />,
  );
}

const line = (over) => ({ optionId: 7, title: 'Café', quantity: 1, unitPrice: 4, billedUnits: 3, totalPrice: 12, offered: false, ...over });

test('rule 29 — a breakfast by the day reads the mornings the server counts', () => {
  renderSummary(line({ priceType: 'per_night', quantityUnit: 'morning', displayCount: 3 }));
  expect(screen.getByText('Café · 3 matins')).toBeInTheDocument();
});

test('rule 29 — a typed line reads the people served', () => {
  renderSummary(line({ priceType: 'per_person', displayCount: 3 }));
  expect(screen.getByText('Café ×3')).toBeInTheDocument();
});

test('rule 29 — a figure of 1 reads no count, and a line without a figure keeps its quantity', () => {
  const { unmount } = renderSummary(line({ priceType: 'per_person', displayCount: 1 }));
  expect(screen.getByText('Café')).toBeInTheDocument();
  unmount();
  renderSummary(line({ priceType: 'per_stay', quantity: 2 }));
  expect(screen.getByText('Café ×2')).toBeInTheDocument();
});
