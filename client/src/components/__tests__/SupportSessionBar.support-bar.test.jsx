// specs/hosting-h2-account-security.md rules 15-16 — the red bar of a support session: « Session
// support — <expiry> » on every page, each page opened reported to the access log, and nothing in a
// customer's own session.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({ __esModule: true, default: { logSupportPage: vi.fn() } }));
let currentUser;
const logout = vi.fn();
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: currentUser, logout }) }));

import api from '../../api';
import SupportSessionBar from '../SupportSessionBar';

beforeEach(() => {
  api.logSupportPage.mockReset().mockResolvedValue(null);
});

test('rule 16 — the red bar names the expiry, in Paris time', async () => {
  currentUser = { id: 2, isSupport: true, roles: ['admin'], supportSession: { expiresAt: '2026-10-09T12:05:00.000Z' } };
  render(<MemoryRouter initialEntries={['/planning?d=1']}><SupportSessionBar /></MemoryRouter>);
  const bar = screen.getByTestId('support-session-bar');
  expect(bar.textContent).toContain('Session support — jusqu’au 09/10 14:05');
  expect(screen.getByRole('button', { name: 'Quitter' })).toBeTruthy();
  await waitFor(() => expect(api.logSupportPage).toHaveBeenCalledWith('/planning?d=1'));
});

test('rule 16 — nothing in a customer\'s own session', () => {
  currentUser = { id: 1, roles: ['admin'], supportSession: null };
  render(<MemoryRouter><SupportSessionBar /></MemoryRouter>);
  expect(screen.queryByTestId('support-session-bar')).toBeNull();
  expect(api.logSupportPage).not.toHaveBeenCalled();
});
