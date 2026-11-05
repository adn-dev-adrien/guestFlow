// specs/accounting-synthesis.md §3 rules 23, 24 and 34 — « Comptabilité » opens on « Synthèse »; a journal link
// (month + year, the way back from a fiche) opens « Écritures », unchanged; the tabs count what the server counts;
// the CSV is offered where its month is chosen; a refused period keeps the bar and says why; the accountant reads all.
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
    getAccountingSales: vi.fn(() => Promise.resolve({ totals: { entriesCount: 0, allBalanced: true, totalDebits: 0, taxOnlyEntries: [] }, entries: [] })),
    getAccountingSynthesis: vi.fn(),
    downloadAccountingSalesCsv: vi.fn(),
    getToday: vi.fn(() => Promise.resolve({ today: '2099-11-05' })),
  },
}));
vi.mock('../../../hooks/useAuth', () => ({ __esModule: true, useAuth: vi.fn() }));

import api from '../../../api';
import { useAuth } from '../../../hooks/useAuth';
import AccountingPage from '../AccountingPage';

let location;
function Spy() { location = useLocation(); return null; }
const renderPage = (entry = '/comptabilite') => render(
  <MemoryRouter initialEntries={[entry]}>
    <ThemeProvider theme={theme}><DialogProvider>
      <Routes><Route path="/comptabilite" element={<><AccountingPage /><Spy /></>} /></Routes>
    </DialogProvider></ThemeProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  useAuth.mockReturnValue({ user: { id: 1, roles: ['admin'] } });
  api.getAccountingSynthesis.mockReset();
  api.getAccountingSynthesis.mockResolvedValue(synthesisPayload());
});

test('rule 23 — the page opens on « Synthèse », the other tabs counted by the server', async () => {
  renderPage();
  const tabs = screen.getByRole('tablist', { name: 'Vues de la comptabilité' });
  expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Synthèse', expect.stringMatching(/^Encaissements/), expect.stringMatching(/^Écritures/)]);
  expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent('Synthèse');
  await waitFor(() => expect(within(tabs).getByRole('tab', { name: /Encaissements 96/ })).toBeInTheDocument());
  expect(within(tabs).getByRole('tab', { name: /Écritures 131/ })).toBeInTheDocument();
  expect(await screen.findByText('Récapitulatif TVA à déclarer')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Télécharger le CSV des ventes' })).toBeNull();
  expect(api.getAccountingSynthesis).toHaveBeenCalledWith({ period: '', month: '', quarter: '', fiscalYear: '', from: '', to: '' });
});

test('rule 23 — a journal link opens « Écritures », with its CSV; the tab keeps the synthesis period in the URL', async () => {
  renderPage('/comptabilite?month=8&year=2099&p=quarter&sq=2099-Q3');
  expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(/^Écritures/);
  expect(screen.getByRole('button', { name: 'Télécharger le CSV des ventes' })).toBeInTheDocument();
  expect(await screen.findByText('Détail des écritures du mois')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: /^Encaissements/ }));
  expect(await screen.findByText('Encaissements par moyen de paiement')).toBeInTheDocument();
  expect(location.search).toContain('tab=encaissements');
  expect(location.search).toContain('sq=2099-Q3');
  expect(location.search).toContain('month=8');
  expect(api.getAccountingSynthesis).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'quarter', quarter: '2099-Q3' }));
});

test('rule 24 — a period picked is sent to the server and kept in the URL', async () => {
  renderPage();
  await screen.findByText('Récapitulatif TVA à déclarer');
  await userEvent.click(screen.getByRole('button', { name: 'Exercice' }));
  await waitFor(() => expect(api.getAccountingSynthesis).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'fy' })));
  expect(location.search).toContain('p=fy');
});

test('rule 24 — a refused period keeps the bar and the last figures, and says why', async () => {
  renderPage();
  await screen.findByText('Récapitulatif TVA à déclarer');
  api.getAccountingSynthesis.mockRejectedValueOnce(new Error('Période inconnue.'));
  await userEvent.click(screen.getByRole('button', { name: 'Mois' }));
  expect(await screen.findByText('Période inconnue.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Trimestre' })).toBeInTheDocument();
  expect(screen.getByText('Récapitulatif TVA à déclarer')).toBeInTheDocument();
});

test('rule 34 — the accountant reads every figure and check', async () => {
  useAuth.mockReturnValue({ user: { id: 2, roles: ['accountant'] } });
  renderPage();
  expect(await screen.findByText('Récapitulatif TVA à déclarer')).toBeInTheDocument();
  expect(screen.getAllByTestId('kpi-tile')).toHaveLength(4);
  expect(screen.getByTestId('check-settled')).toBeInTheDocument();
});
