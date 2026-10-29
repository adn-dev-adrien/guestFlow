// specs/plugin-dependencies.md rules 6–9, 11–14 — a card prints « Nécessite » and « Utilisé par », says
// what a button would refuse before the click, and sends one flag once the operator confirmed the
// plugins that follow.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PluginCard from '../PluginCard';

const allowed = (extra = {}) => ({ allowed: true, blockedBy: null, ...extra });
const actions = (over = {}) => ({
  activate: { allowed: false, blockedBy: null, alsoActivates: [] },
  deactivate: allowed({ alsoDeactivates: [] }),
  uninstall: allowed(),
  ...over,
});
const plugin = (over = {}) => ({
  id: 'google-vacation-rentals', name: 'Google Vacation Rentals', description: 'Envoie à Google les prix.', icon: 'travel-explore',
  surfaces: ['Un onglet'], requires: [], state: 'active', blocker: null, erasable: false, data: [],
  dependencies: { requires: [], usedBy: [] }, actions: actions(), ...over,
});
const site = { id: 'website-booking', name: 'Réservation depuis le site' };

function renderCard(p, onAction = vi.fn()) {
  render(<ThemeProvider theme={theme}><PluginCard plugin={p} onAction={onAction} /></ThemeProvider>);
  return onAction;
}

test('rule 6: the dependant reads « Nécessite » with the requirement’s name, no badge while it is met', () => {
  renderCard(plugin({ dependencies: { requires: [{ ...site, status: 'ok', label: null, updateAvailable: false }], usedBy: [] } }));
  expect(screen.getByText('Réservation depuis le site').closest('span').textContent).toBe('Nécessite Réservation depuis le site');
  expect(screen.queryByText('inactif')).toBeNull();
});

test('rule 6: an unmet requirement carries its status, and its own update when there is one (rule 15)', () => {
  renderCard(plugin({
    dependencies: { requires: [{ ...site, status: 'outOfRange', label: 'version 1.6.0 — 1.7.1 ou plus récente requise', updateAvailable: true }], usedBy: [] },
  }));
  expect(screen.getByText('version 1.6.0 — 1.7.1 ou plus récente requise')).toBeTruthy();
  expect(screen.getByText('Mise à jour de Réservation depuis le site disponible')).toBeTruthy();
});

test('rule 7: the requirement reads « Utilisé par », an inactive dependant suffixed', () => {
  renderCard(plugin({
    id: 'website-booking', name: 'Réservation depuis le site',
    dependencies: { requires: [], usedBy: [{ id: 'a', name: 'Google Vacation Rentals', state: 'active', label: 'Google Vacation Rentals' }, { id: 'b', name: 'Autre', state: 'inactive', label: 'Autre (inactif)' }] },
  }));
  expect(screen.getByText(/^Utilisé par/).textContent).toBe('Utilisé par Google Vacation Rentals, Autre (inactif)');
});

test('rule 8: a deactivation refused by a dependant’s blocker is disabled in the menu, with the reason', async () => {
  renderCard(plugin({ actions: actions({ deactivate: { allowed: false, blockedBy: 'Paiement ne peut pas être désactivé : 1 lien en attente.', alsoDeactivates: [] } }) }));
  await userEvent.click(screen.getByRole('button', { name: /Plus d’actions/ }));
  expect(screen.getByRole('menuitem', { name: /Désactiver/ }).getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByText('Paiement ne peut pas être désactivé : 1 lien en attente.')).toBeTruthy();
});

test('rules 12–13: deactivating a plugin an active plugin uses names the followers and sends withDependents', async () => {
  const onAction = renderCard(plugin({
    id: 'website-booking', name: 'Réservation depuis le site',
    actions: actions({
      deactivate: allowed({
        alsoDeactivates: [{ id: 'g', name: 'Google Vacation Rentals' }],
        confirm: {
          title: 'Désactiver Réservation depuis le site ?',
          message: 'Désactive aussi : Google Vacation Rentals. Réglages et données gardés. À réactiver ensuite un par un.',
          label: 'Tout désactiver',
        },
      }),
    }),
  }));
  await userEvent.click(screen.getByRole('button', { name: /Plus d’actions/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: /Désactiver/ }));
  expect(screen.getByText('Désactive aussi : Google Vacation Rentals. Réglages et données gardés. À réactiver ensuite un par un.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Tout désactiver' }));
  expect(onAction).toHaveBeenCalledWith('deactivate', { withDependents: true });
});

