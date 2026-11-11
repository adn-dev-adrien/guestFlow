// specs/guest-app.md rule 48 — the order ceiling emptied in Réglages › Application is sent as null (the server's
// default, 500 €), never as 0.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '../pages/SettingsPage';
import { api } from '../services/api';
import { LA_GRANJA, SETTINGS, renderStudio } from './studioFixtures';

vi.mock('../services/api', () => ({
  api: {
    settings: vi.fn(), saveSettings: vi.fn(), syncSoliomap: vi.fn(), regenerateQr: vi.fn(), qrPosterUrl: (id) => `/api/guest-app/lodgings/${id}/qr-poster.pdf`,
  },
}));

describe('SettingsPage — the order ceiling (rule 48)', () => {
  it('emptied, it is sent as null', async () => {
    api.settings.mockResolvedValue(SETTINGS);
    api.saveSettings.mockResolvedValue({ ...SETTINGS, maxOrderTotal: 500 });
    renderStudio(<SettingsPage lodgings={[LA_GRANJA]} onLodgingChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.clear(await screen.findByRole('spinbutton', { name: 'Montant maximal d’une commande' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ maxOrderTotal: null }));
  });

  it('a number typed is sent as a number', async () => {
    api.settings.mockResolvedValue(SETTINGS);
    api.saveSettings.mockResolvedValue({ ...SETTINGS, maxOrderTotal: 300 });
    renderStudio(<SettingsPage lodgings={[LA_GRANJA]} onLodgingChange={vi.fn()} />);
    const user = userEvent.setup();
    const field = await screen.findByRole('spinbutton', { name: 'Montant maximal d’une commande' });
    await user.clear(field);
    await user.type(field, '300');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ maxOrderTotal: 300 }));
  });
});
