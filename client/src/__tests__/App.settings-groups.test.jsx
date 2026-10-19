// specs/settings-rationalization.md rule 30 — the four settings groups of the sidebar follow the shell's
// chevron pattern (specs/shell-and-home-day-first.md rule 18): the row is a plain link to the summary,
// a separate chevron button folds or unfolds the group and carries aria-expanded / aria-controls.
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


test('rule 30: a settings group row is a link without aria-expanded; its chevron folds it', async () => {
  emulate(false);
  window.history.pushState({}, '', '/settings/emails');
  const user = userEvent.setup();
  render(<App />);
  const row = await screen.findByRole('link', { name: 'Paiements et emails' });
  expect(row).not.toHaveAttribute('aria-expanded');
  expect(row).toHaveAttribute('href', '/settings#paiements-emails');
  const chevron = screen.getByRole('button', { name: 'Replier Paiements et emails' });
  expect(chevron).toHaveAttribute('aria-expanded', 'true');
  expect(chevron).toHaveAttribute('aria-controls', 'settings-group-paiements-emails');
  expect(document.getElementById('settings-group-paiements-emails')).not.toBeNull();
  await user.click(chevron);
  expect(screen.getByRole('button', { name: 'Déplier Paiements et emails' })).toHaveAttribute('aria-expanded', 'false');
  expect(document.getElementById('settings-group-paiements-emails')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Déplier Séjours' }));
  expect(screen.getByRole('button', { name: 'Replier Séjours' })).toHaveAttribute('aria-controls', 'settings-group-sejours');
});
