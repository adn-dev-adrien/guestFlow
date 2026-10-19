// specs/shell-and-home-day-first.md rules 23-24 — on a phone, a page bar with no back button, subtitle
// nor tabs and a single button hands that button to the top bar instead of drawing a nearly empty
// band; a bar with a wrapped subtitle keeps its actions level with the back button.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import SyncIcon from '@mui/icons-material/Sync';
import { vi } from 'vitest';
import theme from '../../theme';
import PageActionBar from '../PageActionBar';
import { PageTitleProvider, TopBarActionSlot } from '../../hooks/usePageTitle';
import { setViewport, resetViewport } from './viewportFixture';
import { valueUnder } from './mediaRulesFixture';

afterEach(resetViewport);

const Shell = ({ children }) => (
  <MemoryRouter>
    <ThemeProvider theme={theme}>
      <PageTitleProvider>
        <header data-testid="top"><TopBarActionSlot /></header>
        <main data-testid="page">{children}</main>
      </PageTitleProvider>
    </ThemeProvider>
  </MemoryRouter>
);

const refresh = (onClick) => ({ icon: <SyncIcon />, tooltip: 'Actualiser', onClick, color: 'info' });

test('rule 23: on a phone the single action moves to the top bar; no band is drawn', async () => {
  setViewport(390);
  const onClick = vi.fn();
  render(<Shell><PageActionBar title="Suivi financier" actionsBefore={[refresh(onClick)]} /></Shell>);
  const button = await within(screen.getByTestId('top')).findByRole('button', { name: 'Actualiser' });
  expect(within(screen.getByTestId('page')).queryByTestId('page-action-bar-row')).toBeNull();
  await userEvent.setup().click(button);
  expect(onClick).toHaveBeenCalled();
});

test('rule 23: three actions fold into « Plus d’actions », which goes to the top bar too', async () => {
  setViewport(390);
  const a = [refresh(vi.fn()), { ...refresh(vi.fn()), tooltip: 'Mois précédent' }, { ...refresh(vi.fn()), tooltip: 'Mois suivant' }];
  render(<Shell><PageActionBar title="Calendrier" actionsBefore={a} /></Shell>);
  expect(await within(screen.getByTestId('top')).findByRole('button', { name: 'Plus d\'actions' })).toBeInTheDocument();
});

test('rule 23: a back button, a second button or a desktop keeps the page bar', () => {
  setViewport(390);
  const { unmount } = render(<Shell><PageActionBar title="Réglage" backTo="/settings" actionsBefore={[refresh(vi.fn())]} /></Shell>);
  expect(within(screen.getByTestId('page')).getByTestId('page-action-bar-row')).toBeInTheDocument();
  unmount();
  const second = render(<Shell><PageActionBar title="Réglage" onSave={vi.fn()} onCancel={vi.fn()} /></Shell>);
  expect(within(screen.getByTestId('page')).getByTestId('page-action-bar-row')).toBeInTheDocument();
  second.unmount();
  setViewport(1280);
  render(<Shell><PageActionBar title="Suivi financier" actionsBefore={[refresh(vi.fn())]} /></Shell>);
  expect(within(screen.getByTestId('page')).getByRole('button', { name: 'Actualiser' })).toBeInTheDocument();
  expect(within(screen.getByTestId('top')).queryByRole('button')).toBeNull();
});

test('rule 24: on a phone the actions align with the back button, not the middle of a wrapped subtitle', () => {
  setViewport(390);
  render(<Shell><PageActionBar title="Intégrations" backTo="/settings" subtitle={<span>Dernière mise à jour : hier</span>} onSave={vi.fn()} onCancel={vi.fn()} /></Shell>);
  const row = screen.getByTestId('page-action-bar-row');
  expect(valueUnder(row, 'align-items', 'min-width:0px')).toBe('flex-start');
  expect(valueUnder(row, 'align-items', 'min-width:600px')).toBe('center');
});
