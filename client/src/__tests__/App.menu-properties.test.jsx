// specs/inte-performance.md rule 13 — the side menu reads the properties once and again after a
// write, not on every page change.
import React from 'react';
import { screen, render, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import api from '../api';
import App from '../App';
import { DATA_CHANGED_EVENT } from '../constants/appEvents';

afterEach(() => { window.history.pushState({}, '', '/'); });

test('rule 13: one read of the properties at mount, none on a page change, one more after a write', async () => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  render(<App />);
  await waitFor(() => expect(api.getProperties).toHaveBeenCalled());
  const baseline = api.getProperties.mock.calls.length;
  await userEvent.click((await screen.findAllByRole('link', { name: /Clients/ }))[0]);
  await waitFor(() => expect(window.location.pathname).toBe('/clients'));
  expect(api.getProperties.mock.calls.length).toBe(baseline);
  await act(async () => { window.dispatchEvent(new CustomEvent(DATA_CHANGED_EVENT)); });
  await waitFor(() => expect(api.getProperties.mock.calls.length).toBeGreaterThan(baseline));
});
