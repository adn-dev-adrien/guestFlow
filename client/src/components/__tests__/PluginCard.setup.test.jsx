// specs/plugins-phase-0-foundation.md rule 25 (UI/UX review 2026-10-18, proposal 19) — the card tells
// the real state the server computed (« Actif · à connecter »), its main action opens the plugin's
// settings place, and « Désactiver » waits in ⋯ behind a confirmation that says what stops.
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PluginCard from '../PluginCard';

const plugin = (over = {}) => ({
  id: 'google-calendar', name: 'Google Agenda', description: 'Copie les séjours dans un agenda Google.', icon: 'event',
  surfaces: ['Intégrations › Google Agenda'], requires: [], state: 'active', blocker: null, hasModule: true, erasable: false, data: [],
  setup: { needed: true, label: 'Actif · à connecter', path: '/settings/integrations?tab=google-calendar', action: 'Configurer' },
  ...over,
});

function draw(p) {
  const onAction = vi.fn();
  const onOpenSettings = vi.fn();
  render(<ThemeProvider theme={theme}><PluginCard plugin={p} onAction={onAction} onOpenSettings={onOpenSettings} /></ThemeProvider>);
  return { onAction, onOpenSettings };
}

test('rule 25: « Actif · à connecter » and « Configurer » opening the plugin’s place', () => {
  const { onOpenSettings } = draw(plugin());
  expect(screen.getByText('Actif · à connecter')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Configurer' }));
  expect(onOpenSettings).toHaveBeenCalledWith('/settings/integrations?tab=google-calendar');
  expect(screen.queryByRole('button', { name: 'Désactiver' })).toBeNull();
});

test('rule 25: set up, the card says « Actif » and offers « Réglages »; nothing to set up, no button', () => {
  const { unmount } = render(
    <ThemeProvider theme={theme}>
      <PluginCard plugin={plugin({ setup: { needed: false, label: 'Actif', path: '/parametres/paiements', action: 'Réglages' } })} onAction={vi.fn()} />
    </ThemeProvider>,
  );
  expect(screen.getByText('Actif')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réglages' })).toBeInTheDocument();
  unmount();
  draw(plugin({ id: 'sas', name: 'Arrivée et départ guidés', setup: { needed: false, label: 'Actif', path: null, action: null } }));
  expect(screen.queryByRole('button', { name: 'Réglages' })).toBeNull();
  expect(screen.getByRole('button', { name: /Plus d’actions/ })).toBeInTheDocument();
});

test('rule 25: « Désactiver » from ⋯ asks first, says what stops, and « Garder » changes nothing', async () => {
  const { onAction } = draw(plugin());
  fireEvent.click(screen.getByRole('button', { name: /Plus d’actions : Google Agenda/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Désactiver/ }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Désactiver Google Agenda ?')).toBeInTheDocument();
  expect(within(dialog).getByText(/Ses réglages et ses données sont gardés/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Garder' }));
  expect(onAction).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /Plus d’actions/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Désactiver/ }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }));
  expect(onAction).toHaveBeenCalledWith('deactivate', undefined);
});

test('rule 25: an inactive plugin keeps « Activer » as its action', () => {
  draw(plugin({ state: 'inactive', setup: { needed: false, label: null, path: '/settings/integrations?tab=google-calendar', action: null } }));
  expect(screen.getByText('Inactif')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activer' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Configurer' })).toBeNull();
});
