// specs/plugins-phase-p-productisation.md rule 45 — the summary reads « platform sale » from the server:
// a channel counted as direct (Lodgify) shows the direct labels, whatever its name.
import React from 'react';
import { render, screen } from '@testing-library/react';
import PricingSummary from '../PricingSummary';

const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 600, customPrice: '', platform: 'Lodgify',
  touristTaxTotal: 0, depositAmount: 180, balanceAmount: 420, cautionAmount: 0, depositPaid: 0, balancePaid: 0,
};
const QUOTE = {
  finalPrice: 600, totalStayPrice: 600, nights: 2, optionLines: [], resourceLines: [], touristTaxTotal: 0,
  sejourNetTotal: 600, summaryCascade: { grossTotal: 600, offeredTaxDeduction: 0, onSiteTotal: 0, commissionBase: 600 },
};
const renderSummary = (quote) => render(
  <PricingSummary
    quote={quote} form={FORM} selectedProperty={{ name: 'Gîte' }} offeredOptionIds={new Set()}
    propertyOptions={[]} availableResources={[]} parsedTotalPrice={600} accommodationDiscountedPriceDisplay="600.00"
  />,
);

test('a counts-as-direct channel shows « Acompte » / « Solde », no platform cascade', () => {
  renderSummary({ ...QUOTE, platformSale: false });
  expect(screen.getByText('Acompte')).toBeInTheDocument();
  expect(screen.getByText('Solde')).toBeInTheDocument();
  expect(screen.queryByText('Versement plateforme')).toBeNull();
});

test('the same name answered as a platform sale shows the platform labels', () => {
  renderSummary({ ...QUOTE, platformSale: true });
  expect(screen.getByText('Montant solde payé par le client')).toBeInTheDocument();
});
