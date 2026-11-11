// specs/plugins-phase-p-productisation.md rule 40 — for an administrator, the address of a plugin that
// is not active reads « Plugin inactif » with a link to Plugins; any other address, or another role,
// keeps « Page introuvable ». An unmanaged space only (specs/plugin-operator-provisioning.md rule 7).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

vi.mock('../../api', () => ({ __esModule: true, default: { getPluginPage: vi.fn() } }));
let user = { id: 1, roles: ['admin'], pluginsManageable: true };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user }) }));

import api from '../../api';
import NotFoundPage from '../NotFoundPage';

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/parametres/plugins" element={<p>Page Plugins</p>} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: 1, roles: ['admin'], pluginsManageable: true };
});

test('rule 40: a plugin page names its plugin and opens Plugins', async () => {
  api.getPluginPage.mockResolvedValue({
    plugins: [{ id: 'accounting-export', name: 'Export comptable', state: 'available' }],
    message: 'Cette page dépend du plugin « Export comptable », qui n’est pas activé.',
  });
  renderAt('/comptabilite');
  expect(await screen.findByText('Plugin inactif')).toBeInTheDocument();
  expect(screen.getByText('Cette page dépend du plugin « Export comptable », qui n’est pas activé.')).toBeInTheDocument();
  expect(api.getPluginPage).toHaveBeenCalledWith('/comptabilite');
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Plugins' }));
  expect(await screen.findByText('Page Plugins')).toBeInTheDocument();
});

test('rule 40: an unknown address stays « Page introuvable »', async () => {
  api.getPluginPage.mockResolvedValue({ plugins: [], message: null });
  renderAt('/nulle-part');
  expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
});

test('rule 40: another role is not asked, and sees « Page introuvable »', async () => {
  user = { id: 2, roles: ['accountant'] };
  renderAt('/comptabilite');
  expect(await screen.findByText('Page introuvable')).toBeInTheDocument();
  expect(api.getPluginPage).not.toHaveBeenCalled();
});
