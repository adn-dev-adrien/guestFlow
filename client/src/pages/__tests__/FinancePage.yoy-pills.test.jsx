// specs/finance-revpar-year-over-year.md §3 rules 15, 16 and 17 — the tiles and the hero figures carry
// their « i » and the year-over-year pill from `comparison.metrics`, RevPAR and the open nights join the
// hero, one notice says why or on how much the pills compare; an older payload renders as before.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn() },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { DASHBOARD } from './financePageFixtures';
import { COMPARED, NO_HISTORY } from './financeComparisonFixtures';

const renderPage = () => render(<MemoryRouter initialEntries={['/finance']}><FinancePage /></MemoryRouter>);

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(COMPARED);
  api.getFinanceDashboardDetail.mockReset().mockResolvedValue({});
  api.getVatFranchise.mockReset().mockResolvedValue(null);
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

const tileOf = async (label) => (await screen.findByRole('button', { name: `${label} : afficher le détail` })).parentElement;

test('rule 16 — « Déjà payé » and « Réservations » carry the server\'s change and last year\'s value', async () => {
  renderPage();
  const collected = await tileOf('Déjà payé');
  expect(collected).toHaveTextContent('↑ +44,4 %');
  // Rule 27 (D-HC14) — the fixture compares 8 months of 12: the pills stay short, the notice says it.
  expect(collected).toHaveTextContent('(N-1 : 20 534 €)');
  expect(collected).not.toHaveTextContent('sur 8 mois');
  expect(await tileOf('Réservations')).toHaveTextContent('(N-1 : 45 séjours)');
  for (const label of ['À encaisser', 'En retard', 'Logements', 'Canaux']) {
    expect(await tileOf(label)).not.toHaveTextContent('N-1');
  }
});

test('rule 16 — the hero: occupancy in points, RevPAR and open nights, « — vs N-1 » without a base', async () => {
  renderPage();
  const hero = await screen.findByRole('region', { name: "Chiffre d'affaires" });
  expect(hero).toHaveTextContent('↑ +10,9 pt');
  expect(hero).toHaveTextContent('(N-1 : 20,9 %)');
  expect(hero).not.toHaveTextContent('sur 8 mois');
  expect(hero).toHaveTextContent('↓ −4,3 %');
  expect(hero).toHaveTextContent('RevPAR · par nuit ouverte');
  expect(hero).toHaveTextContent('53,40 €');
  expect(hero).toHaveTextContent('579nuits ouvertes · dont 184 occupées');
  expect(within(hero).getByText('— vs N-1')).toBeInTheDocument();
});

test('rule 15 — each figure opens its definition, which names its source', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Définition : Déjà payé' }));
  expect(screen.getByRole('tooltip')).toHaveTextContent(/^Sur les montants des séjours : paiements déjà reçus/);
  fireEvent.click(screen.getByRole('button', { name: 'Définition : Déjà payé' }));
  fireEvent.click(screen.getByRole('button', { name: 'Définition : RevPAR · par nuit ouverte' }));
  expect(screen.getByRole('tooltip')).toHaveTextContent(/^Sur les montants des séjours : revenu des nuits de la période .* ÷ nuits ouvertes/);
});

test('rule 17 — one notice, the server\'s, under the hero', async () => {
  renderPage();
  const notes = await screen.findAllByRole('note');
  expect(notes).toHaveLength(1);
  expect(notes[0]).toHaveTextContent("Comparé à l'an dernier sur 8 mois sur 12 : les données commencent en mai 2025.");
  const hero = screen.getByRole('region', { name: "Chiffre d'affaires" });
  expect(hero.compareDocumentPosition(notes[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('rules 16 and 17 — no history: every pill reads « — vs N-1 » and the notice says why', async () => {
  api.getFinanceDashboard.mockResolvedValue(NO_HISTORY);
  renderPage();
  expect(await screen.findByRole('note')).toHaveTextContent("Pas de comparaison avec l'an dernier");
  expect(screen.getAllByText('— vs N-1')).toHaveLength(6);
  expect(screen.queryByText(/\(N-1 :/)).toBeNull();
});

test('rule 18 — an older payload renders as before: no pill, no « i », no notice', async () => {
  api.getFinanceDashboard.mockResolvedValue(DASHBOARD);
  renderPage();
  await screen.findByRole('button', { name: 'Déjà payé : afficher le détail' });
  expect(screen.queryByRole('button', { name: /^Définition/ })).toBeNull();
  expect(screen.queryByText(/N-1 :|— vs N-1/)).toBeNull();
  expect(screen.queryByRole('note')).toBeNull();
  expect(screen.queryByText('RevPAR · par nuit ouverte')).toBeNull();
});
