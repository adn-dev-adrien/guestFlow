// specs/ui-review-2026-10-19-operations.md rule 11 — the sticky total bar below lg: renders the
// server's figure, opens the full detail in a sheet, steps aside while typing on a phone.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import StickyTotalBar from '../StickyTotalBar';
import { setViewport, resetViewport } from './viewportFixture';

afterEach(resetViewport);

const renderBar = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <input aria-label="Notes" />
    <StickyTotalBar label="Vous percevez" amount={829.42} secondary={{ label: 'Total du séjour', amount: 987.39 }} sheetTitle="Résumé tarifaire" {...props}>
      <p>Détail complet</p>
    </StickyTotalBar>
  </ThemeProvider>,
);

test('rule 11 — below lg the bar prints the figure it is given, with its second figure', () => {
  setViewport(390);
  renderBar();
  const bar = screen.getByTestId('sticky-total-bar');
  expect(bar).toHaveTextContent('Vous percevez');
  expect(bar).toHaveTextContent(/829,42/);
  expect(bar).toHaveTextContent('Total du séjour');
  expect(bar).toHaveTextContent(/987,39/);
  expect(getComputedStyle(bar).position).toBe('sticky');
});

test('rule 11 — from lg there is no bar (the summary column is sticky)', () => {
  setViewport(1280);
  renderBar();
  expect(screen.queryByTestId('sticky-total-bar')).toBeNull();
});

test('rule 11 — touching the bar opens the sheet with the full detail; its handle closes it', async () => {
  setViewport(900);
  const user = userEvent.setup();
  renderBar();
  expect(screen.queryByText('Détail complet')).toBeNull();
  await user.click(screen.getByTestId('sticky-total-bar'));
  expect(await screen.findByRole('dialog', { name: 'Résumé tarifaire' })).toBeInTheDocument();
  expect(screen.getByText('Détail complet')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Fermer le résumé tarifaire' }));
  await waitFor(() => expect(screen.queryByText('Détail complet')).toBeNull());
});

test('rule 11 — on a phone the bar steps aside while a text field has focus', () => {
  setViewport(390);
  renderBar();
  const bar = screen.getByTestId('sticky-total-bar');
  fireEvent.focusIn(screen.getByLabelText('Notes'));
  expect(bar.style.pointerEvents || getComputedStyle(bar).pointerEvents).toBe('none');
  fireEvent.focusOut(screen.getByLabelText('Notes'));
  expect(getComputedStyle(bar).pointerEvents).toBe('auto');
});
