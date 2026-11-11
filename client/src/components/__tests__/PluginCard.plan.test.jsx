// specs/control-plane-plans-and-access.md rules 11-12 — a plugin the subscription does not include
// shows the plan that does and cannot be installed; one installed before a downgrade reads as off,
// keeps its data and can still be uninstalled.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PluginCard from '../PluginCard';

const plugin = (over = {}) => ({
  id: 'neat', name: 'Assurance annulation Neat', description: 'Assurance annulation', icon: 'umbrella',
  surfaces: ['La carte Neat de la fiche'], requires: [], state: 'available', blocker: null,
  hasModule: false, erasable: false, data: [],
  outOfPlan: true, planChip: 'Forfait Premium',
  planHint: 'Inclus dans le forfait Premium, sur demande.',
  ...over,
});

function renderCard(p, onAction = vi.fn()) {
  render(<ThemeProvider theme={theme}><PluginCard plugin={p} onAction={onAction} /></ThemeProvider>);
  return onAction;
}

test('rule 11: the plan chip shows and « Installer » is disabled, the plan hint written under it (readable on a phone)', () => {
  renderCard(plugin());
  expect(screen.getByText('Forfait Premium')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Installer' })).toBeDisabled();
  expect(screen.getByText('Inclus dans le forfait Premium, sur demande.')).toBeTruthy();
});

test('rule 12: installed but outside the plan — off, data kept, no Activer, Désinstaller still there', async () => {
  const onAction = renderCard(plugin({ state: 'active' }));
  expect(screen.getByText('Désactivé — hors forfait')).toBeTruthy();
  expect(screen.getByText('Données conservées')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Activer|Désactiver|Installer/ })).toBeNull();
  await userEvent.click(screen.getByText('Assurance annulation Neat'));
  await userEvent.click(screen.getByRole('button', { name: 'Désinstaller' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmer la désinstallation' }));
  expect(onAction).toHaveBeenCalledWith('uninstall', undefined);
});

test('in the plan: the card is unchanged', () => {
  renderCard(plugin({ outOfPlan: false, planChip: null, planHint: null }));
  expect(screen.queryByText('Forfait Premium')).toBeNull();
  expect(screen.getByRole('button', { name: 'Installer' })).not.toBeDisabled();
});
