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

test('platform with per-échéance commissions → brut + « Commission acompte »/« Commission solde », net perçu', () => {
  // total séjour 250, acompte commission 9 + solde commission 21 → net perçu 220 (engine-provided).
  renderSummary({ ...QUOTE, acompteCommissionAmount: 9, platformCommissionAmount: 21, totalPlatformCommission: 30, platformNetReceivedAmount: 220 });
  expect(screen.getByText('Total du séjour TTC (brut)')).toBeInTheDocument();
  expect(screen.getByText('250.00€')).toBeInTheDocument();
  expect(screen.getByText('Commission acompte')).toBeInTheDocument();
  expect(screen.getByText('− 9.00€')).toBeInTheDocument();
  expect(screen.getByText('Commission solde')).toBeInTheDocument();
  expect(screen.getByText('− 21.00€')).toBeInTheDocument();
  expect(screen.getByText('Net perçu TTC')).toBeInTheDocument();
  expect(screen.getByText('220.00€')).toBeInTheDocument();
});

test('solde-only commission → only the « Commission solde » line shows', () => {
  renderSummary({ ...QUOTE, acompteCommissionAmount: 0, platformCommissionAmount: 40, totalPlatformCommission: 40, platformNetReceivedAmount: 210 });
  expect(screen.getByText('Commission solde')).toBeInTheDocument();
  expect(screen.queryByText('Commission acompte')).toBeNull();
  expect(screen.getByText('210.00€')).toBeInTheDocument();
});

test('no commission → the plain « Total du séjour TTC » line (no deduction block)', () => {
  renderSummary({ ...QUOTE, platformCommissionAmount: 0, platformNetReceivedAmount: null });
  expect(screen.getByText('Total du séjour TTC')).toBeInTheDocument();
  expect(screen.queryByText('Commission acompte')).toBeNull();
  expect(screen.queryByText('Commission solde')).toBeNull();
  expect(screen.queryByText('Net perçu TTC')).toBeNull();
});
