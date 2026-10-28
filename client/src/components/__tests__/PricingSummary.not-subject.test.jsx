import React from 'react';
import { render, screen } from '@testing-library/react';

import PricingSummary from '../PricingSummary';
import StoredPricingSummary from '../reservation/StoredPricingSummary';
import FinanceHero from '../FinanceHero';
import FinanceDetailPanel from '../FinanceDetailPanel';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

// specs/vat-optional-mode.md rule 12 (a) and (d) — « Sans TVA »: the VAT lines of the résumé tarifaire give
// way to the server's legal mention (live and stored), and the finance hero drops its HT figure when the
// server says it means nothing (`showHt`).

const MENTION = 'TVA non applicable, art. 293 B du CGI';
const FORM = {
  startDate: '2099-09-15', endDate: '2099-09-17', finalPrice: 200, customPrice: '', platform: 'direct', touristTaxTotal: 0,
  depositAmount: 0, balanceAmount: 200, cautionAmount: 0, depositPaid: 0, balancePaid: 0, depositDisabled: false,
};
const QUOTE = { finalPrice: 200, totalStayPrice: 200, nights: 2, optionLines: [], resourceLines: [], touristTaxTotal: 0, totalNetPrice: 200, totalVatAmount: 0 };

const renderLive = (quote) => render(
  <PricingSummary quote={quote} form={FORM} selectedProperty={{ name: 'Villa A' }} offeredOptionIds={new Set()}
    propertyOptions={[]} availableResources={[]} parsedTotalPrice={200} accommodationDiscountedPriceDisplay="200.00" />,
);

test('rule 12 (a): a live quote under VAT keeps « Total HT » and « TVA x % »', () => {
  renderLive({ ...QUOTE, vatPercentageAccommodation: 10, totalNetPrice: 181.82, totalVatAmount: 18.18, vatRegime: { regime: 'subject', rate: 10 } });
  expect(screen.getByText('Total HT')).toBeInTheDocument();
  expect(screen.getByText('TVA 10%')).toBeInTheDocument();
  expect(screen.queryByTestId('vat-mention')).not.toBeInTheDocument();
});

test('rule 12 (a): a live « Sans TVA » quote shows the mention alone, the server\'s text', () => {
  renderLive({ ...QUOTE, vatPercentageAccommodation: 0, vatRegime: { regime: 'not_subject', rate: 0, legalMentionText: MENTION } });
  expect(screen.getByTestId('vat-mention')).toHaveTextContent(MENTION);
  expect(screen.queryByText('Total HT')).not.toBeInTheDocument();
  expect(screen.queryByText(/^TVA \d/)).not.toBeInTheDocument();
});

test('rule 12 (a): the stored summary does the same, and keeps its figures', () => {
  const summary = { accommodation: 200, totalStayPrice: 200, depositAmount: 0, balanceAmount: 200, vatRate: 0, totalVatAmount: 0, totalNetPrice: 200, vatRegime: { regime: 'not_subject', legalMentionText: MENTION } };
  render(<StoredPricingSummary summary={summary} form={FORM} propertyLabel="Villa A" isPlatform={false} />);
  expect(screen.getByTestId('vat-mention')).toHaveTextContent(MENTION);
  expect(screen.queryByText('Total HT')).not.toBeInTheDocument();
  expect(screen.getByText('Total du séjour')).toBeInTheDocument();
});

test('rule 12 (a): the stored summary under VAT keeps its HT and VAT rows', () => {
  const summary = { accommodation: 200, totalStayPrice: 200, depositAmount: 0, balanceAmount: 200, vatRate: 10, totalVatAmount: 18.18, totalNetPrice: 181.82, vatRegime: { regime: 'subject' } };
  render(<StoredPricingSummary summary={summary} form={FORM} propertyLabel="Villa A" isPlatform={false} />);
  expect(screen.getByText('Total HT')).toBeInTheDocument();
  expect(screen.getByText('TVA 10%')).toBeInTheDocument();
});

const FORMAT = { amount: (n) => `${n} €`, date: (d) => d, percent: (n) => `${n}` };
const HERO = { revenue: 1000, revenueHt: 900, stays: 3, nights: 12, occupancy: 0.5, revenuePerNight: 80, directShare: 0.4, curveCompact: true, cumulative: [], axis: [], yoy: null, goal: null };

test('rule 12 (d): the finance hero shows its HT figure while the server says it means something', () => {
  render(<FinanceHero hero={HERO} showHt windowLabel="2027" fiscalYearLabel="2027" format={FORMAT} />);
  expect(screen.getByText(/900 € HT/)).toBeInTheDocument();
});

test('rule 12 (d): the finance hero drops the HT figure when showHt is false', () => {
  render(<FinanceHero hero={HERO} showHt={false} windowLabel="2027" fiscalYearLabel="2027" format={FORMAT} />);
  expect(screen.queryByText(/HT/)).not.toBeInTheDocument();
  expect(screen.getByText(/net de commissions · 3 séjours/)).toBeInTheDocument();
});

const PROPERTIES = (showHt) => ({
  showHt,
  rows: [{ propertyId: 1, name: 'Le Gîte', colorIndex: 0, nights: 5, occupancy: 0.5, revenuePerNight: 100, revPar: 50, revenue: 500, revenueHt: 454, change: null }],
  totals: { nights: 5, occupancy: 0.5, revenuePerNight: 100, revPar: 50, revenue: 500, revenueHt: 454 }, comparableMonths: null,
});
const drawProperties = (data) => render(
  <ThemeProvider theme={theme}><FinanceDetailPanel id="p" tile="properties" data={data} windowLabel="2027" onClose={() => {}} onOpenReservation={() => {}} onSelectProperty={() => {}} /></ThemeProvider>,
);

test('rule 12 (d): the properties table has its TTC and HT columns while HT means something', () => {
  drawProperties(PROPERTIES(true));
  expect(screen.getByRole('columnheader', { name: 'TTC' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'HT' })).toBeInTheDocument();
});

test('rule 12 (d): the properties table drops the HT column, and TTC reads « Revenu », when showHt is false', () => {
  drawProperties(PROPERTIES(false));
  expect(screen.queryByRole('columnheader', { name: 'HT' })).toBeNull();
  expect(screen.queryByRole('columnheader', { name: 'TTC' })).toBeNull();
  expect(screen.getByRole('columnheader', { name: 'Revenu' })).toBeInTheDocument();
});
