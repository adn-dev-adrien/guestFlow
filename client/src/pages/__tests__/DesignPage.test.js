import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';

import theme from '../../theme';
import DesignPage from '../DesignPage';

// specs/design-system.md §3.8 — the /design showcase reads the REAL theme + REAL formatters, so this
// smoke test doubles as a token regression guard (palette « Maison », role variants, formats).

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DesignPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('renders the sections with live tokens and formats', () => {
  renderPage();
  expect(screen.getByText('Design system')).toBeInTheDocument();          // PageActionBar title
  expect(screen.getByText('Palette — « Maison »')).toBeInTheDocument();
  expect(screen.getAllByText('#2F5D46').length).toBeGreaterThan(0);       // primary hex from the REAL theme
  expect(screen.getByText('Typographie — rôles')).toBeInTheDocument();
  expect(screen.getAllByText('2 340,50 €').length).toBeGreaterThan(0);    // formatCurrency specimen
  expect(screen.getByText('1 235 €')).toBeInTheDocument();                // formatCurrencyRounded
  expect(screen.getByText('10/07/2026')).toBeInTheDocument();             // displayDate
});

test('the « Maison » theme carries the role variants and semantic soft tokens', () => {
  expect(theme.typography.pageTitle.fontFamily).toMatch(/Source Serif 4/);
  expect(theme.typography.kpiValue.fontVariantNumeric).toBe('tabular-nums');
  expect(theme.palette.success.soft).toBe('#E6EFE7');
  expect(theme.shape.borderRadius).toBe(14);
});
