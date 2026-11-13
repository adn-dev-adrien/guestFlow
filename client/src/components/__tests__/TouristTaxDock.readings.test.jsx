// specs/tourist-tax-report-v2.md rule 59 (verification of 2026-11-12) — the banner reads what is there: « rien à déclarer »
// instead of « sur 0,00 € au total », singular counts in the singular, the numbers of the taxed pill in bold.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import TouristTaxDock from '../TouristTaxDock';

const TOTALS = {
  staysCount: 1, persons: 1, taxedPersons: 1, exemptPersons: 0, taxedPersonNights: 1, amount: 0, declaredAmount: 0, remainingAmount: 0,
  allDeclared: false, platformRemittedStaysCount: 0, platformRemittedAmount: 0,
};
const dock = (over) => render(<ThemeProvider theme={theme}><TouristTaxDock totals={{ ...TOTALS, ...over }} windowLabel="juin 2026" /></ThemeProvider>);

test('nothing taxed says so instead of « sur 0,00 € au total »', () => {
  dock({});
  expect(screen.getByText('rien à déclarer sur cette période')).toBeInTheDocument();
  expect(screen.queryByText(/au total/)).toBeNull();
});

test('counts of one read in the singular, counts of several in the plural', () => {
  dock({ amount: 4.8, remainingAmount: 4.8 });
  expect(screen.getByTestId('total-personNights')).toHaveTextContent('1 nuitée taxée');
  expect(screen.getByTestId('total-persons')).toHaveTextContent('1 personne');
  expect(screen.getByTestId('total-taxed')).toHaveTextContent('1 taxée · 0 exonérée');
});

test('the numbers of the taxed pill are bold', () => {
  dock({ amount: 4.8, remainingAmount: 4.8, taxedPersons: 3, exemptPersons: 2 });
  const bold = [...screen.getByTestId('total-taxed').querySelectorAll('b')].map((b) => b.textContent);
  expect(bold).toEqual(['3', '2']);
});
