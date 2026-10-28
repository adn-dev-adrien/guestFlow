// specs/property-deposit-switch.md rule 14 — the « Annulation » helper follows the acompte switch: with no
// acompte there is no acompte to keep, the cancellation follows the CGV.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../../theme';
import PropertyPaymentTab from '../PropertyPaymentTab';

const renderTab = (depositEnabled) => render(
  <ThemeProvider theme={theme}>
    <PropertyPaymentTab form={{ depositEnabled, cancelAfterBalanceDueDays: 7 }} updateField={vi.fn()} onZeroFocus={vi.fn()} />
  </ThemeProvider>,
);

test('acompte on: the kept acompte is the indemnity', () => {
  renderTab(1);
  expect(screen.getByText(/L'acompte encaissé est alors conservé à titre d'indemnité\./)).toBeInTheDocument();
});

test('acompte off: no acompte to keep, the CGV apply', () => {
  renderTab(0);
  expect(screen.getByText(/Sans acompte, l'annulation suit les conditions des CGV\./)).toBeInTheDocument();
  expect(screen.queryByText(/conservé à titre d'indemnité/)).not.toBeInTheDocument();
});
