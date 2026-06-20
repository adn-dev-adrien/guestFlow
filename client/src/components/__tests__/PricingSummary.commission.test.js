import React from 'react';
import { render, screen } from '@testing-library/react';

import PricingSummary from '../PricingSummary';

// specs/platform-commission-line.md — for a platform reservation with an operator-entered commission,
// the summary shows the BRUT = total séjour (nights + options + resources), deducts the commission, and
// surfaces the net perçu = total séjour − commission. Both figures are engine-authoritative
// (quote.platformCommissionAmount + quote.platformNetReceivedAmount), never re-derived here.

const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 200, customPrice: '',
  platform: 'airbnb', touristTaxTotal: 0, depositAmount: 0, balanceAmount: 200, cautionAmount: 0,
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

const QUOTE = { finalPrice: 250, totalStayPrice: 250, nights: 2, optionLines: [], resourceLines: [], touristTaxTotal: 0, touristTaxOriginalTotal: 0 };

test('platform reservation with a commission → brut = total séjour, « Commission plateforme », net perçu = total − commission', () => {
  // total séjour 250, commission 40 → net perçu 210 (engine-provided).
  renderSummary({ ...QUOTE, platformCommissionAmount: 40, platformNetReceivedAmount: 210 });
  expect(screen.getByText('Total du séjour TTC (brut)')).toBeInTheDocument();
  // Brut = the full total séjour (250), NOT total + commission.
  expect(screen.getByText('250.00€')).toBeInTheDocument();
  expect(screen.getByText('Commission plateforme')).toBeInTheDocument();
  expect(screen.getByText('− 40.00€')).toBeInTheDocument();
  expect(screen.getByText('Net perçu TTC')).toBeInTheDocument();
  // Net perçu = total séjour − commission = 210 (the unique deducted figure).
  expect(screen.getByText('210.00€')).toBeInTheDocument();
});

test('no commission → the plain « Total du séjour TTC » line (no deduction block)', () => {
  renderSummary({ ...QUOTE, platformCommissionAmount: 0, platformNetReceivedAmount: null });
  expect(screen.getByText('Total du séjour TTC')).toBeInTheDocument();
  expect(screen.queryByText('Commission plateforme')).toBeNull();
  expect(screen.queryByText('Net perçu TTC')).toBeNull();
});
