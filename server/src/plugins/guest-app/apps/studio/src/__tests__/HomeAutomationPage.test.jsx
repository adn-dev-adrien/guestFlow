// specs/guest-app-home-automation.md rules 12-16 — the studio's Domotique screen: the channel, the five blocks in the
// lodging's order, the pickers the server shaped, « Pilotable » only for a light entrusted in Sowel, the server's
// refusals inline (live, through the preview) and on save.
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeAutomationPage from '../pages/HomeAutomationPage';
import { api } from '../services/api';
import { LA_GRANJA, lodgingConfig, renderStudio } from './studioFixtures';

vi.mock('../services/api', () => ({
  api: {
    home: vi.fn(), saveHome: vi.fn(), homePreview: vi.fn(), lodging: vi.fn(), media: vi.fn(),
  },
}));

const BLOCKS = [
  { kind: 'outdoor', on: true, equipmentId: 'wx', items: [] },
  { kind: 'rooms', on: true, equipmentId: null, items: [{ id: 'room01', label: 'Séjour', equipmentId: 't-sejour' }] },
  { kind: 'lights', on: true, equipmentId: null, items: [{ id: 'light01', label: 'Le chêne', equipmentId: 'l-chene', pilotable: true }] },
  { kind: 'rain', on: false, equipmentId: null, items: [] },
  { kind: 'energy', on: false, equipmentId: null, items: [] },
];
const PICKERS = {
  outdoor: [{ id: 'wx', label: 'Extérieur — Station Netatmo' }],
  rooms: [{ id: 't-sejour', label: 'La Granja › Séjour — Thermomètre' }, { id: 't-ch1', label: 'La Granja › Chambre — Thermomètre' }],
  lights: [{ id: 'l-chene', label: 'Extérieur › Jardin — Éclairage du chêne', guestSwitchable: true }, { id: 'l-salon', label: 'Maison › Salon — Lampe' }],
  rain: [{ id: 'wx', label: 'Extérieur — Station Netatmo' }],
  energy: [{ id: 'm-granja', label: 'La Granja — Sous-compteur' }],
};
const HOME = { channel: { state: 'ok', message: 'Reçu de Sowel il y a 1 min.', equipments: 6 }, blocks: BLOCKS, pickers: PICKERS };

beforeEach(() => {
  vi.clearAllMocks();
  api.home.mockResolvedValue(HOME);
  api.lodging.mockResolvedValue(lodgingConfig());
  api.media.mockResolvedValue([]);
  api.homePreview.mockResolvedValue({ live: true, updated: 'il y a 1 min', blocks: [] });
  api.saveHome.mockImplementation(async (id, blocks) => ({ ...HOME, blocks }));
});

describe('HomeAutomationPage (rules 12-16)', () => {
  it('shows the channel and the five blocks in the lodging’s order', async () => {
    renderStudio(<HomeAutomationPage lodging={LA_GRANJA} />);
    expect(await screen.findByText('Reçu de Sowel il y a 1 min.')).toBeInTheDocument();
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('p').textContent)).toEqual(['Extérieur', 'Pièces', 'Éclairage', 'Pluie', 'Électricité']);
    expect(screen.getByRole('switch', { name: 'Pluie pour La Granja' })).not.toBeChecked();
  });

  it('« Pilotable » is disabled for a light not entrusted to guests in Sowel', async () => {
    const user = userEvent.setup();
    renderStudio(<HomeAutomationPage lodging={LA_GRANJA} />);
    await screen.findByText('Reçu de Sowel il y a 1 min.');
    expect(screen.getByRole('checkbox', { name: 'Pilotable par le voyageur' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Ajouter une lumière' }));
    const pickers = screen.getAllByLabelText('Lumière');
    await user.click(pickers[1]);
    await user.click(await screen.findByRole('option', { name: 'Maison › Salon — Lampe' }));
    const boxes = screen.getAllByRole('checkbox', { name: 'Pilotable par le voyageur' });
    expect(boxes[1]).toBeDisabled();
    expect(screen.getByText('Non confiée aux voyageurs dans Sowel : consultation seule.')).toBeInTheDocument();
  });

  it('the server’s refusals show inline as soon as the draft is refused, and the preview says it is frozen', async () => {
    api.homePreview.mockImplementation(async (id, blocks) => {
      if (blocks[1].items[0].label === '') throw Object.assign(new Error('Aperçu impossible.'), { errors: { 'blocks.1.items.0.label': 'Nom requis.' } });
      return { live: true, updated: 'il y a 1 min', blocks: [] };
    });
    const user = userEvent.setup();
    renderStudio(<HomeAutomationPage lodging={LA_GRANJA} />);
    const label = await screen.findByDisplayValue('Séjour');
    await user.clear(label);
    expect(await screen.findByText('Nom requis.')).toBeInTheDocument();
    expect(screen.getByText('Aperçu figé : 1 saisie refusée')).toBeInTheDocument();
  });

  it('saves the whole draft, reordered and switched', async () => {
    const user = userEvent.setup();
    renderStudio(<HomeAutomationPage lodging={LA_GRANJA} />);
    await screen.findByText('Reçu de Sowel il y a 1 min.');
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Descendre Extérieur' }));
    await user.click(screen.getByRole('switch', { name: 'Pluie pour La Granja' }));
    await user.click(save);
    await waitFor(() => expect(api.saveHome).toHaveBeenCalledTimes(1));
    const [id, blocks] = api.saveHome.mock.calls[0];
    expect(id).toBe(1);
    expect(blocks.map((b) => b.kind)).toEqual(['rooms', 'outdoor', 'lights', 'rain', 'energy']);
    expect(blocks[3].on).toBe(true);
  });

  it('a refused save shows the server’s message and its field errors', async () => {
    api.saveHome.mockRejectedValue(Object.assign(new Error('Une saisie à corriger.'), { errors: { 'blocks.3.equipmentId': 'Choisir un équipement.' } }));
    const user = userEvent.setup();
    renderStudio(<HomeAutomationPage lodging={LA_GRANJA} />);
    await screen.findByText('Reçu de Sowel il y a 1 min.');
    await user.click(screen.getByRole('switch', { name: 'Pluie pour La Granja' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Une saisie à corriger.')).toBeInTheDocument();
    expect(screen.getByText('Choisir un équipement.')).toBeInTheDocument();
  });
});
