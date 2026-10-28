// specs/plugin-operator-provisioning.md rules 10, 12, 14 — the customer's « Modules »: the two
// groups, a switch that saves at once (and asks before switching off), a refusal that snaps back
// with the server's sentence, the state of each line and the retry.
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import ModulesSection from '../components/ModulesSection';
import api from '../api';
import { renderAt } from './consoleFixtures';
import { line, modulesView } from './modulesFixtures';

vi.mock('../api', () => ({ default: { customerModules: vi.fn(), toggleModule: vi.fn(), retryModules: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  api.customerModules.mockResolvedValue(modulesView());
});

const open = () => renderAt(<ModulesSection customerId={3} />);

it('rule 10 — the included modules each have a switch; the out-of-plan ones are folded, with their plan and no switch', async () => {
  open();
  const included = await screen.findByRole('list', { name: 'Modules inclus' });
  expect(within(included).getAllByRole('switch')).toHaveLength(3);
  expect(within(included).getByRole('switch', { name: 'Linge et blanchisserie' })).toBeChecked();
  expect(within(included).getByRole('switch', { name: 'Vacances scolaires' })).not.toBeChecked();
  expect(screen.queryByText('Assurance annulation Neat')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Hors forfait \(1\)/ }));
  const out = await screen.findByRole('list', { name: 'Modules hors forfait' });
  expect(within(out).getByText('Forfait Premium')).toBeInTheDocument();
  expect(within(out).queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.getByText('2 actifs')).toBeInTheDocument();
});

it('rule 12 — switching on saves at once and asks nothing', async () => {
  api.toggleModule.mockResolvedValue(modulesView({ header: '3 actifs' }));
  open();
  fireEvent.click(await screen.findByRole('switch', { name: 'Vacances scolaires' }));
  await waitFor(() => expect(api.toggleModule).toHaveBeenCalledWith(3, 'school-holidays', true));
  expect(await screen.findByText('3 actifs')).toBeInTheDocument();
});

it('rule 12 — switching off asks first; « Annuler » changes nothing, « Désactiver » saves', async () => {
  api.toggleModule.mockResolvedValue(modulesView({ header: '1 actif' }));
  open();
  fireEvent.click(await screen.findByRole('switch', { name: 'Linge et blanchisserie' }));
  expect(await screen.findByText('Désactiver Linge et blanchisserie ?')).toBeInTheDocument();
  expect(screen.getByText('Ses pages disparaissent de l’espace ; ses données sont conservées.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  await waitFor(() => expect(screen.queryByText('Désactiver Linge et blanchisserie ?')).not.toBeInTheDocument());
  expect(api.toggleModule).not.toHaveBeenCalled();
  expect(await screen.findByRole('switch', { name: 'Linge et blanchisserie' })).toBeChecked();

  fireEvent.click(screen.getByRole('switch', { name: 'Linge et blanchisserie' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Désactiver' }));
  await waitFor(() => expect(api.toggleModule).toHaveBeenCalledWith(3, 'linen', false));
});

it('rule 11 — a refused switch snaps back and shows the server’s sentence under the line', async () => {
  api.toggleModule.mockRejectedValue(Object.assign(new Error('Nécessaire à Google Vacation Rentals : à désactiver d’abord.'), { status: 422 }));
  open();
  fireEvent.click(await screen.findByRole('switch', { name: 'Vacances scolaires' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nécessaire à Google Vacation Rentals : à désactiver d’abord.');
  expect(screen.getByRole('switch', { name: 'Vacances scolaires' })).not.toBeChecked();
});

it('rule 14 — each state has its own wording: waiting, failure with a retry, blocked, to configure', async () => {
  api.customerModules.mockResolvedValue(modulesView({
    header: '1 actif · 1 à configurer · 1 en échec',
    counts: { active: 1, toConfigure: 1, failed: 1, blocked: 1 },
    included: [
      line({ id: 'a', name: 'Alpha', state: 'pending', stateLabel: 'En attente depuis 6 min — espace injoignable ?' }),
      line({ id: 'b', name: 'Bravo', on: true, state: 'failed', stateLabel: 'Échec : Paquet introuvable.', canRetry: true }),
      line({ id: 'c', name: 'Charlie', state: 'blocked', stateLabel: 'Bloqué : 2 liens de paiement en attente : à payer ou annuler d’abord.' }),
      line({ id: 'd', name: 'Delta', state: 'active', stateLabel: 'Actif · à configurer : clé API manquante', needsSetup: true }),
    ],
  }));
  open();
  expect(await screen.findByText('En attente depuis 6 min — espace injoignable ?')).toBeInTheDocument();
  expect(screen.getByText('Échec : Paquet introuvable.')).toBeInTheDocument();
  expect(screen.getByText(/^Bloqué : 2 liens de paiement/)).toBeInTheDocument();
  expect(screen.getByText('Actif · à configurer : clé API manquante')).toBeInTheDocument();
  expect(screen.getByText('1 actif · 1 à configurer · 1 en échec')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Réessayer' })).toHaveLength(1);
});

it('rule 18 — « Réessayer » asks the server for a new attempt', async () => {
  api.customerModules.mockResolvedValue(modulesView({ included: [line({ state: 'failed', stateLabel: 'Échec : Paquet introuvable.', canRetry: true })] }));
  api.retryModules.mockResolvedValue(modulesView({ included: [line({ state: 'pending', stateLabel: 'En attente' })] }));
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(api.retryModules).toHaveBeenCalledWith(3));
  expect(await screen.findByText('En attente')).toBeInTheDocument();
});

it('rule 25 — a space not read yet says so and offers « Relever maintenant »; zero modules reads « Aucun module actif. »', async () => {
  api.customerModules.mockResolvedValueOnce(modulesView({ seeded: false, seedLabel: 'Espace illisible : modules non relevés.', included: [], outOfPlan: [] }));
  api.retryModules.mockResolvedValue(modulesView({ header: '0 actif', counts: { active: 0, toConfigure: 0, failed: 0, blocked: 0 }, empty: 'Aucun module actif.', included: [line({ on: false, state: 'inactive', stateLabel: 'Inactif' })] }));
  open();
  expect(await screen.findByText('Espace illisible : modules non relevés.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Relever maintenant' }));
  expect(await screen.findByText('Aucun module actif.')).toBeInTheDocument();
});
