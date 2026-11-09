// specs/guest-app.md rule 11bis — the studio's Modules screen: each module on or off, in the lodging's own order,
// saved as the whole ordered list; the dirty guard keeps unsaved changes.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModulesPage from '../pages/ModulesPage';
import { api } from '../services/api';
import {
  LA_GRANJA, SETTINGS, lodgingConfig, renderStudio,
} from './studioFixtures';

vi.mock('../services/api', () => ({
  api: {
    lodging: vi.fn(), saveLodging: vi.fn(), settings: vi.fn(), media: vi.fn(),
  },
}));

function setup() {
  api.lodging.mockResolvedValue(lodgingConfig());
  api.settings.mockResolvedValue(SETTINGS);
  api.media.mockResolvedValue([]);
  api.saveLodging.mockImplementation(async (id, patch) => lodgingConfig({ modules: patch.modules }));
  renderStudio(<ModulesPage lodging={LA_GRANJA} />);
}

describe('ModulesPage (rule 11bis)', () => {
  it('lists the eight modules in the lodging’s order with their switches', async () => {
    setup();
    const list = await screen.findByRole('list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent('Portail');
    expect(rows[4]).toHaveTextContent('Activités');
    expect(screen.getByRole('switch', { name: 'Urgences pour La Granja' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Wifi pour La Granja' })).toBeChecked();
  });

  it('saves the whole list, reordered and switched, with orders 0…7', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole('list');
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Descendre Portail' }));
    await user.click(screen.getByRole('switch', { name: 'Wifi pour La Granja' }));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(api.saveLodging).toHaveBeenCalledTimes(1));
    const [id, body] = api.saveLodging.mock.calls[0];
    expect(id).toBe(1);
    expect(body.modules.slice(0, 2)).toEqual([{ key: 'wifi', on: false, order: 0 }, { key: 'gate', on: true, order: 1 }]);
    expect(body.modules.map((m) => m.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    await waitFor(() => expect(save).toBeDisabled());
  });

  it('« Annuler » brings back the saved list', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByRole('list');
    await user.click(screen.getByRole('switch', { name: 'Portail pour La Granja' }));
    expect(screen.getByRole('switch', { name: 'Portail pour La Granja' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.getByRole('switch', { name: 'Portail pour La Granja' })).toBeChecked();
  });

  it('shows the server’s refusal', async () => {
    setup();
    api.saveLodging.mockRejectedValueOnce(new Error('La liste des modules est incomplète.'));
    const user = userEvent.setup();
    await screen.findByRole('list');
    await user.click(screen.getByRole('switch', { name: 'Portail pour La Granja' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('La liste des modules est incomplète.')).toBeInTheDocument();
  });
});
