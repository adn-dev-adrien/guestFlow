// Tourist tax of added guests — specs/platform-added-guests-tourist-tax.md rule 14.
// Its own line, in the complement, never offered: a debt to the commune.
import React from 'react';
import { render, screen } from '@testing-library/react';
import PricingSummary from '../PricingSummary';

const QUOTE = {
  nights: 2, nightlyBreakdown: [], totalPrice: 600, finalPrice: 595.2, optionLines: [], resourceLines: [],
  touristTaxTotal: 7.2, touristTaxReversedByPlatform: true, touristTaxAddedGuestsAmount: 2.4,
};

test('the added tax has its own line, with no « Offrir »', () => {
  render(<PricingSummary quote={QUOTE} form={{}} />);
  expect(screen.getByText('Complément de taxe de séjour')).toBeInTheDocument();
  expect(screen.getByText('Comprise dans la taxe ci-dessus')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Offrir' })).not.toBeInTheDocument();
});

test('no added tax, no line', () => {
  render(<PricingSummary quote={{ ...QUOTE, touristTaxAddedGuestsAmount: 0 }} form={{}} />);
  expect(screen.queryByText('Complément de taxe de séjour')).not.toBeInTheDocument();
});
