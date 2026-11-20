import React from 'react';
import { render, screen, within } from '@testing-library/react';

import PricingSummary from '../PricingSummary';

// specs/pricing-components.md §3 rule 15 (decision D12, mock M1) — the fiche's finance card prints « Total HT » then one VAT line
// per rate with its base, straight from the server's `vatByRate`; no « Total TVA » line and no sum in React. A « Sans TVA »
// stay prints the legal mention and no rate line.

const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 200, customPrice: '', platform: 'direct', touristTaxTotal: 0,
  depositAmount: 0, balanceAmount: 200, cautionAmount: 0, depositPaid: 0, balancePaid: 0, depositDisabled: false,
};
const QUOTE = { finalPrice: 200, totalStayPrice: 200, nights: 2, optionLines: [], resourceLines: [], touristTaxTotal: 0, totalNetPrice: 181.82, totalVatAmount: 18.18 };

const renderLive = (quote) => render(
  <PricingSummary quote={quote} form={FORM} selectedProperty={{ name: 'Villa A' }} offeredOptionIds={new Set()}
    propertyOptions={[]} availableResources={[]} parsedTotalPrice={200} accommodationDiscountedPriceDisplay="200.00" />,
);

test('one rate: a single line carries the rate, its base and its VAT', () => {
  renderLive({ ...QUOTE, vatByRate: [{ rate: 10, label: 'TVA 10 %', base: 181.82, vat: 18.18 }], vatRegime: { regime: 'subject', rate: 10 } });
  const lines = screen.getAllByTestId('vat-rate-line');
  expect(lines).toHaveLength(1);
  expect(lines[0]).toHaveTextContent(/TVA 10 %\s*sur 181,82\s*€/);
  expect(within(lines[0]).getByText(/18,18/)).toBeInTheDocument();
  expect(screen.queryByText(/Total TVA/)).not.toBeInTheDocument();
});

test('two rates: one line per rate in the server\'s order, each with its own base', () => {
  renderLive({
    ...QUOTE,
    vatByRate: [{ rate: 10, label: 'TVA 10 %', base: 100, vat: 10 }, { rate: 20, label: 'TVA 20 %', base: 75, vat: 15 }],
    vatRegime: { regime: 'subject', rate: 10 },
  });
  const lines = screen.getAllByTestId('vat-rate-line');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toHaveTextContent(/TVA 10 %\s*sur 100,00\s*€/);
  expect(lines[1]).toHaveTextContent(/TVA 20 %\s*sur 75,00\s*€/);
  expect(within(lines[1]).getByText(/15,00/)).toBeInTheDocument();
  expect(screen.getByText('Total HT')).toBeInTheDocument();
  expect(screen.queryByText(/Total TVA/)).not.toBeInTheDocument();
});

test('« Sans TVA »: the legal mention, no rate line, no Total HT', () => {
  renderLive({ ...QUOTE, vatByRate: [], vatRegime: { regime: 'not_subject', rate: 0, legalMentionText: 'TVA non applicable, art. 293 B du CGI' } });
  expect(screen.getByTestId('vat-mention')).toHaveTextContent('TVA non applicable');
  expect(screen.queryByTestId('vat-rate-line')).not.toBeInTheDocument();
  expect(screen.queryByText('Total HT')).not.toBeInTheDocument();
});
