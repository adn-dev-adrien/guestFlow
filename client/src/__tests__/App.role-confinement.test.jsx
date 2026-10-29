// specs/reception-role-checkin-only.md rule 15 — a role outside its surface is redirected while the shell
// renders: the forbidden page is never mounted, so none of its calls leave (no 403 burst, no error toast
// on the landing page). The reservation search is for the administrator only, and the shell asks only
// for what its role may read (specs/plugins-phase-2-hosts.md rule 34).
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { user: { id: 1, roles: ['admin'], enabledPlugins: [] }, loading: false, logout: () => {} },
}));
vi.mock('../hooks/useAuth', () => ({ __esModule: true, AuthProvider: ({ children }) => children, useAuth: () => mockAuth }));
vi.mock('../api', () => {
  const answers = {
    getSystemVersion: { current: '3.10.0', latest: '3.10.0', updateAvailable: false, updateInProgress: false },
    getAttention: { pinned: [], items: [], total: 0 },
    getToday: { today: '2026-10-19' },
    getPlatformColors: { customColors: {} },
    getProperties: [{ id: 1, name: 'Gite' }],
    getPendingEmails: [],
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
import api from '../api';

const original = window.matchMedia;
const emulate = (phone) => {
  window.matchMedia = vi.fn((query) => ({
    matches: phone ? /max-width:\s*(599|899)/.test(query) : false,
    media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
};
const signIn = (roles, path) => {
  mockAuth.user = { id: 2, roles, enabledPlugins: [] };
  window.history.pushState({}, '', path);
};
beforeEach(() => { emulate(false); Object.values(api).forEach((fn) => fn.mockClear && fn.mockClear()); });
afterEach(() => { window.matchMedia = original; window.history.pushState({}, '', '/'); mockAuth.user = { id: 1, roles: ['admin'], enabledPlugins: [] }; });

// The lazy chunk of a page is loaded once an administrator has opened it: from then on it mounts in the
// very first commit, which is what used to fire its calls before the redirect ran.
const warmUp = async (path, call) => {
  signIn(['admin'], path);
  const first = render(<App />);
  await waitFor(() => expect(call).toHaveBeenCalled());
  first.unmount();
  Object.values(api).forEach((fn) => fn.mockClear && fn.mockClear());
};

test('rule 15 — reception typing /emails lands on the home without the Emails page ever calling the server', async () => {
  await warmUp('/emails', api.getPendingEmails);
  signIn(['reception'], '/emails');
  render(<App />);
  await waitFor(() => expect(window.location.pathname).toBe('/'));
  await screen.findByRole('link', { name: 'Planning' });
  expect(api.getPendingEmails).not.toHaveBeenCalled();
  expect(api.getEmailTemplates).not.toHaveBeenCalled();
});

test('rule 15 — an accountant on a page outside accounting is sent to Mon compte before it mounts', async () => {
  await warmUp('/clients', api.getClientsDirectory);
  signIn(['accountant'], '/clients');
  render(<App />);
  await waitFor(() => expect(['/mon-compte', '/comptabilite']).toContain(window.location.pathname));
  expect(api.getClientsDirectory).not.toHaveBeenCalled();
});

test('rule 34 — the accountant\'s shell loads the platform colours but not the property list', async () => {
  signIn(['accountant'], '/mon-compte');
  render(<App />);
  await waitFor(() => expect(api.getPlatformColors).toHaveBeenCalled());
  expect(api.getProperties).not.toHaveBeenCalled();
});

test('rule 15 — the reception shell still reads the property list', async () => {
  signIn(['reception'], '/');
  render(<App />);
  await waitFor(() => expect(api.getProperties).toHaveBeenCalled());
});

test('rule 17 — the reservation search is offered to the administrator only', async () => {
  signIn(['admin'], '/');
  const admin = render(<App />);
  expect(await screen.findByPlaceholderText(/Rechercher une réservation/)).toBeInTheDocument();
  admin.unmount();
  signIn(['reception'], '/');
  render(<App />);
  await screen.findByRole('link', { name: 'Planning' });
  expect(screen.queryByPlaceholderText(/Rechercher une réservation/)).toBeNull();
});

test('rule 17 — on a phone, the search icon is absent for reception and present for the administrator', async () => {
  emulate(true);
  signIn(['reception'], '/');
  const reception = render(<App />);
  await screen.findByRole('button', { name: 'Ouvrir le menu' });
  expect(screen.queryByRole('button', { name: 'Rechercher une réservation' })).toBeNull();
  reception.unmount();
  signIn(['admin'], '/');
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Rechercher une réservation' })).toBeInTheDocument();
});
