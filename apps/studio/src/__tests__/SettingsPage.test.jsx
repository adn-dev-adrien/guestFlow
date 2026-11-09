// specs/guest-app.md rules 15, 48, 52 — Réglages › Application: the app's name and address, Soliomap and
// « Synchroniser », the QR poster and « Régénérer » after a confirmation.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '../pages/SettingsPage';
import { api } from '../services/api';
import {
  LA_GRANJA, SETTINGS, renderStudio,
} from './studioFixtures';

vi.mock('../services/api', () => ({
  api: {
    settings: vi.fn(), saveSettings: vi.fn(), syncSoliomap: vi.fn(), regenerateQr: vi.fn(), qrPosterUrl: (id) => `/api/guest-app/lodgings/${id}/qr-poster.pdf`,
  },
}));

const CABANE = { propertyId: 3, name: 'La Cabane', enabled: false, stateLabel: 'Hors application' };

function setup(settings = SETTINGS) {
  api.settings.mockResolvedValue(settings);
  api.saveSettings.mockImplementation(async (patch) => ({ ...settings, ...patch }));
  const onLodgingChange = vi.fn();
  renderStudio(<SettingsPage lodgings={[LA_GRANJA, CABANE]} onLodgingChange={onLodgingChange} />);
  return { onLodgingChange };
}

describe('SettingsPage (rules 15, 48, 52)', () => {
  it('saves only the settings that changed', async () => {
    setup();
    const user = userEvent.setup();
    const name = await screen.findByRole('textbox', { name: 'Nom de l’app' });
    await user.clear(name);
    await user.type(name, 'Solio');
    await user.click(screen.getByRole('switch', { name: 'Intégrer dans l’app' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ appName: 'Solio', soliomapEmbed: true }));
  });

  it('« Synchroniser » reads Soliomap again and shows when', async () => {
    setup();
    api.syncSoliomap.mockResolvedValue({ syncedLabel: 'Synchronisé à l’instant', ok: true, count: 6 });
    const user = userEvent.setup();
    expect(await screen.findByText(/Synchronisé il y a 2 min · 4 événements/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Synchroniser' }));
    expect(await screen.findByText(/Synchronisé à l’instant · 6 événements/)).toBeInTheDocument();
  });

  it('the poster links to the PDF; « Régénérer » asks first; a lodging out of the app has no QR', async () => {
    api.regenerateQr.mockResolvedValue({ hasLodgingCode: true });
    const { onLodgingChange } = setup();
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'Imprimer l’affiche (PDF)' })).toHaveAttribute('href', '/api/guest-app/lodgings/1/qr-poster.pdf');
    expect(screen.getByText('Ce logement est hors de l’application : il n’a pas de QR.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Régénérer' }));
    expect(api.regenerateQr).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Régénérer' }));
    await waitFor(() => expect(api.regenerateQr).toHaveBeenCalledWith(1));
    expect(onLodgingChange).toHaveBeenCalledWith(1, { hasLodgingCode: true });
  });
});

