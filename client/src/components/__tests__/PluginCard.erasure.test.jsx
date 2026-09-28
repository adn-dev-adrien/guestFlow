// specs/plugins-phase-1-sdk.md rules 4 and 21-22 — uninstalling a plugin module can erase its data;
// the other plugins always keep theirs; a module that failed to start says so.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PluginCard from '../PluginCard';

const plugin = (over = {}) => ({
  id: 'school-holidays', name: 'Vacances scolaires', description: 'Zones A/B/C', icon: 'school',
  surfaces: ['L’onglet Vacances scolaires'], requires: [], state: 'active', blocker: null,
  hasModule: true, erasable: true,
  data: [{ label: '34 périodes de vacances', count: 34 }, { label: 'l’état de synchronisation', count: 1 }],
  ...over,
});

function renderCard(p, onAction = vi.fn()) {
  render(<ThemeProvider theme={theme}><PluginCard plugin={p} onAction={onAction} /></ThemeProvider>);
  return onAction;
}

test('rule 21: unticked, the uninstall keeps the data and says so', async () => {
  const onAction = renderCard(plugin());
  await userEvent.click(screen.getByText('Vacances scolaires'));
  expect(screen.getByRole('checkbox', { name: 'Effacer aussi ses données' })).not.toBeChecked();
  expect(screen.getByText(/Tes données sont conservées/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Désinstaller' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer la désinstallation' }));
  expect(onAction).toHaveBeenCalledWith('uninstall', undefined);
});

test('rule 21: ticked, the card lists what goes, says it is final, and erases on the second click', async () => {
  const onAction = renderCard(plugin());
  await userEvent.click(screen.getByText('Vacances scolaires'));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Effacer aussi ses données' }));
  expect(screen.getByText('Seront effacés : 34 périodes de vacances · l’état de synchronisation. C’est définitif.')).toBeTruthy();
  expect(screen.queryByText(/Tes données sont conservées/)).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Désinstaller' }));
  expect(onAction).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Désinstaller et effacer' }));
  expect(onAction).toHaveBeenCalledWith('uninstall', { purge: true });
});

test('rule 22: a plugin still in the core offers no erasure', async () => {
  renderCard(plugin({ id: 'linen', name: 'Linge', hasModule: false, erasable: false, data: [] }));
  await userEvent.click(screen.getByText('Linge'));
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByText(/Tes données sont conservées/)).toBeTruthy();
});

test('rule 4: a module that failed to start shows « Erreur » and says it could not start', () => {
  renderCard(plugin({ state: 'failed' }));
  expect(screen.getByText('Erreur')).toBeTruthy();
  expect(screen.getByText('Ce plugin n’a pas pu démarrer.')).toBeTruthy();
});
