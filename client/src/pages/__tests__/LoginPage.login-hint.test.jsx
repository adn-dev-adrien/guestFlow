// specs/control-plane-plans-and-access.md rule 24 — arriving from the shared login page, the email is
// filled in and the focus is on the password.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ login: vi.fn() }),
}));

import LoginPage from '../LoginPage';

function renderAt(url) {
  render(<MemoryRouter initialEntries={[url]}><LoginPage /></MemoryRouter>);
}

test('login_hint fills the email and focuses the password', () => {
  renderAt('/login?login_hint=compta%40cabinet-dupont.fr');
  expect(screen.getByLabelText(/Email/)).toHaveValue('compta@cabinet-dupont.fr');
  expect(document.activeElement).toBe(screen.getByLabelText(/Mot de passe/));
});

test('without a hint the email is empty and focused', () => {
  renderAt('/login');
  expect(screen.getByLabelText(/Email/)).toHaveValue('');
  expect(document.activeElement).toBe(screen.getByLabelText(/Email/));
});
