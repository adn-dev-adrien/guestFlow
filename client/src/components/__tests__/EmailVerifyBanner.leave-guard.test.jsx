// specs/ui-review-2026-10-19-operations.md rule 42 — the e-mail banner's « Se déconnecter » asks the page first, as the menu does.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const logout = vi.fn();
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { id: 1, email: 'a@b.test' }, logout }) }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: { getMyEmailStatus: vi.fn(() => Promise.resolve({ mustVerifyNewEmail: true, myEmail: 'a@b.test' })) },
}));

import EmailVerifyBanner from '../EmailVerifyBanner';

const open = () => render(<MemoryRouter><EmailVerifyBanner /></MemoryRouter>);

beforeEach(() => logout.mockClear());
afterEach(() => { delete window.__guestflowBeforeNavigate; });

test('a dirty page keeps the session', async () => {
  window.__guestflowBeforeNavigate = vi.fn(() => true);
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Se déconnecter' }));
  expect(window.__guestflowBeforeNavigate).toHaveBeenCalledWith('/login');
  expect(logout).not.toHaveBeenCalled();
});

test('a clean page signs out', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Se déconnecter' }));
  expect(logout).toHaveBeenCalledTimes(1);
});