test('rule 12: without followers the confirmation is the usual one and no flag is sent', async () => {
  const onAction = renderCard(plugin());
  await userEvent.click(screen.getByRole('button', { name: /Plus d’actions/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: /Désactiver/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Désactiver' }));
  expect(onAction).toHaveBeenCalledWith('deactivate', undefined);
});

test('rule 11: activating on a requirement that is off proposes « Tout activer » and sends withRequirements', async () => {
  const onAction = renderCard(plugin({
    state: 'inactive',
    actions: actions({
      activate: allowed({ alsoActivates: [site], confirm: { title: 'Activer Google Vacation Rentals', message: 'Active aussi : Réservation depuis le site.', label: 'Tout activer' } }),
      deactivate: { allowed: false, blockedBy: null, alsoDeactivates: [] },
    }),
  }));
  await userEvent.click(screen.getByRole('button', { name: 'Activer' }));
  expect(screen.getByText('Active aussi : Réservation depuis le site.')).toBeTruthy();
  expect(onAction).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Tout activer' }));
  expect(onAction).toHaveBeenCalledWith('activate', { withRequirements: true });
});

test('rule 11: « Activer » is disabled with the reason when a requirement is not installed', () => {
  renderCard(plugin({
    state: 'inactive', actions: actions({ activate: { allowed: false, blockedBy: 'Nécessite Réservation depuis le site : à installer d’abord.', alsoActivates: [] } }),
  }));
  expect(screen.getByRole('button', { name: 'Activer' }).disabled).toBe(true);
  expect(screen.getByText('Nécessite Réservation depuis le site : à installer d’abord.')).toBeTruthy();
});

test('rule 14: « Désinstaller » is disabled while a plugin uses it, with « Utilisé par … » under it', async () => {
  renderCard(plugin({ id: 'website-booking', name: 'Réservation depuis le site', actions: actions({ uninstall: { allowed: false, blockedBy: 'Utilisé par Google Vacation Rentals : à désinstaller d’abord.' } }) }));
  await userEvent.click(screen.getByText('Réservation depuis le site'));
  expect(screen.getByRole('button', { name: 'Désinstaller' }).disabled).toBe(true);
  expect(screen.getByText('Utilisé par Google Vacation Rentals : à désinstaller d’abord.')).toBeTruthy();
});

test('rule 9: installing lists what is installed and what is switched on, one confirmation', async () => {
  const onAction = renderCard(plugin({
    state: 'available', dependencies: { requires: [{ ...site, status: 'missing', label: 'non installé', updateAvailable: false }], usedBy: [] },
    offer: {
      version: '1.0.2',
      refusal: null,
      requirements: [{ ...site, version: '1.8.3', op: 'install' }, { id: 'sas', name: 'Arrivée et départ guidés', version: '1.7.2', op: 'activate' }],
      confirm: { title: 'Installer Google Vacation Rentals', message: 'Installe aussi Réservation depuis le site 1.8.3. Active aussi Arrivée et départ guidés.', label: 'Tout installer' },
    },
  }));
  expect(screen.getByText('non installé')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Installer' }));
  expect(screen.getByText('Installe aussi Réservation depuis le site 1.8.3. Active aussi Arrivée et départ guidés.')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'Tout installer' }));
  expect(onAction).toHaveBeenCalledWith('install', { withRequirements: true });
});

test('one line, not three: a plugin left unloaded for a missing requirement shows « Nécessite … non installé » and not the server’s repeat', () => {
  renderCard(plugin({
    state: 'incompatible',
    incompatible: { code: 'REQUIREMENT_MISSING', message: 'Nécessite Réservation depuis le site.' },
    dependencies: { requires: [{ ...site, status: 'missing', label: 'non installé', updateAvailable: false }], usedBy: [] },
  }));
  expect(screen.getByText('non installé')).toBeTruthy();
  expect(screen.queryByText('Nécessite Réservation depuis le site.')).toBeNull();
});
