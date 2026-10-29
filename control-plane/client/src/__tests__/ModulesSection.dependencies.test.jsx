// specs/plugin-dependencies.md rules 17–18 — the « Modules » of a customer print « Nécessite » and
// « Utilisé par », and a switch that takes other modules along names them and sends one flag.
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import ModulesSection from '../components/ModulesSection';
import api from '../api';
import { renderAt } from './consoleFixtures';
import { line, modulesView } from './modulesFixtures';

vi.mock('../api', () => ({ default: { customerModules: vi.fn(), toggleModule: vi.fn(), retryModules: vi.fn() } }));

const SAS = { id: 'sas', name: 'Arrivée et départ guidés' };
const WEATHER = { id: 'weather-alerts', name: 'Vigilance Météo-France' };

function view({ sasOn = true, weatherOn = true } = {}) {
  return modulesView({
    included: [
      line({
        ...SAS, on: sasOn, state: sasOn ? 'active' : 'inactive',
        usedBy: [{ ...WEATHER, state: weatherOn ? 'active' : 'inactive', label: weatherOn ? WEATHER.name : `${WEATHER.name} (éteint)` }],
        alsoOff: sasOn && weatherOn ? [WEATHER] : [],
        ...(sasOn && weatherOn ? {
          confirm: { title: 'Désactiver Arrivée et départ guidés ?', message: 'Désactive aussi : Vigilance Météo-France. Ses pages disparaissent de l’espace ; ses données sont conservées.', label: 'Tout désactiver' },
        } : {}),
      }),
      line({
        ...WEATHER, on: weatherOn, state: weatherOn ? 'active' : 'inactive',
        requires: [{ ...SAS, status: sasOn ? 'ok' : 'inactive', label: sasOn ? null : 'éteint' }],
        alsoOn: !weatherOn && !sasOn ? [SAS] : [],
        confirm: !weatherOn && !sasOn ? { title: 'Activer Vigilance Météo-France ?', message: 'Active aussi : Arrivée et départ guidés.', label: 'Tout activer' } : null,
      }),
    ],
    outOfPlan: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

const open = () => renderAt(<ModulesSection customerId={3} />);

it('rule 17 — a line reads « Nécessite X », an unmet one with its badge, and « Utilisé par X (éteint) »', async () => {
  api.customerModules.mockResolvedValue(view({ sasOn: false, weatherOn: false }));
  open();
  expect(await screen.findByText('éteint')).toBeInTheDocument();
  expect(screen.getByText(/^Nécessite/).textContent).toBe('Nécessite Arrivée et départ guidés');
  expect(screen.getByText(/^Utilisé par/).textContent).toBe('Utilisé par Vigilance Météo-France (éteint)');
});

it('rule 17 — with everything on, no badge and « Utilisé par » alone carries no suffix', async () => {
  api.customerModules.mockResolvedValue(view());
  open();
  expect(await screen.findByText(/^Utilisé par/)).toHaveTextContent('Utilisé par Vigilance Météo-France');
  expect(screen.queryByText('éteint')).not.toBeInTheDocument();
});

it('rule 18 — switching on a module whose requirement is off asks « Activer aussi » and sends withRequirements', async () => {
  api.customerModules.mockResolvedValue(view({ sasOn: false, weatherOn: false }));
  api.toggleModule.mockResolvedValue(view());
  open();
  fireEvent.click(await screen.findByRole('switch', { name: 'Vigilance Météo-France' }));
  expect(await screen.findByText('Activer Vigilance Météo-France ?')).toBeInTheDocument();
  expect(screen.getByText('Active aussi : Arrivée et départ guidés.')).toBeInTheDocument();
  expect(api.toggleModule).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Tout activer' }));
  await waitFor(() => expect(api.toggleModule).toHaveBeenCalledWith(3, 'weather-alerts', true, { withRequirements: ['sas'] }));
});

it('rule 18 — switching off a module that others use lists them in the dialog and sends withDependents', async () => {
  api.customerModules.mockResolvedValue(view());
  api.toggleModule.mockResolvedValue(view({ sasOn: false, weatherOn: false }));
  open();
  fireEvent.click(await screen.findByRole('switch', { name: 'Arrivée et départ guidés' }));
  expect(await screen.findByText(/^Désactive aussi : Vigilance Météo-France\./)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tout désactiver' }));
  await waitFor(() => expect(api.toggleModule).toHaveBeenCalledWith(3, 'sas', false, { withDependents: ['weather-alerts'] }));
});

it('rule 18 — a cancelled confirmation changes nothing', async () => {
  api.customerModules.mockResolvedValue(view());
  open();
  fireEvent.click(await screen.findByRole('switch', { name: 'Arrivée et départ guidés' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
  expect(api.toggleModule).not.toHaveBeenCalled();
});

it('rule 19 — a module whose requirement the plan does not license has a disabled switch and says why before any click', async () => {
  api.customerModules.mockResolvedValue(modulesView({
    included: [line({ ...WEATHER, on: false, state: 'inactive', switchBlockedBy: 'Nécessite Arrivée et départ guidés, hors forfait.' })],
    outOfPlan: [],
  }));
  open();
  expect(await screen.findByText('Nécessite Arrivée et départ guidés, hors forfait.')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Vigilance Météo-France' })).toBeDisabled();
});
