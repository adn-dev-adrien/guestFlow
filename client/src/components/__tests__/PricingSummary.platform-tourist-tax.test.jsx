import React from 'react';
import { render, screen } from '@testing-library/react';

import PricingSummary from '../PricingSummary';

// specs/platform-tourist-tax-out-of-the-commission.md rule 13 — on a platform that collects the
// tourist tax AND remits it to the commune itself, the summary prints the WITHHELD amount, struck
// through: it enters neither what we collect nor our books, so it is there to be read, not counted.
// This revises per-platform-tourist-tax-three-way.md, which printed it plain on the grounds that the
// tax « isn't offert » — the strike does not say FREE, it says NOT OURS.
//
// Numbers: Gîtes de France, Grimaud #22225 — client 747,40 · taxe 14,40 · virement 668,00.

const FORM = {
  startDate: '2099-06-26', endDate: '2099-06-28', finalPrice: 733, customPrice: '',
  platform: 'Gîtes de France', touristTaxTotal: 0, depositAmount: 0, balanceAmount: 733,
  cautionAmount: 0, depositPaid: 0, balancePaid: 0, depositDisabled: false,
};

const BASE = {
  finalPrice: 733, totalStayPrice: 733, nights: 2, optionLines: [], resourceLines: [],
  touristTaxTotal: 0, touristTaxOriginalTotal: 14.40, complementAmount: 0,
};

function renderSummary(quote, form = FORM) {
  return render(
    <PricingSummary
      quote={quote}
      form={form}
      selectedProperty={{ name: 'Gîte' }}
      offeredOptionIds={new Set()}
      propertyOptions={[]}
      availableResources={[]}
      parsedTotalPrice={733}
      accommodationDiscountedPriceDisplay={'653.00'}
    />,
  );
}

test('rule 13 — the platform-handled tax is struck through, beside the « Plateforme » tag', () => {
  renderSummary({ ...BASE, touristTaxOfferedByPlatform: true, platformTouristTaxWithheld: 14.40 });

  expect(screen.getByText('Plateforme')).toBeInTheDocument();
  const amounts = screen.getAllByText('14,40 €');
  const struck = amounts.find((el) => window.getComputedStyle(el).textDecoration.includes('line-through'));
  expect(struck).toBeTruthy();
});

test('rule 13 — a tax we DO collect is never struck through', () => {
  // Owner-collect: the amount is real money we take at the door.
  renderSummary({
    ...BASE, touristTaxOfferedByPlatform: false, touristTaxCollectedOnArrival: true,
    touristTaxTotal: 14.40, complementAmount: 14.40,
  });

  const amounts = screen.getAllByText('14,40 €');
  const struck = amounts.find((el) => window.getComputedStyle(el).textDecoration.includes('line-through'));
  expect(struck).toBeFalsy();
});

test('rule 9 — the withheld figure is printed, not our estimate, when they differ', () => {
  // A Booking-style figure (4,4 % of the stay) that our per-person nightly estimate never produces.
  renderSummary({ ...BASE, touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 14.40, platformTouristTaxWithheld: 16.02 });

  expect(screen.getAllByText('16,02 €').length).toBeGreaterThan(0);
  expect(screen.queryByText('14,40 €')).not.toBeInTheDocument();
});

test('rule 9 — with an empty box the estimate is still what is printed', () => {
  renderSummary({ ...BASE, touristTaxOfferedByPlatform: true, platformTouristTaxWithheld: null });

  expect(screen.getAllByText('14,40 €').length).toBeGreaterThan(0);
});

test('rule 13 — the cascade deducts the withheld amount and lands on the statement’s own numbers', () => {
  // 747,40 (ce que le client a payé) − 14,40 (taxe plateforme) = 733,00 soumis à commission,
  // − 65,00 de commission = 668,00 de versement — le haut et le bas de la même colonne.
  renderSummary({
    ...BASE, touristTaxOfferedByPlatform: true, platformTouristTaxWithheld: 14.40,
    preArrivalAmount: 733, platformCommissionAmount: 65, totalPlatformCommission: 65,
    platformNetReceivedAmount: 668, sejourNetTotal: 668,
  });

  expect(screen.getByText('Total du séjour')).toBeInTheDocument();
  expect(screen.getByText('747,40 €')).toBeInTheDocument();
  expect(screen.getByText('Taxe de séjour (plateforme)')).toBeInTheDocument();
  expect(screen.getByText('− 14,40 €')).toBeInTheDocument();
  expect(screen.getByText('Montant soumis à commission')).toBeInTheDocument();
  expect(screen.getAllByText('733,00 €').length).toBeGreaterThan(0);
  expect(screen.getByText('− 65,00 €')).toBeInTheDocument();
  expect(screen.getByText('Versement plateforme')).toBeInTheDocument();
  expect(screen.getAllByText('668,00 €').length).toBeGreaterThan(0);
});
