/**
 * specs/settings-rationalization.md rule 34 — the four icon buttons of a user (table and cards) have an
 * accessible name of their own, not just a tooltip on the wrapping span.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';
import { mediaAtWidth } from './tabletWidthMedia';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { listUsers: vi.fn(), updateSelf: vi.fn(), getMyEmailStatus: vi.fn() },
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: () => ({ user: { id: 1, email: 'adrien@example.com', roles: ['admin'] }, changePassword: vi.fn(), refresh: vi.fn() }),
}));

import api from '../../api';
import UserManagementPage from '../UserManagementPage';

const USER = { id: 2, email: 'compta@example.com', roles: ['accountant'], firstName: 'Léa', lastName: 'Martin', lastLoginAt: null, isActive: true };
const orig = window.matchMedia;
beforeEach(() => {
  api.listUsers.mockResolvedValue({ users: [USER] });
  api.getMyEmailStatus.mockResolvedValue({ myEmail: null, defaultStillUsed: false });
});
afterEach(() => { window.matchMedia = orig; });

const NAMES = ['Modifier', 'Réinitialiser le mot de passe', 'Désactiver', "Supprimer l'utilisateur"];

test.each([[1280], [390]])('rule 34 — at %ipx each user action is a named button', async (width) => {
  window.matchMedia = mediaAtWidth(width);
  render(<MemoryRouter><DialogProvider><UserManagementPage /></DialogProvider></MemoryRouter>);
  const holder = (await screen.findAllByText(/compta@example\.com/))[0].closest('tr, .MuiCard-root');
  const scope = within(holder);
  NAMES.forEach((name) => expect(scope.getByRole('button', { name })).toBeInTheDocument());
});
