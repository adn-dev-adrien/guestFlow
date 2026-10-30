// Audit R5 (2026-10-30), specs/ui-review-2026-10-19-operations.md rule 39 — the Suivi financier drops the answers of requests that were superseded: a late
// detail answer for a tile already left never reaches the panel of the open tile (it used to crash
// ChannelsTable), and a late dashboard answer for a logement already left never replaces the page.
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getFinanceDashboard: vi.fn(), getFinanceDashboardDetail: vi.fn(), getVatFranchise: vi.fn(), markPayment: vi.fn() },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { DASHBOARD } from './financePageFixtures';

const COLLECTED = { rows: [], totals: { count: 0, amount: 0 } };
const CHANNELS = {
  site: { rows: [], subtotal: {} },
  others: [{ key: 'booking', label: 'Booking.com', reservations: 2, nights: 6, gross: 900, commission: 100, revenue: 800, share: 0.5 }],
  total: { reservations: 2, commission: 100, revenue: 800 },
};

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

let location;
function Probe() { location = useLocation(); return null; }
const renderPage = () => render(
  <MemoryRouter initialEntries={['/finance']}>
    <Routes><Route path="/finance" element={<><FinancePage /><Probe /></>} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue(DASHBOARD);
  api.getFinanceDashboardDetail.mockReset();
  api.getVatFranchise.mockReset().mockResolvedValue({ applies: false });
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});

test('a late detail answer for the tile just left does not crash the open tile', async () => {
  const slow = deferred();
  api.getFinanceDashboardDetail.mockImplementation((tile) => (tile === 'collected' ? slow.promise : Promise.resolve(CHANNELS)));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Encaissé/ }));
  fireEvent.click(screen.getByRole('button', { name: /Canaux/ }));
  expect(await screen.findByText('Booking.com')).toBeInTheDocument();
  await act(async () => { slow.resolve(COLLECTED); });
  expect(screen.getByText('Booking.com')).toBeInTheDocument();
  expect(screen.queryByText('Une erreur est survenue')).not.toBeInTheDocument();
});

test('the panel of a tile never renders the payload of another request key', async () => {
  const slow = deferred();
  api.getFinanceDashboardDetail.mockImplementation(() => slow.promise);
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Canaux/ }));
  await act(async () => { slow.resolve(CHANNELS); });
  expect(await screen.findByText('Booking.com')).toBeInTheDocument();
  api.getFinanceDashboardDetail.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole('radio', { name: /^Gîte/ }));
  expect(screen.queryByText('Booking.com')).not.toBeInTheDocument();
});

test('a late dashboard answer for a logement already left is dropped', async () => {
  const slow = deferred();
  api.getFinanceDashboard.mockImplementation((params) => (params.propertyId === 1 || params.propertyId === '1' ? slow.promise : Promise.resolve(DASHBOARD)));
  renderPage();
  fireEvent.click(await screen.findByRole('radio', { name: /^Gîte/ }));
  fireEvent.click(await screen.findByRole('radio', { name: /Tous les logements/ }));
  expect(location.search).not.toContain('logement');
  await act(async () => { slow.resolve({ ...DASHBOARD, propertyId: 1 }); });
  expect(screen.getByRole('radio', { name: /Tous les logements/ })).toBeChecked();
});
