// specs/plugins-phase-p-productisation.md rule 35 — at a tablet width (900 px, side menu open) the
// accounts are cards, so « Dernière connexion » and the actions are never hidden in an inner scroll.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
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

let orig;
beforeEach(() => {
  orig = window.matchMedia;
  api.getMyEmailStatus.mockResolvedValue({ myEmail: null, defaultStillUsed: false });
  api.listUsers.mockResolvedValue({ users: [{ id: 2, email: 'compta@example.com', roles: ['accountant'], firstName: 'Léa', lastName: 'Martin', lastLoginAt: null }] });
});
afterEach(() => { window.matchMedia = orig; });

test('900 px: cards, no table', async () => {
  window.matchMedia = mediaAtWidth(900);
  render(<MemoryRouter><DialogProvider><UserManagementPage /></DialogProvider></MemoryRouter>);
  expect(await screen.findByText(/compta@example\.com/)).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});

test('1280 px: the table', async () => {
  window.matchMedia = mediaAtWidth(1280);
  render(<MemoryRouter><DialogProvider><UserManagementPage /></DialogProvider></MemoryRouter>);
  expect(await screen.findByText(/compta@example\.com/)).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeInTheDocument();
});
