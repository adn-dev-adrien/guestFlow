// specs/plugin-operator-provisioning.md rules 22, 38 — « Effacer les données… » on an inactive module: the
// dialog lists what will be erased and asks the customer's address typed; only the exact address
// enables « Effacer ».
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import ModulesSection from '../components/ModulesSection';
import api from '../api';
import { renderAt } from './consoleFixtures';
import { line, modulesView } from './modulesFixtures';

vi.mock('../api', () => ({ default: { customerModules: vi.fn(), toggleModule: vi.fn(), retryModules: vi.fn(), eraseModule: vi.fn() } }));

const withData = () => modulesView({
  included: [
    line({ on: false, state: 'inactive', stateLabel: 'Inactif', canErase: true, eraseLines: ['3 pièces de stock', '12 mouvements'], eraseWarnings: ['les réglages restent dans l’espace'] }),
    line({ id: 'sas', name: 'Arrivée et départ guidés' }),
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  api.customerModules.mockResolvedValue(withData());
});

const open = () => renderAt(<ModulesSection customerId={3} slug="moulin" />);

it('rule 22 — only an inactive module with data has the menu', async () => {
  open();
  await screen.findByRole('switch', { name: 'Linge et blanchisserie' });
  expect(screen.getAllByRole('button', { name: /Plus d’actions/ })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Plus d’actions pour Linge et blanchisserie' })).toBeInTheDocument();
});

it('rule 22 — the dialog lists the data, and « Effacer » waits for the exact address', async () => {
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Plus d’actions pour Linge et blanchisserie' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Effacer les données…' }));
  expect(await screen.findByText('Effacer les données de Linge et blanchisserie ?')).toBeInTheDocument();
  expect(screen.getByText('3 pièces de stock')).toBeInTheDocument();
  expect(screen.getByText('12 mouvements')).toBeInTheDocument();
  expect(screen.getByText('les réglages restent dans l’espace')).toBeInTheDocument();
  const submit = screen.getByRole('button', { name: 'Effacer' });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Pour confirmer, tapez « moulin »'), { target: { value: 'moulin ' } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Pour confirmer, tapez « moulin »'), { target: { value: 'moulin' } });
  expect(submit).toBeEnabled();
});

it('rule 22 — confirming sends the typed address and shows the order on its way', async () => {
  api.eraseModule.mockResolvedValue(modulesView({
    included: [line({ on: false, state: 'inactive', stateLabel: 'Inactif', detail: 'Effacement des données en cours.' }), line({ id: 'sas', name: 'Arrivée et départ guidés' })],
  }));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Plus d’actions pour Linge et blanchisserie' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Effacer les données…' }));
  fireEvent.change(await screen.findByLabelText('Pour confirmer, tapez « moulin »'), { target: { value: 'moulin' } });
  fireEvent.click(screen.getByRole('button', { name: 'Effacer' }));
  await waitFor(() => expect(api.eraseModule).toHaveBeenCalledWith(3, 'linen', 'moulin'));
  await waitFor(() => expect(screen.queryByText('Effacer les données de Linge et blanchisserie ?')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /Plus d’actions/ })).not.toBeInTheDocument();
  expect(screen.getByText('Effacement des données en cours.')).toBeInTheDocument();
});

it('rule 38 — a module installed without data is removed through « Désinstaller… » and a plain confirmation', async () => {
  api.customerModules.mockResolvedValue(modulesView({
    included: [line({ id: 'google-vacation-rentals', name: 'Google Vacation Rentals', on: false, state: 'inactive', stateLabel: 'Inactif', canUninstall: true })],
  }));
  api.eraseModule.mockResolvedValue(modulesView({
    included: [line({ id: 'google-vacation-rentals', name: 'Google Vacation Rentals', on: false, state: 'inactive', stateLabel: 'Inactif', detail: 'Effacement des données en cours.' })],
  }));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Plus d’actions pour Google Vacation Rentals' }));
  expect(screen.queryByRole('menuitem', { name: 'Effacer les données…' })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Désinstaller…' }));
  expect(await screen.findByText('Désinstaller Google Vacation Rentals ?')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Pour confirmer/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Désinstaller' }));
  await waitFor(() => expect(api.eraseModule).toHaveBeenCalledWith(3, 'google-vacation-rentals', 'moulin'));
  expect(await screen.findByText('Effacement des données en cours.')).toBeInTheDocument();
});

it('rule 38 — a module an installed plugin requires shows the reason and no menu', async () => {
  api.customerModules.mockResolvedValue(modulesView({
    included: [line({ on: false, state: 'inactive', stateLabel: 'Inactif', detail: 'Nécessaire à Google Vacation Rentals : à désinstaller d’abord.', blockedBy: 'Nécessaire à Google Vacation Rentals : à désinstaller d’abord.' })],
  }));
  open();
  expect(await screen.findByText('Nécessaire à Google Vacation Rentals : à désinstaller d’abord.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Plus d’actions/ })).not.toBeInTheDocument();
});
