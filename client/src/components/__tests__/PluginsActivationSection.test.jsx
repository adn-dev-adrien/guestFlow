// specs/plugin-engine-backport.md rules 5 and 11 — the connected « Modules » card: it lists what the
// server lists, flips a plugin through the activation endpoints, then refreshes the auth context.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const api = vi.hoisted(() => ({ getPlugins: vi.fn(), activatePlugin: vi.fn(), deactivatePlugin: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ __esModule: true, default: api }));
vi.mock('../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ refresh }) }));

import PluginsActivationSection from '../PluginsActivationSection';

const OFF = [{ id: 'gites-de-france-intake', name: 'Saisie Gîtes de France', description: 'Remplit les fiches.', enabled: false }];
const ON = [{ ...OFF[0], enabled: true }];

afterEach(() => vi.clearAllMocks());

test('rule 11: renders nothing while the server lists no plugin', async () => {
  api.getPlugins.mockResolvedValue([]);
  const { container } = render(<PluginsActivationSection />);
  await waitFor(() => expect(api.getPlugins).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test('rules 5, 11: switching a plugin on calls activate, reloads the list and refreshes the user', async () => {
  api.getPlugins.mockResolvedValueOnce(OFF).mockResolvedValue(ON);
  api.activatePlugin.mockResolvedValue({ id: 'gites-de-france-intake', enabled: true });
  render(<PluginsActivationSection />);
  await userEvent.click(await screen.findByRole('switch', { name: 'Saisie Gîtes de France' }));
  expect(api.activatePlugin).toHaveBeenCalledWith('gites-de-france-intake');
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Saisie Gîtes de France' })).toBeChecked());
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('rules 5, 11: switching it off calls deactivate', async () => {
  api.getPlugins.mockResolvedValueOnce(ON).mockResolvedValue(OFF);
  api.deactivatePlugin.mockResolvedValue({ id: 'gites-de-france-intake', enabled: false });
  render(<PluginsActivationSection />);
  await userEvent.click(await screen.findByRole('switch', { name: 'Saisie Gîtes de France' }));
  expect(api.deactivatePlugin).toHaveBeenCalledWith('gites-de-france-intake');
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Saisie Gîtes de France' })).not.toBeChecked());
});
