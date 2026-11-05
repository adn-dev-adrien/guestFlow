// specs/stay-profile.md §3 rules 16, 19 and 20 — the breakdown panel: the server's rows in a share
// table, the « Découpage » and « Mesure » switches, the caption naming the window and the source, and
// the empty window.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
const cells = (key) => within(screen.getByTestId(`share-row-${key}`)).getAllByRole('cell').map((c) => c.textContent.replace(/\s/g, ' '));

beforeEach(() => {
  setupMatchMedia();
  api.getToday.mockReset().mockResolvedValue({ today: '2026-11-05' }); // date-literal-ok: a mocked server day
  api.getFinanceStayProfile.mockReset().mockResolvedValue(PROFILE);
});

test('rule 19 — the channel rows, ranked by the server, count and amount with the count share', async () => {
  renderPage();
  expect(await screen.findByTestId('share-row-direct')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Répartition des séjours' })).toBeInTheDocument();
  const rows = screen.getAllByTestId(/^share-row-/).map((r) => r.getAttribute('data-testid'));
  expect(rows).toEqual(['share-row-direct', 'share-row-platform:airbnb']);
  expect(cells('direct')).toEqual(['1', '1 200 €', '25 %']);
  expect(screen.getByTestId('share-segment-direct')).toHaveStyle({ width: '25%' });
});

test('rule 19 — « Montant » switches the share and the bar to the amount', async () => {
  renderPage();
  await screen.findByTestId('share-row-direct');
  fireEvent.click(screen.getByRole('button', { name: 'Montant' }));
  expect(cells('direct')).toEqual(['1', '1 200 €', '60 %']);
  expect(screen.getByTestId('share-segment-platform:airbnb')).toHaveStyle({ width: '40%' });
});

test('rule 19 — « Durée » shows the length buckets; a 0 share keeps its row and draws no segment', async () => {
  renderPage();
  await screen.findByTestId('share-row-direct');
  fireEvent.click(screen.getByRole('button', { name: 'Durée' }));
  expect(screen.getByRole('columnheader', { name: 'Durée' })).toBeInTheDocument();
  expect(screen.getAllByTestId(/^share-row-/)).toHaveLength(4);
  expect(screen.queryByTestId('share-segment-n3-4')).toBeNull();
});

test('rule 20 — the caption names the stays, the window and the source of the figures', async () => {
  renderPage();
  await screen.findByTestId('share-row-direct');
  expect(screen.getByText(/4 séjours · Exercice 2026, séjours non annulés\. Sur les montants des séjours\./)).toBeInTheDocument();
});

test('rule 16 — the share widths are the server\'s 0–1 shares, never recomputed', async () => {
  api.getFinanceStayProfile.mockResolvedValue({
    ...PROFILE,
    dimensions: PROFILE.dimensions.map((d) => (d.key !== 'channel' ? d : { ...d, rows: d.rows.map((r) => ({ ...r, countShare: r.key === 'direct' ? 0.34 : 0.66 })) })),
  });
  renderPage();
  await screen.findByTestId('share-row-direct');
  expect(screen.getByTestId('share-segment-direct')).toHaveStyle({ width: '34%' });
});

test('rule 20 — an empty window says so and keeps the switches and the basket', async () => {
  api.getFinanceStayProfile.mockResolvedValue(EMPTY_PROFILE);
  renderPage();
  expect(await screen.findByText('Aucun séjour sur la période.')).toBeInTheDocument();
  expect(screen.queryByTestId(/^share-row-/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Canal' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Panier moyen par séjour' })).toBeInTheDocument();
});
