// specs/ui-review-2026-10-19-operations.md rule 42 — the shell's own ways out ask the page first: the top-bar search and
// « Se déconnecter ». « Quitter » after a refused logout really signs out; a signed-in visit to /login never does.
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { vi } from 'vitest';

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { user: { id: 1, roles: ['admin'], enabledPlugins: [] }, loading: false, logout: null },
}));
vi.mock('../hooks/useAuth', () => ({
  __esModule: true,
  AuthProvider: ({ children }) => children,
  useAuth: () => mockAuth,
}));
vi.mock('../api', () => {
  const answers = {
    getSystemVersion: { current: '3.10.0', latest: '3.10.0', updateAvailable: false, updateInProgress: false },
    getAttention: { pinned: [], items: [], total: 0 },
    getToday: { today: new Date().toLocaleDateString('sv') },
    getPlatformColors: { customColors: {} },
    getProperties: [{ id: 1, name: 'Gite' }],
    searchReservations: [{ id: 41, reservationNumber: 'T41', clientName: 'Ana Test', propertyName: 'Gite', startDate: '2099-01-01', endDate: '2099-01-03' }],
  };
  const api = new Proxy({}, {
    get: (target, name) => {
      if (!target[name]) target[name] = vi.fn(() => Promise.resolve(name in answers ? answers[name] : []));
      return target[name];
    },
  });
  return { __esModule: true, default: api };
});
vi.mock('../components/CumulativeMonthCalendar', () => ({ __esModule: true, default: () => null }));

import App from '../App';

const routerGoesTo = (url) => act(async () => {
  window.history.pushState({}, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
});

beforeEach(() => {
  mockAuth.logout = vi.fn();
  mockAuth.user = { id: 1, roles: ['admin'], enabledPlugins: [] };
  window.history.pushState({}, '', '/clients');
});
afterEach(() => {
  delete window.__guestflowBeforeNavigate;
  window.history.pushState({}, '', '/');
});

async function pickSearchResult() {
  const box = (await screen.findAllByPlaceholderText(/Rechercher une réservation/))[0];
  fireEvent.change(box, { target: { value: 'Ana' } });
  const option = await screen.findByRole('option', {}, { timeout: 3000 });
  fireEvent.click(option);
}

test('rule 42: the top-bar search asks the guard, with the target and its way back', async () => {
  const guard = vi.fn(() => true);
  render(<App />);
  window.__guestflowBeforeNavigate = guard;
  await pickSearchResult();
  await waitFor(() => expect(guard).toHaveBeenCalled());
  expect(guard.mock.calls[0][0]).toMatch(/^\/reservations\/41\?from=/);
  expect(window.location.pathname).toBe('/clients');
});

test('rule 42: with no guard the search goes straight to the fiche', async () => {
  render(<App />);
  await pickSearchResult();
  await waitFor(() => expect(window.location.pathname).toBe('/reservations/41'));
});

test('rule 42: a clean page signs out at once', async () => {
  render(<App />);
  fireEvent.click(await screen.findByText('Se déconnecter'));
  expect(mockAuth.logout).toHaveBeenCalledTimes(1);
});

test('rule 42: a dirty page keeps the session until « Quitter », which signs out', async () => {
  const guard = vi.fn(() => true);
  render(<App />);
  window.__guestflowBeforeNavigate = guard;
  fireEvent.click(await screen.findByText('Se déconnecter'));
  expect(guard).toHaveBeenCalledWith('/login');
  expect(mockAuth.logout).not.toHaveBeenCalled();
  await routerGoesTo('/login');
  await waitFor(() => expect(mockAuth.logout).toHaveBeenCalledTimes(1));
});

test('rule 42: a signed-in visit to /login never signs out, a refused logout long forgotten included', async () => {
  const stale = vi.fn(() => true);
  render(<App />);
  window.__guestflowBeforeNavigate = stale;
  fireEvent.click(await screen.findByText('Se déconnecter'));
  delete window.__guestflowBeforeNavigate;
  fireEvent.click(await screen.findByText('Se déconnecter'));
  expect(mockAuth.logout).toHaveBeenCalledTimes(1);
  await routerGoesTo('/login');
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  expect(mockAuth.logout).toHaveBeenCalledTimes(1);
});

test('rule 42: « Quitter » signs out whatever the role: the role redirect does not swallow /login', async () => {
  mockAuth.user = { id: 2, roles: ['reception'], enabledPlugins: [] };
  window.history.pushState({}, '', '/planning');
  const guard = vi.fn(() => true);
  render(<App />);
  window.__guestflowBeforeNavigate = guard;
  fireEvent.click(await screen.findByText('Se déconnecter'));
  expect(mockAuth.logout).not.toHaveBeenCalled();
  await routerGoesTo('/login');
  await waitFor(() => expect(mockAuth.logout).toHaveBeenCalledTimes(1));
});
