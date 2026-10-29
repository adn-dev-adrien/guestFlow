// specs/plugins-phase-4-registry.md rule 57 — the home line of a plugin switched off at a core update.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('react-router', () => ({ useNavigate: () => navigate }));
let currentUser = { id: 1, roles: ['admin'], pluginsManageable: true };
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: currentUser }) }));

import PluginsSwitchedOffAlert from '../PluginsSwitchedOffAlert';

const attention = { key: 'plugins-switched-off', severity: 'todo', count: 1, title: 'Vigilance Météo-France éteint : nécessite Arrivée et départ guidés.', detail: 'À réactiver depuis la page Plugins' };

test('rule 57: the card shows the server words and opens the Plugins page', async () => {
  currentUser = { id: 1, roles: ['admin'], pluginsManageable: true };
  render(<PluginsSwitchedOffAlert attention={attention} />);
  expect(screen.getByText(/À réactiver depuis la page Plugins/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Voir les plugins' }));
  expect(navigate).toHaveBeenCalledWith('/parametres/plugins');
});

test('rule 57: no button where the Plugins page does not exist for the user (managed space)', () => {
  currentUser = { id: 1, roles: ['admin'], pluginsManageable: false };
  render(<PluginsSwitchedOffAlert attention={{ ...attention, detail: 'À réactiver par l’exploitant' }} />);
  expect(screen.getByText(/par l’exploitant/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Voir les plugins' })).toBeNull();
});
