// specs/accounting-synthesis.md §3 rules 41, 43 and 52 — review of 2026-11-06: the « Écritures » badge counts the
// entries of the month that tab shows (D-HC13, R2-8, R5-06); a period refused on the first load leaves a way back
// to the current month, and pressing the shown kind again loads its default (R2-5).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';
import { synthesisPayload } from './synthesisFixtures';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getAccountingPlatforms: vi.fn(() => Promise.resolve({ rows: [], totalCommission: 0 })),
    getAccountingSales: vi.fn(),
    getAccountingSynthesis: vi.fn(),
    downloadAccountingSalesCsv: vi.fn(),
    getToday: vi.fn(() => Promise.resolve({ today: '2099-11-05' })),
  },
}));
vi.mock('../../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { id: 1, roles: ['admin'] } }) }));

import api from '../../../api';
import AccountingPage from '../AccountingPage';

let location;
function Spy() { location = useLocation(); return null; }
const renderPage = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <ThemeProvider theme={theme}><DialogProvider>
      <Routes><Route path="/comptabilite" element={<><AccountingPage /><Spy /></>} /></Routes>
    </DialogProvider></ThemeProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  api.getAccountingSynthesis.mockReset();
  api.getAccountingSales.mockReset();
  api.getAccountingSales.mockResolvedValue({ totals: { entriesCount: 7, allBalanced: true, totalDebits: 0, taxOnlyEntries: [] }, entries: [] });
});

test('rule 43 — « Écritures » counts the journal month it shows, not the synthesis window', async () => {
  api.getAccountingSynthesis.mockResolvedValue(synthesisPayload());
  renderPage('/comptabilite?month=8&year=2099');
  const tabs = screen.getByRole('tablist', { name: 'Vues de la comptabilité' });
  await waitFor(() => expect(within(tabs).getByRole('tab', { name: /Écritures 7/ })).toBeInTheDocument());
  expect(within(tabs).getByRole('tab', { name: /Encaissements 96/ })).toBeInTheDocument();
});

test('rule 41 — a period refused on the first load offers the current month, which loads', async () => {
  api.getAccountingSynthesis.mockRejectedValueOnce(new Error('Date trop lointaine : 5 ans au plus.'));
  api.getAccountingSynthesis.mockResolvedValue(synthesisPayload());
  renderPage('/comptabilite?p=month&sm=2199-12');
  expect(await screen.findByText('Date trop lointaine : 5 ans au plus.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Revenir au mois en cours' }));
  expect(await screen.findByText('Récapitulatif TVA à déclarer')).toBeInTheDocument();
  expect(location.search).not.toContain('sm=');
  expect(api.getAccountingSynthesis).toHaveBeenLastCalledWith(expect.objectContaining({ period: '', month: '' }));
});

test('rule 41 — pressing the kind already shown loads its default instead of doing nothing', async () => {
  api.getAccountingSynthesis.mockRejectedValueOnce(new Error('Période inconnue.'));
  api.getAccountingSynthesis.mockResolvedValue(synthesisPayload());
  renderPage('/comptabilite?p=month&sm=bad');
  await screen.findByText('Période inconnue.');
  await userEvent.click(screen.getByRole('button', { name: 'Mois' }));
  await waitFor(() => expect(api.getAccountingSynthesis).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'month', month: '' })));
});

test('rule 52 (V2-9) — no « Écritures » count while its month loads, nor after it failed', async () => {
  api.getAccountingSynthesis.mockResolvedValue(synthesisPayload());
  api.getAccountingSales.mockReturnValue(new Promise(() => {}));
  const { unmount } = renderPage('/comptabilite?month=8&year=2099');
  const tab = () => within(screen.getByRole('tablist', { name: 'Vues de la comptabilité' })).getByRole('tab', { name: /^Écritures/ });
  await waitFor(() => expect(screen.getByRole('tab', { name: /Encaissements 96/ })).toBeInTheDocument());
  expect(tab()).toHaveTextContent(/^Écritures$/);
  unmount();
  api.getAccountingSales.mockReset();
  api.getAccountingSales.mockRejectedValue(new Error('boom'));
  renderPage('/comptabilite?month=8&year=2099');
  await screen.findByText("Impossible de charger l'aperçu comptable.");
  expect(tab()).toHaveTextContent(/^Écritures$/);
});
