// specs/tariff-recipes/spec.md §3 rule 59 — a night no season covers is priced by default; the summary
// says so, from the server's `unpricedNights`.
import React from 'react';
import { render, screen } from '@testing-library/react';
import PricingSummary from '../PricingSummary';

const FORM = {
  startDate: '2026-05-30', endDate: '2026-06-02', finalPrice: 460, customPrice: '', platform: 'direct',
  touristTaxTotal: 0, depositAmount: 138, balanceAmount: 322, cautionAmount: 0, depositPaid: 0, balancePaid: 0,
};
const QUOTE = {
  finalPrice: 460, totalStayPrice: 460, nights: 3, optionLines: [], resourceLines: [], touristTaxTotal: 0,
  platformSale: false, sejourNetTotal: 460,
  summaryCascade: { grossTotal: 460, offeredTaxDeduction: 0, onSiteTotal: 0, commissionBase: 460 },
};
const renderSummary = (quote) => render(
  <PricingSummary
    quote={quote} form={FORM} selectedProperty={{ name: 'Gîte' }} offeredOptionIds={new Set()}
    propertyOptions={[]} availableResources={[]} parsedTotalPrice={460} accommodationDiscountedPriceDisplay="460.00"
  />,
);

test('a night without a season is named under the accommodation price', () => {
  renderSummary({ ...QUOTE, unpricedNights: ['2026-06-01'] });
  expect(screen.getByRole('alert')).toHaveTextContent('Aucune saison tarifaire ne couvre la nuit du 01/06/2026.');
});

test('several nights read in the plural', () => {
  renderSummary({ ...QUOTE, unpricedNights: ['2026-06-01', '2026-06-02'] });
  expect(screen.getByRole('alert')).toHaveTextContent('les nuits du 01/06/2026, 02/06/2026');
});

test('every night covered: no warning', () => {
  renderSummary({ ...QUOTE, unpricedNights: [] });
  expect(screen.queryByText(/Aucune saison tarifaire/)).toBeNull();
});
