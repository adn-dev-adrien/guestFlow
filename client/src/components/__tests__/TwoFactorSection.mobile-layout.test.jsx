// specs/hosting-h2-account-security.md rule 29 — the « Second code » method picker is one column on
// a phone and one row above, in sentence case: never a broken staircase of uppercase buttons.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTwoFactorStatus: vi.fn(), startTwoFactor: vi.fn(), confirmTwoFactor: vi.fn(), disableTwoFactor: vi.fn(), regenerateBackupCodes: vi.fn() },
}));

import api from '../../api';
import TwoFactorSection from '../TwoFactorSection';

const STATUS = { enabled: false, emailAvailable: true, events: [] };
const media = (matches) => (query) => ({
  matches, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});

let orig;
beforeEach(() => { orig = window.matchMedia; api.getTwoFactorStatus.mockResolvedValue(STATUS); });
afterEach(() => { window.matchMedia = orig; });

test('rule 29: on a phone the two methods stack, full width', async () => {
  window.matchMedia = media(true);
  render(<TwoFactorSection account="marie@x.fr" />);
  const group = await screen.findByRole('group', { name: 'Méthode du second code' });
  expect(group.className).toMatch(/vertical/);
  expect(group.className).toMatch(/fullWidth/);
  expect(screen.getByRole('button', { name: 'Appli d’authentification' })).toHaveStyle({ textTransform: 'none' });
});

test('rule 29: above a phone they sit on one row', async () => {
  window.matchMedia = media(false);
  render(<TwoFactorSection account="marie@x.fr" />);
  const group = await screen.findByRole('group', { name: 'Méthode du second code' });
  expect(group.className).not.toMatch(/vertical/);
});
