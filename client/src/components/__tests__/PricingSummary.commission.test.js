import React from 'react';
import { render, screen } from '@testing-library/react';

import PricingSummary from '../PricingSummary';

// specs/platform-offered-tax-passthrough-and-cascade.md — the bottom of the summary is a running
// cascade: « Total du séjour » (gross = hébergement + toutes options/ressources + taxe) → deduct the
// tax the platform remits to the commune (offered) + the on-site compléments → « Montant soumis à
// commission » → − commission → « Versement plateforme » → + compléments → « Total perçu sur le
// séjour ». All figures engine-authoritative.

const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 200, customPrice: '',
  platform: 'airbnb', touristTaxTotal: 0, depositAmount: 0, balanceAmount: 200, cautionAmount: 0,
  depositPaid: 0, balancePaid: 0, depositDisabled: false,
};

function renderSummary(quote, form = FORM) {
  return render(
    <PricingSummary
      quote={quote}
      form={form}
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

test('full cascade: offered tax + complement + commission', () => {
  // gross 274.60 (finalPrice 265 + tax 9.60) − taxe 9.60 (→ commune) − compléments 15 = 250 (soumis à
  // commission) ; − 30 commission = 220 (versement) ; + 15 compléments = 235 (total perçu).
  renderSummary({
    ...QUOTE, finalPrice: 265, touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 9.60,
    complementAmount: 15, preArrivalAmount: 250, platformCommissionAmount: 30, totalPlatformCommission: 30,
    platformNetReceivedAmount: 220, sejourNetTotal: 235,
  });
  expect(screen.getByText('Total du séjour')).toBeInTheDocument();
  expect(screen.getByText('274,60 €')).toBeInTheDocument();           // gross
  expect(screen.getByText('Taxe de séjour (plateforme)')).toBeInTheDocument();
  expect(screen.getByText('− 9,60 €')).toBeInTheDocument();           // tax → commune
  expect(screen.getAllByText('Compléments (perçus sur place)').length).toBe(2); // − then +
  expect(screen.getByText('− 15,00 €')).toBeInTheDocument();
  expect(screen.getByText('+ 15,00 €')).toBeInTheDocument();
  expect(screen.getByText('Montant soumis à commission')).toBeInTheDocument();
  expect(screen.getByText('250,00 €')).toBeInTheDocument();
  expect(screen.getByText('Commission solde')).toBeInTheDocument();
  expect(screen.getByText('− 30,00 €')).toBeInTheDocument();
  expect(screen.getByText('Versement plateforme')).toBeInTheDocument();
  expect(screen.getByText('220,00 €')).toBeInTheDocument();
  expect(screen.getByText('Total perçu sur le séjour')).toBeInTheDocument();
  expect(screen.getByText('235,00 €')).toBeInTheDocument();
  // The old #302 labels are gone.
  expect(screen.queryByText('Versement Plateforme')).toBeNull(); // capital P (the old label)
  expect(screen.queryByText('Net perçu TTC')).toBeNull();
});

test('offered tax, no complement → « − Taxe de séjour (plateforme) » then « Montant soumis à commission »', () => {
  renderSummary({
    ...QUOTE, finalPrice: 200, touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 4.80,
    complementAmount: 0, preArrivalAmount: 195.20, platformCommissionAmount: 30, totalPlatformCommission: 30,
    platformNetReceivedAmount: 165.20, sejourNetTotal: 165.20,
  });
  expect(screen.getByText('204,80 €')).toBeInTheDocument();           // gross = 200 + 4.80
  expect(screen.getByText('Taxe de séjour (plateforme)')).toBeInTheDocument();
  expect(screen.getByText('− 4,80 €')).toBeInTheDocument();
  expect(screen.getByText('Montant soumis à commission')).toBeInTheDocument();
  expect(screen.getByText('195,20 €')).toBeInTheDocument();
  expect(screen.queryByText('Compléments (perçus sur place)')).toBeNull(); // no complement
});

test('platform with commission, no tax/complement → no deduction sub-lines, just Versement + Total perçu', () => {
  renderSummary({
    ...QUOTE, finalPrice: 250, touristTaxOriginalTotal: 0, complementAmount: 0, preArrivalAmount: 250,
    acompteCommissionAmount: 9, platformCommissionAmount: 21, totalPlatformCommission: 30, platformNetReceivedAmount: 220, sejourNetTotal: 220,
  });
  expect(screen.getByText('Total du séjour')).toBeInTheDocument();
  // No tax / complement deduction → no « Montant soumis à commission » intermediate line.
  expect(screen.queryByText('Montant soumis à commission')).toBeNull();
  expect(screen.queryByText('Taxe de séjour (plateforme)')).toBeNull();
  expect(screen.getByText('Commission acompte')).toBeInTheDocument();
  expect(screen.getByText('− 9,00 €')).toBeInTheDocument();
  expect(screen.getByText('Commission solde')).toBeInTheDocument();
  expect(screen.getByText('− 21,00 €')).toBeInTheDocument();
  expect(screen.getByText('Versement plateforme')).toBeInTheDocument();
  expect(screen.getByText('Total perçu sur le séjour')).toBeInTheDocument();
});

test('non-offered platform → NO « Taxe de séjour (plateforme) » deduction line', () => {
  renderSummary({
    ...QUOTE, finalPrice: 250, touristTaxOfferedByPlatform: false, touristTaxOriginalTotal: 12, touristTaxTotal: 12,
    complementAmount: 0, preArrivalAmount: 262, platformCommissionAmount: 30, totalPlatformCommission: 30, platformNetReceivedAmount: 232, sejourNetTotal: 232,
  });
  expect(screen.queryByText('Taxe de séjour (plateforme)')).toBeNull();
  expect(screen.queryByText('− 12,00 €')).toBeNull();
});

// specs/platform-per-echeance-commission.md — the Acompte / Solde lines show the NET amount (montant −
// la commission de cette échéance). Unaffected by the cascade.
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
  expect(screen.getByText('56,59 €')).toBeInTheDocument();  // acompte 60 − 3.41
  expect(screen.getByText('137,39 €')).toBeInTheDocument(); // solde 140 − 2.61
  expect(screen.getByText(/net de la commission acompte/i)).toBeInTheDocument();
  expect(screen.getByText(/net de la commission solde/i)).toBeInTheDocument();
});

test('direct reservation → a single « Total du séjour », no platform cascade', () => {
  renderSummary(
    { ...QUOTE, finalPrice: 250, touristTaxTotal: 10, touristTaxOriginalTotal: 10, complementAmount: 0, sejourNetTotal: 260 },
    { ...FORM, platform: 'direct' }
  );
  expect(screen.getByText('Total du séjour')).toBeInTheDocument();
  expect(screen.getByText('260,00 €')).toBeInTheDocument(); // 250 + 10 tax
  expect(screen.queryByText('Montant soumis à commission')).toBeNull();
  expect(screen.queryByText('Versement plateforme')).toBeNull();
  expect(screen.queryByText('Total perçu sur le séjour')).toBeNull();
});
