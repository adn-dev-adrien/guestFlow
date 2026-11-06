// specs/accounting-synthesis.md §3 rule 45b — a check that does not hold says so in its title, not
// only by the colour of its dot; its « voir » is a 44 px target on touch.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import AccountingSynthesisTab from '../AccountingSynthesisTab';
import { synthesisPayload } from './synthesisFixtures';

const renderTab = (data) => render(
  <ThemeProvider theme={theme}><MemoryRouter>
    <AccountingSynthesisTab data={data} canOpenReservation onOpenEntriesMonth={() => {}} />
  </MemoryRouter></ThemeProvider>,
);

test('rule 45b — failing checks are titled by what fails', () => {
  const data = synthesisPayload();
  data.checks.balanced = { ...data.checks.balanced, status: 'gap', unbalanced: [{ key: 'x' }] };
  renderTab(data);
  expect(within(screen.getByTestId('check-balanced')).getByText('Écritures déséquilibrées')).toBeInTheDocument();
  expect(within(screen.getByTestId('check-vat')).getByText('Écart de TVA')).toBeInTheDocument();
  expect(within(screen.getByTestId('check-settled')).getByText('Séjours non soldés')).toBeInTheDocument();
});

test('rule 45b — holding checks, and a rounding gap, keep their plain titles', () => {
  const data = synthesisPayload();
  data.checks.vatCoherence = { source: 'collections', status: 'rounding', roundingCents: 3, entries: [] };
  data.checks.settled = { source: 'stays', status: 'ok', count: 0, stays: [] };
  renderTab(data);
  expect(within(screen.getByTestId('check-balanced')).getByText('Écritures équilibrées')).toBeInTheDocument();
  expect(within(screen.getByTestId('check-vat')).getByText('TVA cohérente')).toBeInTheDocument();
  expect(within(screen.getByTestId('check-settled')).getByText('Séjours terminés soldés')).toBeInTheDocument();
});

test('rule 45b — « voir » is 44 px tall on touch', () => {
  renderTab(synthesisPayload());
  const button = within(screen.getByTestId('check-settled')).getByRole('button', { name: 'voir' });
  const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
  const cls = Array.from(button.classList).find((c) => c.startsWith('css-'));
  expect(css).toMatch(new RegExp(`@media \\(pointer: coarse\\)\\{\\.${cls}\\{min-height:44px;`));
});
