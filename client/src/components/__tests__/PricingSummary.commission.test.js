import React from 'react';
import { render, screen } from '@testing-library/react';

import PricingSummary from '../PricingSummary';

// specs/platform-commission-line.md — for a platform reservation, the summary shows the BRUT (what the
// guest paid the platform), deducts the engine-computed commission, and surfaces the net the operator
// receives. The amount is engine-authoritative (quote.platformCommissionAmount), never re-derived here.

const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 200, customPrice: '',
  platform: 'airbnb', touristTaxTotal: 0, depositAmount: 0, balanceAmount: 235, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0, depositDisabled: false,
};

function renderSummary(quote) {
  return render(
    <PricingSummary
      quote={quote}
      form={FORM}
      selectedProperty={{ name: 'Villa A' }}
      offeredOptionIds={new Set()}
      propertyOptions={[]}
      availableResources={[]}
      parsedTotalPrice={200}
      accommodationDiscountedPriceDisplay={'200.00'}
    />
  );
}

const QUOTE = { finalPrice: 200, totalStayPrice: 200, nights: 2, optionLines: [], resourceLines: [], touristTaxTotal: 0, touristTaxOriginalTotal: 0 };

test('platform reservation with a commission → brut, « Commission plateforme », net perçu', () => {
  renderSummary({ ...QUOTE, platformCommissionAmount: 35 });
  // Labels for the 3-line block + the unique commission amount (brut/net amounts collide with the
  // balance/total rows elsewhere in the panel, so we assert the deduction value which is unique).
  expect(screen.getByText('Total du séjour TTC (brut)')).toBeInTheDocument();
  expect(screen.getByText('Commission plateforme')).toBeInTheDocument();
  expect(screen.getByText('− 35.00€')).toBeInTheDocument();
  expect(screen.getByText('Net perçu TTC')).toBeInTheDocument();
  // The brut (net 200 + commission 35) is shown.
  expect(screen.getAllByText('235.00€').length).toBeGreaterThan(0);
});

test('no commission → the plain « Total du séjour TTC » line (no deduction block)', () => {
  renderSummary({ ...QUOTE, platformCommissionAmount: 0 });
  expect(screen.getByText('Total du séjour TTC')).toBeInTheDocument();
  expect(screen.queryByText('Commission plateforme')).toBeNull();
  expect(screen.queryByText('Net perçu TTC')).toBeNull();
});
