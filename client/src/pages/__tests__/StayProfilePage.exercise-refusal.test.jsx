// specs/stay-profile.md §3 rule 31 — a refused exercise (`UNKNOWN_EXERCISE`, D-HC16) keeps the page alive and
// offers « Exercice en cours », which asks again without the exercise; another refusal does not offer it.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getFinanceStayProfile: vi.fn(), getToday: vi.fn() } }));

import api from '../../api';
import StayProfilePage from '../StayProfilePage';
import { PROFILE, setupMatchMedia } from './stayProfileFixtures';
import { localIsoToday } from '../../utils/isoDay';

const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/finance/profil" element={<StayProfilePage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  setupMatchMedia();
  api.getToday.mockReset().mockResolvedValue({ today: localIsoToday() });
});

test('rule 31 — « Exercice inconnu. » with its code offers the current exercise, then asks without it', async () => {
  api.getFinanceStayProfile.mockReset().mockImplementation((p) => (p.fiscalYear
    ? Promise.reject({ error: 'Exercice inconnu.', code: 'UNKNOWN_EXERCISE' })
    : Promise.resolve(PROFILE)));
  renderAt('/finance/profil?exercice=2026');
  expect(await screen.findByText('Exercice inconnu.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Exercice en cours' }));
  await waitFor(() => expect(api.getFinanceStayProfile.mock.calls.at(-1)[0]).toMatchObject({ fiscalYear: '', period: 'fy' }));
  await waitFor(() => expect(screen.queryByText('Exercice inconnu.')).toBeNull());
});

test('rule 31 — another refusal keeps its own way out, not « Exercice en cours »', async () => {
  api.getFinanceStayProfile.mockReset().mockRejectedValue({ error: 'Logement inconnu.' });
  renderAt('/finance/profil?exercice=2026&logement=9');
  expect(await screen.findByText('Logement inconnu.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Exercice en cours' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Tous les logements' })).toBeInTheDocument();
});
