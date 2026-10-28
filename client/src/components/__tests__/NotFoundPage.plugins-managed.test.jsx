// specs/plugin-operator-provisioning.md rule 7 — on an operator-managed space the address of a plugin
// that is off reads « Page introuvable » for every role: no « Plugin inactif », no « Ouvrir Plugins »,
// and the server is not even asked who owns the page.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

vi.mock('../../api', () => ({ __esModule: true, default: { getPluginPage: vi.fn() } }));
let user = { id: 1, roles: ['admin'], pluginsManageable: false };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user }) }));

import api from '../../api';
import NotFoundPage from '../NotFoundPage';

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes><Route path="*" element={<NotFoundPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.getPluginPage.mockResolvedValue({ plugins: [{ id: 'accounting-export', name: 'Export comptable', state: 'available' }], message: 'Cette page dépend du plugin « Export comptable », qui n’est pas activé.' });
});

test('rule 7: an administrator of a managed space reads « Page introuvable » on a plugin address, and is not asked', async () => {
  renderAt('/comptabilite');
  expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retour au tableau de bord' })).toBeInTheDocument();
  expect(screen.queryByText('Plugin inactif')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Ouvrir Plugins' })).toBeNull();
  expect(api.getPluginPage).not.toHaveBeenCalled();
});

test('rule 7: the Plugins address itself reads « Page introuvable » too', async () => {
  renderAt('/parametres/plugins');
  expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
  expect(api.getPluginPage).not.toHaveBeenCalled();
});
