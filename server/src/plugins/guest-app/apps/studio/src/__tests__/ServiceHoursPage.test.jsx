// specs/guest-app.md rules 40, 41bis — Réglages › Service: the week's ranges (at most three a day), the exception
// dates, the hours of one lodging, and « À retirer » that needs its pickup place.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ServicePage from '../pages/ServicePage';
import { api } from '../services/api';
import {
  LA_GRANJA, L_ESTIVA, SETTINGS, renderStudio,
} from './studioFixtures';

vi.mock('../services/api', () => ({
  api: {
    settings: vi.fn(), saveSettings: vi.fn(), serviceHours: vi.fn(), saveServiceHours: vi.fn(),
  },
}));

const WEEK = {
  propertyId: null,
  shared: true,
  weekly: {
    0: [{ from: '09:00', to: '12:00' }], 1: [{ from: '08:00', to: '12:00' }, { from: '16:00', to: '20:00' }], 2: [], 3: [], 4: [], 5: [], 6: [],
  },
  exceptions: [{ date: '2026-12-25', closed: true }], // date-literal-ok: an exception saved as typed
};

function setup({ settings = SETTINGS, hours = WEEK } = {}) {
  api.settings.mockResolvedValue(settings);
  api.serviceHours.mockImplementation(async (propertyId) => (propertyId ? { ...hours, propertyId, shared: true } : hours));
  api.saveServiceHours.mockImplementation(async (config, propertyId) => ({ propertyId, shared: !propertyId, ...config }));
  api.saveSettings.mockImplementation(async (patch) => ({ ...settings, ...patch }));
  renderStudio(<ServicePage lodgings={[LA_GRANJA, L_ESTIVA]} />);
}

const dayRow = (name) => screen.getByRole('group', { name });

describe('ServicePage (rules 40, 41bis)', () => {
  it('draws the week, Monday first, a day without a range « Fermé », and the exceptions', async () => {
    setup();
    expect(await screen.findByText('Semaine type')).toBeInTheDocument();
    expect(within(dayRow('Lundi')).getAllByRole('combobox')).toHaveLength(4);
    expect(within(dayRow('Mardi')).getByText('Fermé.')).toBeInTheDocument();
    expect(screen.getByText(/25 déc\. 2026/)).toBeInTheDocument();
  });

  it('adds a range then saves the whole week and its exceptions', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText('Semaine type');
    await user.click(within(dayRow('Mardi')).getByRole('button', { name: 'Ajouter une plage' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.saveServiceHours).toHaveBeenCalledTimes(1));
    const [config, propertyId] = api.saveServiceHours.mock.calls[0];
    expect(propertyId).toBeNull();
    expect(config.weekly[2]).toEqual([{ from: '08:00', to: '12:00' }]);
    expect(config.weekly[1]).toHaveLength(2);
    expect(config.exceptions).toEqual([{ date: '2026-12-25', closed: true }]); // date-literal-ok: an exception saved as typed
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it('a day holds three ranges at most', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText('Semaine type');
    await user.click(within(dayRow('Lundi')).getByRole('button', { name: 'Ajouter une plage' }));
    expect(within(dayRow('Lundi')).queryByRole('button', { name: 'Ajouter une plage' })).not.toBeInTheDocument();
  });

  it('« À retirer » asks for the pickup place and saves both settings together', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText('Livraison ou retrait');
    await user.click(screen.getByRole('button', { name: 'À retirer' }));
    const place = screen.getByRole('textbox', { name: /Lieu de retrait/ });
    expect(screen.getByText('Lieu où le client récupère sa commande.')).toBeInTheDocument();
    await user.type(place, 'À l’accueil');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ fulfilment: 'pickup', pickupPlace: 'À l’accueil' }));
  });

  it('a lodging that follows the shared hours says so, and gets its own on request', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText('Semaine type');
    await user.click(screen.getByRole('combobox', { name: 'Horaires de' }));
    await user.click(await screen.findByRole('option', { name: 'L’Estiva' }));
    expect(await screen.findByText('L’Estiva suit les horaires communs à tous les logements.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Définir ses propres horaires' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.saveServiceHours).toHaveBeenCalledWith(expect.objectContaining({ weekly: expect.any(Object) }), 2));
  });
});
