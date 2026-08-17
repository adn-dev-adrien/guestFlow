import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

// specs/hourly-resource-quantity-and-sas-scheduling.md §3.1 rule 5 — an hourly resource is normally
// sold unscheduled and planned with the guest during the arrival SAS. « à planifier » is an ordinary
// state, not an alarm, but it has to be visible: otherwise a bath nobody booked a slot for looks
// exactly like a scheduled one. The counts come from the server (`quantity` / `scheduledHours`) —
// the summary never derives them from the session list.

const BAIN = {
  id: 2, name: 'Bain nordique', price: 30, priceType: 'per_hour',
  showsPlanningCard: 1, isComplex: true, freeMinutes: 0,
};

const FORM = {
  startDate: '2099-09-11', endDate: '2099-09-14', finalPrice: 260, customPrice: '',
  platform: 'direct', touristTaxTotal: 0, depositAmount: 80, balanceAmount: 180, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0,
};

function renderSummary(resourceLine) {
  return render(
    <PricingSummary
      quote={{
        finalPrice: 260, totalStayPrice: 260, nights: 3, touristTaxTotal: 0, touristTaxOriginalTotal: 0,
        optionLines: [], resourceLines: [resourceLine], resourcesTotal: Number(resourceLine.totalPrice || 0),
      }}
      form={FORM}
      selectedProperty={{ name: 'Aventura lodge' }}
      offeredOptionIds={new Set()}
      propertyOptions={[]}
      availableResources={[BAIN]}
      parsedTotalPrice={200}
      accommodationDiscountedPriceDisplay={'200.00'}
      onToggleOptionOffered={vi.fn()}
    />
  );
}

const line = (over = {}) => ({
  resourceId: 2, name: 'Bain nordique', quantity: 3, unitPrice: 30, billedUnits: 3,
  totalPrice: 90, priceType: 'per_hour', offered: false, ...over,
});

test('hours sold but nothing placed → « à planifier »', () => {
  renderSummary(line({ scheduledHours: 0 }));
  expect(screen.getByText('Bain nordique ×3h')).toBeInTheDocument();
  expect(screen.getByText('à planifier')).toBeInTheDocument();
});

test('partially placed → « 1 h / 3 h planifiées »', () => {
  renderSummary(line({ scheduledHours: 1 }));
  expect(screen.getByText('1 h / 3 h planifiées')).toBeInTheDocument();
  expect(screen.queryByText('à planifier')).not.toBeInTheDocument();
});

test('fully placed → no chip at all', () => {
  renderSummary(line({ scheduledHours: 3 }));
  expect(screen.queryByText('à planifier')).not.toBeInTheDocument();
  expect(screen.queryByText(/planifiées/)).not.toBeInTheDocument();
});

test('a resource that cannot be scheduled never shows the chip', () => {
  // No `scheduledHours` on the line = the server says « not schedulable » (a per_stay resource, say).
  renderSummary(line({ priceType: 'per_stay', quantity: 2 }));
  expect(screen.queryByText('à planifier')).not.toBeInTheDocument();
  expect(screen.queryByText(/planifiées/)).not.toBeInTheDocument();
});

test('REGRESSION: an unscheduled hourly resource is still worth its money in the summary', () => {
  // The reported bug: the line was dropped entirely, so the resource vanished with its 90 €
  // (specs/hourly-resource-quantity-and-sas-scheduling.md §1 defect 1).
  renderSummary(line({ scheduledHours: 0 }));
  expect(screen.getByText('90,00 €')).toBeInTheDocument();
});
