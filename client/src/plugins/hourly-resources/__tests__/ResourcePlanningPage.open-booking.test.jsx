// specs/plugins-phase-3c-hourly-resources.md amendment 2026-11-13 — `?booking=<id>&resource=<id>&date=<date>`
// moves the page to that resource and week, then opens the booking's editor.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';

const { getResources, getResourceBookings } = vi.hoisted(() => ({ getResources: vi.fn(), getResourceBookings: vi.fn() }));
vi.mock('../../../api', () => ({ __esModule: true, default: { getResources, getResourceBookings } }));
vi.mock('../ResourceBookingDialog', () => ({
  __esModule: true,
  default: ({ booking, resource }) => <div data-testid="editor">{`${resource.name}#${booking ? booking.id : 'new'}`}</div>,
}));

import ResourcePlanningPage from '../ResourcePlanningPage';

const BAIN = { id: 3, name: 'Bain', isComplex: 1, openTime: '08:00', closeTime: '22:00', slotDuration: 60 };
const SAUNA = { id: 4, name: 'Sauna', isComplex: 1, openTime: '08:00', closeTime: '22:00', slotDuration: 60 };
const row = (id, kind = 'booking') => ({
  id, resourceId: 4, date: '2026-12-02', startTime: '10:00', endTime: '11:00', kind, reservationId: kind === 'session' ? 77 : null,
  displayName: 'Dupont', totalPrice: 30, paid: false, turnoverMinutes: 0,
});

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: /min-width/.test(query), media: query, onchange: null, dispatchEvent: () => false,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  });
  getResources.mockReset().mockResolvedValue([BAIN, SAUNA]);
  getResourceBookings.mockReset().mockImplementation(({ resourceId, weekStart }) => Promise.resolve(
    resourceId === 4 && weekStart === '2026-11-30' ? [row(40, 'session'), row(41)] : [],
  ));
});
afterEach(() => { delete window.matchMedia; });

const renderAt = (url) => render(
  <MemoryRouter initialEntries={[url]}><ThemeProvider theme={theme}><DialogProvider><ResourcePlanningPage /></DialogProvider></ThemeProvider></MemoryRouter>,
);

test('the linked booking opens on its own resource and week', async () => {
  renderAt('/resource-planning?booking=41&resource=4&date=2026-12-02');
  expect((await screen.findByTestId('editor', {}, { timeout: 5000 })).textContent).toBe('Sauna#41');
  expect(getResourceBookings).toHaveBeenCalledWith({ resourceId: 4, weekStart: '2026-11-30' });
});

test('a booking no longer there says so, and opens nothing', async () => {
  renderAt('/resource-planning?booking=99&resource=4&date=2026-12-02');
  expect(await screen.findByText('Réservation introuvable.', {}, { timeout: 5000 })).toBeInTheDocument();
  expect(screen.queryByTestId('editor')).toBeNull();
});

test('a session of a stay is never opened as a booking', async () => {
  renderAt('/resource-planning?booking=40&resource=4&date=2026-12-02');
  await screen.findByText('Réservation introuvable.', {}, { timeout: 5000 });
  await waitFor(() => expect(screen.queryByTestId('editor')).toBeNull());
});
