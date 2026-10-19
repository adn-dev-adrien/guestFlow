// specs/shell-and-home-day-first.md rules 15–18 — the shell: the installed version at the foot of the
// drawer (not in the top bar), a 256 px drawer whose labels wrap, chevron buttons that say whether
// their group is open, a named menu button, and the page title in the top bar of a phone.
import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: { user: { id: 1, roles: ['admin'], enabledPlugins: [] }, loading: false, logout: () => {} },
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

import App from '../App';

function emulate(phone) {
  window.matchMedia = vi.fn((query) => ({
    matches: phone ? /max-width:\s*(599|899)/.test(query) : false,
    media: query,
    onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
}
const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; window.history.pushState({}, '', '/'); });

test('rule 16: the installed version sits at the foot of the drawer, not in the top bar', async () => {
  emulate(false);
  render(<App />);
  const footer = await screen.findByTestId('app-version-footer');
  expect(footer).toHaveTextContent('GuestFlow v3.10.0');
  expect(within(document.querySelector('header')).queryByText(/v3\.10\.0/)).not.toBeInTheDocument();
});

test('rules 17–18: chevrons are buttons that name their group and say whether it is open; labels wrap', async () => {
  emulate(false);
  const user = userEvent.setup();
  render(<App />);
  const chevron = await screen.findByRole('button', { name: 'Déplier Suivi financier' });
  expect(chevron).toHaveAttribute('aria-expanded', 'false');
  await user.click(chevron);
  expect(screen.getByRole('button', { name: 'Replier Suivi financier' })).toHaveAttribute('aria-expanded', 'true');
  const paper = document.querySelector('.MuiDrawer-paper');
  expect(getComputedStyle(paper).width).toBe('256px');
  expect(document.querySelector('.MuiDrawer-paper [class*="noWrap"]')).toBeNull();
});

test('rules 15, 18: on a phone the menu button is named and the top bar carries the page title', async () => {
  emulate(true);
  window.history.pushState({}, '', '/clients');
  render(<App />);
  const menu = await screen.findByRole('button', { name: 'Ouvrir le menu' });
  expect(menu).toHaveAttribute('aria-expanded', 'false');
  await waitFor(() => expect(screen.getByTestId('appbar-page-title')).toHaveTextContent('Clients'));
  expect(within(document.querySelector('header')).getByRole('heading', { level: 1, name: 'Clients' })).toBeInTheDocument();
  await userEvent.click(menu);
  expect(menu).toHaveAttribute('aria-expanded', 'true');
});

test('rule 15: on a phone the home keeps the wordmark, as its heading', async () => {
  emulate(true);
  render(<App />);
  await screen.findByRole('button', { name: 'Ouvrir le menu' });
  expect(within(document.querySelector('header')).getByRole('heading', { level: 1, name: 'GuestFlow' })).toBeInTheDocument();
  expect(screen.queryByTestId('appbar-page-title')).not.toBeInTheDocument();
});
