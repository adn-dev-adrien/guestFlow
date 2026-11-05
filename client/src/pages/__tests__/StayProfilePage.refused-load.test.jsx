// specs/stay-profile.md §3 rules 1 and 18 — the page asks with the dashboard's URL parameters, a link
// to a window refused on the client sends nothing, and a server refusal keeps the period selector
// (never a dead end), as on the Suivi financier.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getFinanceStayProfile: vi.fn(), getToday: vi.fn() } }));

import api from '../../api';
import StayProfilePage from '../StayProfilePage';
import { PROFILE, setupMatchMedia } from './stayProfileFixtures';
import { PERIOD_MESSAGES } from '../../components/PeriodSelector';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/finance/profil" element={<StayProfilePage />} /></Routes>
  </MemoryRouter>,
);
const TODAY = localIsoToday();

beforeEach(() => {
  setupMatchMedia();
  api.getToday.mockReset().mockResolvedValue({ today: TODAY });
  api.getFinanceStayProfile.mockReset().mockResolvedValue(PROFILE);
});

test('rule 1 — the URL window and logement are what the page asks for', async () => {
  const from = addIsoDays(TODAY, -20);
  const to = addIsoDays(TODAY, 10);
  renderAt(`/finance/profil?periode=custom&du=${from}&au=${to}&logement=2`);
  await waitFor(() => expect(api.getFinanceStayProfile).toHaveBeenCalled());
  expect(api.getFinanceStayProfile.mock.calls.at(-1)[0]).toMatchObject({ period: 'custom', from, to, propertyId: '2' });
});

test('rule 18 — a link with a single date sends nothing and keeps the selector', async () => {
  renderAt(`/finance/profil?periode=custom&du=${addIsoDays(TODAY, -20)}`);
  expect(await screen.findByRole('alert')).toHaveTextContent(PERIOD_MESSAGES.missingDates);
  expect(api.getFinanceStayProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Exercice' }));
  await waitFor(() => expect(api.getFinanceStayProfile).toHaveBeenCalledTimes(1));
  expect(api.getFinanceStayProfile.mock.calls[0][0]).toMatchObject({ period: 'fy', from: '', to: '' });
});

test('rule 18 — a server refusal shows its message, keeps the selector and « Tous les logements »', async () => {
  api.getFinanceStayProfile.mockReset().mockRejectedValueOnce({ error: 'Logement inconnu.' }).mockResolvedValue(PROFILE);
  renderAt('/finance/profil?logement=99');
  expect(await screen.findByText('Logement inconnu.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tous les logements' }));
  await waitFor(() => expect(api.getFinanceStayProfile).toHaveBeenCalledTimes(2));
  expect(api.getFinanceStayProfile.mock.calls[1][0]).toMatchObject({ propertyId: '' });
  expect(await screen.findByTestId('share-row-direct')).toBeInTheDocument();
});
