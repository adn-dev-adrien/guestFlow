// specs/stay-profile.md §3 rules 13, 15 and 21 — the basket table: last year's and this year's average,
// the year-over-year pill or « — vs N-1 », the one notice, and the « hors taxe de séjour » source.
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getFinanceStayProfile: vi.fn(), getToday: vi.fn() } }));

import api from '../../api';
import StayProfilePage from '../StayProfilePage';
import { PROFILE, EMPTY_PROFILE, setupMatchMedia } from './stayProfileFixtures';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/finance/profil']}>
    <Routes><Route path="/finance/profil" element={<StayProfilePage />} /></Routes>
  </MemoryRouter>,
);
const text = (el) => el.textContent.replace(/\s/g, ' ');

beforeEach(() => {
  setupMatchMedia();
  api.getToday.mockReset().mockResolvedValue({ today: '2026-11-05' }); // date-literal-ok: a mocked server day
  api.getFinanceStayProfile.mockReset().mockResolvedValue(PROFILE);
});

test('rule 21 — one row per month the server lists, last year then this year, the pill from its change', async () => {
  renderPage();
  const july = await screen.findByTestId('basket-row-2026-07'); // date-literal-ok: a fixture key
  expect(screen.getByRole('columnheader', { name: '2025' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: '2026' })).toBeInTheDocument();
  expect(within(july).getByRole('rowheader')).toHaveTextContent('juil.');
  expect(within(july).getByTitle('juillet 2026')).toBeInTheDocument();
  const c = within(july).getAllByRole('cell').map(text);
  expect(c.slice(0, 2)).toEqual(['612 €', '688 €']);
  expect(c[2]).toBe('↑ +12,4 %');
  const august = within(screen.getByTestId('basket-row-2026-08')).getAllByRole('cell').map(text); // date-literal-ok: a fixture key
  expect(august).toEqual(['—', '500 €', '— vs N-1']);
});

test('rules 15 and 21 — the basket names its source, tourist tax excluded', async () => {
  renderPage();
  await screen.findByTestId('basket-row-2026-07'); // date-literal-ok: a fixture key
  expect(screen.getByText('Sur les montants des séjours, hors taxe de séjour.')).toBeInTheDocument();
  expect(screen.queryByRole('note')).toBeNull();
});

test('rule 13 — without a comparable year, the server\'s one notice; no row, its empty line', async () => {
  api.getFinanceStayProfile.mockResolvedValue(EMPTY_PROFILE);
  renderPage();
  expect(await screen.findByRole('note')).toHaveTextContent("Historique depuis avril 2026 : pas encore d'an dernier à comparer.");
  expect(screen.getByText("Aucun séjour sur l'exercice.")).toBeInTheDocument();
});
