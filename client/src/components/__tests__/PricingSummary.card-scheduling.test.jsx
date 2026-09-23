import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

// specs/unscheduled-card-option.md rules 6 + 9 — a card option sold without its moments is the
// website's normal case, so « à planifier » is an ordinary state rather than an alarm; but it has to
// be visible, or nobody can tell a breakfast with three mornings from one that still has none. And
// when the operator plans less than what the guest paid, the gap is named on the line. Both figures
// are the server's (`toBeScheduled`, `soldUnits`) — the summary never derives them.

const BREAKFAST = {
  id: 6, title: 'Petit déjeuner', price: 8, priceType: 'per_person_per_night', showsPlanningCard: 1,
};

const FORM = {
  startDate: '2099-03-08', endDate: '2099-03-11', finalPrice: 348, customPrice: '',
  platform: 'direct', touristTaxTotal: 0, depositAmount: 0, balanceAmount: 348, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0,
};

function renderSummary(optionLine) {
  return render(
    <PricingSummary
      quote={{
        finalPrice: 348, totalStayPrice: 348, nights: 3, touristTaxTotal: 0, touristTaxOriginalTotal: 0,
        optionLines: [optionLine], resourceLines: [], optionsTotal: Number(optionLine.totalPrice || 0),
      }}
      form={FORM}
      selectedProperty={{ name: 'Gîte' }}
      offeredOptionIds={new Set()}
      propertyOptions={[BREAKFAST]}
      availableResources={[]}
      parsedTotalPrice={300}
      accommodationDiscountedPriceDisplay={'300.00'}
      onToggleOptionOffered={vi.fn()}
    />
  );
}

const line = (over = {}) => ({
  optionId: 6, title: 'Petit déjeuner', quantity: 6, unitPrice: 8, billedUnits: 6,
  totalPrice: 48, priceType: 'per_person_per_night', offered: false, ...over,
});

test('sold but not placed → « à planifier »', () => {
  renderSummary(line({ toBeScheduled: true, cardOccurrences: [] }));
  expect(screen.getByText('Petit déjeuner ×6')).toBeInTheDocument();
  expect(screen.getByText('à planifier')).toBeInTheDocument();
});

test('placed → no chip', () => {
  renderSummary(line({ quantity: 3, cardOccurrences: [{ date: '2099-03-09', time: '09:00' }] }));
  expect(screen.queryByText('à planifier')).not.toBeInTheDocument();
});

test('planned below what was sold → « planifié 2 · vendu 6 »', () => {
  renderSummary(line({ quantity: 1, billedUnits: 2, totalPrice: 16, soldUnits: 6 }));
  expect(screen.getByText('planifié 2 · vendu 6')).toBeInTheDocument();
});

test('planning back in line with the sale → the mention goes', () => {
  renderSummary(line({ quantity: 3, billedUnits: 6 }));
  expect(screen.queryByText(/vendu/)).not.toBeInTheDocument();
});
