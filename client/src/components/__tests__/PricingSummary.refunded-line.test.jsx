import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import PricingSummary from '../PricingSummary';

// specs/pricing-components.md rule 108 (stabilisation loop t7, D7-1) — an offered paid line whose money a refund gave back cannot be put
// back at its price: the server names it (`refundedLoweredLines`), the summary reads « ✓ Offert · remboursée » with no toggle.

const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 200, customPrice: '',
  platform: 'direct', touristTaxTotal: 0, depositAmount: 60, balanceAmount: 140, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0,
};

function renderSummary(isRefundedLine) {
  return render(
    <PricingSummary
      quote={{
        finalPrice: 200, totalStayPrice: 200, nights: 2, touristTaxTotal: 0, touristTaxOriginalTotal: 0, resourceLines: [],
        optionLines: [
          { optionId: 11, title: 'Bière', quantity: 1, offered: true, totalPrice: 0, originalTotalPrice: 30 },
          { optionId: 12, title: 'Vin', quantity: 1, offered: true, totalPrice: 0, originalTotalPrice: 20 },
        ],
      }}
      form={FORM}
      selectedProperty={{ name: 'Villa A' }}
      offeredOptionIds={new Set()}
      propertyOptions={[{ id: 11, title: 'Bière', price: 30, priceType: 'per_stay' }, { id: 12, title: 'Vin', price: 20, priceType: 'per_stay' }]}
      availableResources={[]}
      parsedTotalPrice={200}
      accommodationDiscountedPriceDisplay={'200.00'}
      onToggleOptionOffered={vi.fn()}
      isRefundedLine={isRefundedLine}
    />,
  );
}

test('the refunded offered line reads « ✓ Offert · remboursée » and offers no toggle; the other offered line keeps its toggle', () => {
  renderSummary((kind, line) => kind === 'option' && line.optionId === 11);
  expect(screen.getByText('✓ Offert · remboursée')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '✓ Offert' })).toHaveLength(1);
});

test('without the server flag every offered line keeps its toggle', () => {
  renderSummary(undefined);
  expect(screen.queryByText('✓ Offert · remboursée')).toBeNull();
  expect(screen.getAllByRole('button', { name: '✓ Offert' })).toHaveLength(2);
});
