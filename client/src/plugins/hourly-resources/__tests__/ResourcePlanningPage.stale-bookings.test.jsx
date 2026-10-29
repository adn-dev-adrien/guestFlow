// specs/ds-sweep-planning.md rule 31 — the bookings shown are always those of the week and the resource
// on screen: a slow answer for a week or a resource already left is dropped, so a taken slot never reads
// as free (rule 9); until the answer of the one on screen lands, the grid is dimmed and inert.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';

const { getResources, getResourceBookings } = vi.hoisted(() => ({ getResources: vi.fn(), getResourceBookings: vi.fn() }));
vi.mock('../../../api', () => ({ __esModule: true, default: { getResources, getResourceBookings } }));

import ResourcePlanningPage from '../ResourcePlanningPage';

const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };
const RESOURCE = { id: 3, name: 'Bain', isComplex: 1, openTime: '08:00', closeTime: '22:00', slotDuration: 60 };
const OTHER = { id: 4, name: 'Sauna', isComplex: 1, openTime: '08:00', closeTime: '22:00', slotDuration: 60 };

const bookingOn = (weekStart, name, resourceId = 3) => {
  const day = new Date(`${weekStart}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 2);
  return [{
    id: 900 + resourceId, resourceId, date: day.toISOString().slice(0, 10), startTime: '10:00', endTime: '11:00', notes: '', totalPrice: 30,
    paid: false, propertyId: 1, propertyName: 'Gite', displayName: name, firstName: name, lastName: '', kind: 'booking',
    resourceName: 'Bain', slotDuration: 60, openTime: '08:00', closeTime: '22:00', turnoverMinutes: 0, openDays: '[0,1,2,3,4,5,6]',
  }];
};

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: /min-width/.test(query), media: query, onchange: null, dispatchEvent: () => false,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  });
  getResources.mockReset().mockResolvedValue([RESOURCE, OTHER]);
  getResourceBookings.mockReset();
});
afterEach(() => { delete window.matchMedia; });

const renderPage = () => render(
  <MemoryRouter><ThemeProvider theme={theme}><DialogProvider><ResourcePlanningPage /></DialogProvider></ThemeProvider></MemoryRouter>,
);

test('rule 31 — next week then back: the late empty answer of next week does not wipe this week', async () => {
  const nextWeek = deferred();
  const calls = [];
  getResourceBookings.mockImplementation(({ weekStart }) => {
    calls.push(weekStart);
    if (calls.length === 2) return nextWeek.promise;
    return Promise.resolve(bookingOn(calls[0], 'SENTINEL'));
  });
  renderPage();
  await waitFor(() => expect(screen.getAllByText(/SENTINEL/).length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByRole('button', { name: 'Semaine suivante' })[0]);
  fireEvent.click(screen.getAllByRole('button', { name: 'Semaine précédente' })[0]);
  await waitFor(() => expect(calls).toHaveLength(3));
  await waitFor(() => expect(screen.getAllByText(/SENTINEL/).length).toBeGreaterThan(0));
  await act(async () => { nextWeek.resolve([]); });
  expect(screen.getAllByText(/SENTINEL/).length).toBeGreaterThan(0);
});

test('rule 31 — a late failure of a week already left does not raise the error over the week on screen', async () => {
  let rejectNext;
  const calls = [];
  getResourceBookings.mockImplementation(({ weekStart }) => {
    calls.push(weekStart);
    if (calls.length === 2) return new Promise((_, reject) => { rejectNext = reject; });
    return Promise.resolve(bookingOn(calls[0], 'SENTINEL'));
  });
  renderPage();
  await waitFor(() => expect(screen.getAllByText(/SENTINEL/).length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByRole('button', { name: 'Semaine suivante' })[0]);
  fireEvent.click(screen.getAllByRole('button', { name: 'Semaine précédente' })[0]);
  await waitFor(() => expect(calls).toHaveLength(3));
  await act(async () => { rejectNext(new Error('boom')); });
  expect(screen.getAllByText(/SENTINEL/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/Impossible de charger/)).toBeNull();
});

const grid = () => screen.getByTestId('resource-planning-grid');

test('rule 31 — a resource switch dims the grid and draws nothing of the previous resource until the new answer lands', async () => {
  const sauna = deferred();
  const calls = [];
  getResourceBookings.mockImplementation(({ resourceId, weekStart }) => {
    calls.push(resourceId);
    return resourceId === 3 ? Promise.resolve(bookingOn(weekStart, 'SENTINEL')) : sauna.promise;
  });
  renderPage();
  await waitFor(() => expect(screen.getAllByText(/SENTINEL/).length).toBeGreaterThan(0));
  expect(grid()).toHaveAttribute('aria-busy', 'false');
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
  fireEvent.click(await screen.findByRole('option', { name: 'Sauna' }));
  await waitFor(() => expect(calls).toContain(4));
  expect(screen.queryByText(/SENTINEL/)).toBeNull();
  expect(grid()).toHaveAttribute('aria-busy', 'true');
  expect(grid()).toHaveStyle({ pointerEvents: 'none' });
  await act(async () => { sauna.resolve([]); });
  expect(grid()).toHaveAttribute('aria-busy', 'false');
  expect(grid()).toHaveStyle({ pointerEvents: 'auto' });
});

test('rule 31 — a week change keeps the grid inert, not « libre », until the new week answers', async () => {
  const nextWeek = deferred();
  const calls = [];
  getResourceBookings.mockImplementation(({ weekStart }) => {
    calls.push(weekStart);
    return calls.length === 1 ? Promise.resolve(bookingOn(weekStart, 'SENTINEL')) : nextWeek.promise;
  });
  renderPage();
  await waitFor(() => expect(screen.getAllByText(/SENTINEL/).length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByRole('button', { name: 'Semaine suivante' })[0]);
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(grid()).toHaveAttribute('aria-busy', 'true');
  expect(grid()).toHaveStyle({ pointerEvents: 'none' });
  expect(screen.queryByText(/SENTINEL/)).toBeNull();
  await act(async () => { nextWeek.resolve(bookingOn(calls[1], 'NEXTWEEK')); });
  expect(grid()).toHaveAttribute('aria-busy', 'false');
  expect(screen.getAllByText(/NEXTWEEK/).length).toBeGreaterThan(0);
});
