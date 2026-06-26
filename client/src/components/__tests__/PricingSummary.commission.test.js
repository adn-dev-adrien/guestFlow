import React from 'react';
import { render, screen } from '@testing-library/react';

import PricingSummary from '../PricingSummary';

// specs/fiche-total-sejour-net-of-commission.md — for a platform reservation with an operator-entered
// commission, the summary shows « Total du séjour TTC » = the engine net-of-commission total
// (quote.sejourNetTotal = net perçu + compléments), then « Montant soumis à commission » = the brut
// (quote.platformGrossAmount), the per-échéance commission deductions, and « Versement Plateforme »
// (renamed from « Net perçu TTC ») = quote.platformNetReceivedAmount. All figures engine-authoritative.

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

test('platform with per-échéance commissions → net total + « Montant soumis à commission » + « Versement Plateforme »', () => {
  // brut 250, acompte commission 9 + solde commission 21 → versement plateforme 220; with a 10 €
  // complement the engine net total (net perçu + compléments) is 230.
  renderSummary({ ...QUOTE, platformGrossAmount: 250, complementAmount: 10, sejourNetTotal: 230, acompteCommissionAmount: 9, platformCommissionAmount: 21, totalPlatformCommission: 30, platformNetReceivedAmount: 220 });
  expect(screen.getByText('Total du séjour TTC')).toBeInTheDocument();
  expect(screen.getByText('230.00€')).toBeInTheDocument(); // sejourNetTotal (net perçu + complément)
  expect(screen.getByText('Montant soumis à commission')).toBeInTheDocument();
  expect(screen.getByText('250.00€')).toBeInTheDocument(); // brut
  expect(screen.getByText('Commission acompte')).toBeInTheDocument();
  expect(screen.getByText('− 9.00€')).toBeInTheDocument();
  expect(screen.getByText('Commission solde')).toBeInTheDocument();
  expect(screen.getByText('− 21.00€')).toBeInTheDocument();
  expect(screen.getByText('Versement Plateforme')).toBeInTheDocument();
  expect(screen.getByText('220.00€')).toBeInTheDocument();
  // The old labels are gone.
  expect(screen.queryByText('Total du séjour TTC (brut)')).toBeNull();
  expect(screen.queryByText('Net perçu TTC')).toBeNull();
});

test('solde-only commission → only the « Commission solde » line shows', () => {
  renderSummary({ ...QUOTE, platformGrossAmount: 250, complementAmount: 5, sejourNetTotal: 215, acompteCommissionAmount: 0, platformCommissionAmount: 40, totalPlatformCommission: 40, platformNetReceivedAmount: 210 });
  expect(screen.getByText('Commission solde')).toBeInTheDocument();
  expect(screen.queryByText('Commission acompte')).toBeNull();
  expect(screen.getByText('215.00€')).toBeInTheDocument(); // net total
  expect(screen.getByText('210.00€')).toBeInTheDocument(); // versement plateforme
});

// specs/platform-per-echeance-commission.md — the Acompte / Solde lines show the NET amount (montant −
// la commission de cette échéance).
test('Acompte / Solde lines show the net amount (montant − commission de l\'échéance)', () => {
  render(
    <PricingSummary
      quote={{ ...QUOTE, finalPrice: 200, totalStayPrice: 200, acompteCommissionAmount: 3.41, platformCommissionAmount: 2.61, totalPlatformCommission: 6.02, platformNetReceivedAmount: 193.98 }}
      form={{ ...FORM, depositAmount: 60, balanceAmount: 140 }}
      selectedProperty={{ name: 'Villa A' }}
      offeredOptionIds={new Set()} propertyOptions={[]} availableResources={[]}
      parsedTotalPrice={200} accommodationDiscountedPriceDisplay={'200.00'}
    />
  );
  expect(screen.getByText('56.59€')).toBeInTheDocument();  // acompte 60 − 3.41
  expect(screen.getByText('137.39€')).toBeInTheDocument(); // solde 140 − 2.61
  expect(screen.getByText(/net de la commission acompte/i)).toBeInTheDocument();
  expect(screen.getByText(/net de la commission solde/i)).toBeInTheDocument();
});

test('no commission → the plain « Total du séjour TTC » line (no deduction block)', () => {
  renderSummary({ ...QUOTE, platformCommissionAmount: 0, platformNetReceivedAmount: null });
  expect(screen.getByText('Total du séjour TTC')).toBeInTheDocument();
  expect(screen.queryByText('Commission acompte')).toBeNull();
  expect(screen.queryByText('Commission solde')).toBeNull();
  expect(screen.queryByText('Versement Plateforme')).toBeNull();
  // No brut entered → no « Montant soumis à commission » line.
  expect(screen.queryByText('Montant soumis à commission')).toBeNull();
});
