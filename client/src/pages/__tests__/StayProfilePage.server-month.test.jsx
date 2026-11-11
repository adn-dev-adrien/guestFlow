// specs/stay-profile.md §3 rule 27 (review R6-4) — the default month and the default custom dates
// come from the server's day, not the device's clock (invariant 33): a device a month behind still
// opens the server's month.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getFinanceStayProfile: vi.fn(), getToday: vi.fn() } }));

import api from '../../api';
import StayProfilePage from '../StayProfilePage';
import { PROFILE, setupMatchMedia } from './stayProfileFixtures';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const SERVER_DAY = localIsoToday();
const SERVER_MONTH = SERVER_DAY.slice(0, 7);
const DEVICE_DAY = addIsoDays(SERVER_DAY, -45);

beforeEach(() => {
  setupMatchMedia();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${DEVICE_DAY}T12:00:00`));
  api.getToday.mockReset().mockResolvedValue({ today: SERVER_DAY });
  api.getFinanceStayProfile.mockReset().mockResolvedValue({
    ...PROFILE,
    months: [{ month: DEVICE_DAY.slice(0, 7), label: 'device' }, { month: SERVER_MONTH, label: 'server' }],
  });
});
afterEach(() => { vi.useRealTimers(); });

const renderPage = () => render(
  <MemoryRouter initialEntries={['/finance/profil']}>
    <Routes><Route path="/finance/profil" element={<StayProfilePage />} /></Routes>
  </MemoryRouter>,
);

test('rule 27 — « Mois » opens the server\'s month', async () => {
  renderPage();
  await screen.findByTestId('share-row-direct');
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Mois' }));
  await waitFor(() => expect(api.getFinanceStayProfile.mock.calls.at(-1)[0]).toMatchObject({ period: 'month', month: SERVER_MONTH }));
});

test('rule 27 — « Personnalisée » proposes the server\'s month, first to last day', async () => {
  renderPage();
  await screen.findByTestId('share-row-direct');
  await waitFor(() => expect(api.getToday).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Personnalisée' }));
  await waitFor(() => expect(api.getFinanceStayProfile.mock.calls.at(-1)[0]).toMatchObject({ period: 'custom', from: `${SERVER_MONTH}-01` }));
  const { to } = api.getFinanceStayProfile.mock.calls.at(-1)[0];
  expect(to.slice(0, 7)).toBe(SERVER_MONTH);
  expect(addIsoDays(to, 1).slice(8, 10)).toBe('01');
});
